import {v} from 'convex/values';
import {getAuthUserId} from '@convex-dev/auth/server';
import {mutation,query,internalMutation,type MutationCtx,type QueryCtx} from './_generated/server';
import {internal} from './_generated/api';
import type {Id,Doc} from './_generated/dataModel';
import {defaultUsername} from './usernames';
import {presence} from './presence';
import {conversation,addMessage} from './socialHelpers';
const active=(s:string)=>s==='accepted'||s==='in_session';
async function user(ctx:QueryCtx|MutationCtx){const id=await getAuthUserId(ctx);if(!id)throw new Error('Sign in first');return id;}
async function profile(ctx:QueryCtx|MutationCtx,id:Id<'users'>){return ctx.db.query('profiles').withIndex('by_userId',q=>q.eq('userId',id)).unique();}
const text=(s:string,min:number,max:number,label:string)=>{s=s.trim();if(s.length<min||s.length>max)throw new Error(`${label} must be ${min}–${max} characters`);return s;};
async function notify(ctx:MutationCtx,id:Id<'users'>,requestId:Id<'requests'>,message:string){await ctx.db.insert('notifications',{userId:id,requestId,message,read:false});}
async function decorate(ctx:QueryCtx,r:Doc<'requests'>){const p=await profile(ctx,r.requester),h=r.helper?await profile(ctx,r.helper):null;const session=r.sessionId?await ctx.db.get(r.sessionId):null;const review=r.sessionId?await ctx.db.query('reviews').withIndex('by_sessionId',q=>q.eq('sessionId',r.sessionId!)).unique():null;return {...r,canReview:session?.status==='completed'&&session.startedAt!==undefined&&r.category!=='Friend call',reviewRating:review?.rating??null,conversationId:session?.conversationId??null,inviteStatus:session?.inviteStatus??null,requesterName:p?.displayName??'GHOST user',helperName:h?.displayName??null};}
async function authorized(ctx:QueryCtx|MutationCtx,id:Id<'sessions'>){const uid=await user(ctx),s=await ctx.db.get(id);if(!s||(s.requester!==uid&&s.helper!==uid))throw new Error('Not a session participant');return {uid,s};}
async function release(ctx:MutationCtx,s:Doc<'sessions'>,status:'completed'|'expired'){
 if(!active(s.status))return;
 if(status==='completed'&&s.startedAt!==undefined){
  const request=await ctx.db.get(s.requestId),helper=await profile(ctx,s.helper);
  if(helper&&request?.category!=='Friend call'){
   const existing=await ctx.db.query('helpedPairs').withIndex('by_helper_and_requester',q=>q.eq('helper',s.helper).eq('requester',s.requester)).unique();
   if(!existing)await ctx.db.insert('helpedPairs',{helper:s.helper,requester:s.requester});
   await ctx.db.patch(helper._id,{helpSessions:(helper.helpSessions??0)+1,peopleHelped:(helper.peopleHelped??0)+(existing?0:1)});
  }
 }
 await ctx.db.patch(s._id,{status,endedAt:Date.now(),updatedAt:Date.now()});await ctx.db.patch(s.requestId,{status,updatedAt:Date.now()});
 for(const uid of [s.requester,s.helper]){const p=await profile(ctx,uid);if(p?.activeSession===s._id)await ctx.db.patch(p._id,{activeSession:undefined});await notify(ctx,uid,s.requestId,status==='completed'?'Assistance session completed.':'Session expired after disconnection.');}
}
export const viewer=query({args:{},returns:v.any(),handler:async ctx=>{const uid=await getAuthUserId(ctx);return uid?await profile(ctx,uid):null;}});
export const ensureProfile=mutation({args:{},returns:v.id('profiles'),handler:async ctx=>{
 const uid=await user(ctx),p=await profile(ctx,uid);
 if(p){if(!p.username)await ctx.db.patch(p._id,{username:await defaultUsername(ctx,uid,p.displayName)});return p._id;}
 const u=await ctx.db.get(uid),displayName=u?.name?.slice(0,60)||'GHOST user';return ctx.db.insert('profiles',{userId:uid,displayName,username:await defaultUsername(ctx,uid,displayName),expertise:[],available:false});
}});
export const saveProfile=mutation({args:{bio:v.optional(v.string()),displayName:v.string(),avatar:v.optional(v.string()),expertise:v.array(v.string()),available:v.boolean()},returns:v.null(),handler:async(ctx,a)=>{
 const p=await profile(ctx,await user(ctx));if(!p)throw new Error('Create a profile first');if(a.expertise.length>8)throw new Error('Use at most 8 expertise tags');
 const avatar=a.avatar?.trim();if(avatar&&(avatar.length>500||!/^https:\/\//.test(avatar)))throw new Error('Avatar must be an HTTPS image URL');
 await ctx.db.patch(p._id,{...(a.bio!==undefined?{bio:text(a.bio,0,400,'Bio')}:{}),displayName:text(a.displayName,1,60,'Name'),avatar:avatar||undefined,expertise:a.expertise.map(t=>text(t,1,30,'Tag')),available:a.available});return null;
}});
export const feed=query({args:{},returns:v.any(),handler:async ctx=>{
 // Public feed deliberately excludes private requests and session/room assignments.
 const rows=await ctx.db.query('requests').withIndex('by_status_and_recipient',q=>q.eq('status','pending').eq('recipient',undefined)).order('desc').take(100);
 return Promise.all(rows.filter(r=>!r.recipient).map(async r=>({requestId:r._id,title:r.title,description:r.description,category:r.category,status:r.status,requester:r.requester,requesterAvatar:(await profile(ctx,r.requester))?.avatar??null,requesterName:(await profile(ctx,r.requester))?.displayName??'GHOST user',createdAt:r._creationTime})));
}});
export const helpers=query({args:{},returns:v.any(),handler:async ctx=>{
 await user(ctx);const online=await presence.listRoom(ctx,'community',true,100);const list=await Promise.all(online.map(o=>profile(ctx,o.userId as Id<'users'>)));
 return list.filter(p=>p&&p.available&&!p.activeSession).map(p=>({userId:p!.userId,displayName:p!.displayName,avatar:p!.avatar??null,expertise:p!.expertise,bio:p!.bio??'',username:p!.username??null,peopleHelped:p!.peopleHelped??0,helpSessions:p!.helpSessions??0,ratingCount:p!.ratingCount??0,rating:p!.ratingCount?(p!.ratingTotal??0)/p!.ratingCount:null}));
}});
export const activity=query({args:{},returns:v.any(),handler:async ctx=>{
 const uid=await user(ctx);const groups=await Promise.all([ctx.db.query('requests').withIndex('by_requester',q=>q.eq('requester',uid)).order('desc').take(50),ctx.db.query('requests').withIndex('by_recipient',q=>q.eq('recipient',uid)).order('desc').take(50),ctx.db.query('requests').withIndex('by_helper',q=>q.eq('helper',uid)).order('desc').take(50)]);
 const rows=[...new Map(groups.flat().map(r=>[r._id,r])).values()].sort((a,b)=>b._creationTime-a._creationTime);return Promise.all(rows.map(r=>decorate(ctx,r)));
}});
export const notifications=query({args:{},returns:v.any(),handler:async ctx=>{const uid=await user(ctx);return ctx.db.query('notifications').withIndex('by_userId',q=>q.eq('userId',uid)).order('desc').take(30);}});
export const readNotifications=mutation({args:{},returns:v.null(),handler:async ctx=>{const uid=await user(ctx);for(const n of await ctx.db.query('notifications').withIndex('by_userId',q=>q.eq('userId',uid)).order('desc').take(100))if(!n.read)await ctx.db.patch(n._id,{read:true});return null;}});
export const createRequest=mutation({args:{title:v.string(),description:v.string(),category:v.string(),recipient:v.optional(v.id('users'))},returns:v.id('requests'),handler:async(ctx,a)=>{
 const uid=await user(ctx),p=await profile(ctx,uid);if(!p)throw new Error('Complete your profile first');if(p.activeSession)throw new Error('End your active session first');if(a.recipient===uid)throw new Error('You cannot request yourself');
 const existing=await ctx.db.query('requests').withIndex('by_requester_and_status',q=>q.eq('requester',uid).eq('status','pending')).take(5);if(existing.length>=5)throw new Error('Keep at most five pending requests');
 if(a.recipient){const helper=await profile(ctx,a.recipient),online=await presence.listUser(ctx,a.recipient,true,1);if(!helper?.available||helper.activeSession||!online.length)throw new Error('This helper is no longer available');}
 const id=await ctx.db.insert('requests',{requester:uid,...(a.recipient?{recipient:a.recipient}:{}),title:text(a.title,3,100,'Title'),description:text(a.description,5,1000,'Description'),category:text(a.category,2,40,'Category'),status:'pending',updatedAt:Date.now()});
 const targets=a.recipient?[a.recipient]:(await presence.listRoom(ctx,'community',true,100)).map(o=>o.userId as Id<'users'>);
 for(const target of targets){if(target===uid)continue;const helper=await profile(ctx,target);if(helper?.available&&!helper.activeSession)await notify(ctx,target,id,a.recipient?`${p.displayName} requested your help.`:`New help request: ${a.title.slice(0,100)}`);}
 await ctx.scheduler.runAfter(30*60_000,internal.community.expireRequest,{id});return id;
}});
export const accept=mutation({args:{id:v.id('requests')},returns:v.id('sessions'),handler:async(ctx,{id})=>{
 const uid=await user(ctx),r=await ctx.db.get(id);if(!r||r.status!=='pending')throw new Error('This request is no longer pending');if(r.requester===uid)throw new Error('You cannot accept your own request');if(r.recipient&&r.recipient!==uid)throw new Error('This request is private');
 const helper=await profile(ctx,uid),requester=await profile(ctx,r.requester);if(!helper?.available||helper.activeSession||requester?.activeSession)throw new Error('One participant is busy or unavailable');
 if(!(await presence.listUser(ctx,uid,true,1)).length)throw new Error('Reconnect to Community before accepting');
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let roomCode='';do{roomCode='Z'+Array.from({length:5},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');}while(await ctx.db.query('sessions').withIndex('by_roomCode',q=>q.eq('roomCode',roomCode)).first());
 const cid=await conversation(ctx,r.requester,uid);
 const sid=await ctx.db.insert('sessions',{conversationId:cid,inviteStatus:'pending',inviter:uid,requestId:id,requester:r.requester,helper:uid,roomCode,status:'accepted',updatedAt:Date.now()});
 await ctx.db.patch(id,{status:'accepted',helper:uid,sessionId:sid,updatedAt:Date.now()});
 for(const p of [helper,requester])if(p)await ctx.db.patch(p._id,{activeSession:sid});
 await addMessage(ctx,cid,uid,"Hey, I'm here to help! Want to join my call?",sid);
 await notify(ctx,r.requester,id,`${helper.displayName} offered to help. Open Messages to accept their call invitation.`);await notify(ctx,uid,id,'Help offered. Waiting for your call invitation to be accepted.');
 await ctx.scheduler.runAfter(30*60_000,internal.community.expireUnjoined,{id:sid});return sid;
}});
export const changeRequest=mutation({args:{id:v.id('requests'),decision:v.union(v.literal('cancelled'),v.literal('declined'))},returns:v.null(),handler:async(ctx,a)=>{
 const uid=await user(ctx),r=await ctx.db.get(a.id);if(!r||r.status!=='pending')throw new Error('Request is no longer pending');if(a.decision==='cancelled'?r.requester!==uid:r.recipient!==uid)throw new Error('Not authorized');await ctx.db.patch(r._id,{status:a.decision,updatedAt:Date.now()});await notify(ctx,r.requester,r._id,a.decision==='declined'?'Your direct request was declined.':'Your request was cancelled.');if(r.recipient&&r.recipient!==uid)await notify(ctx,r.recipient,r._id,'The requester cancelled this request.');return null;
}});
export const authorize=query({args:{id:v.id('sessions')},returns:v.any(),handler:async(ctx,{id})=>{const {uid,s}=await authorized(ctx,id);if(!active(s.status))throw new Error('Session has ended');if(s.inviteStatus&&s.inviteStatus!=='accepted')throw new Error('Call invitation has not been accepted');return {userId:uid,roomCode:s.roomCode,sessionId:s._id};}});
export const connected=mutation({args:{id:v.id('sessions')},returns:v.null(),handler:async(ctx,{id})=>{const {s}=await authorized(ctx,id);if(!active(s.status))throw new Error('Session ended');if(s.inviteStatus&&s.inviteStatus!=='accepted')throw new Error('Call invitation has not been accepted');await ctx.db.patch(id,{status:'in_session',startedAt:s.startedAt??Date.now(),updatedAt:Date.now(),disconnectedAt:undefined});await ctx.db.patch(s.requestId,{status:'in_session',updatedAt:Date.now()});return null;}});
export const complete=mutation({args:{id:v.id('sessions')},returns:v.null(),handler:async(ctx,{id})=>{const {s}=await authorized(ctx,id);await release(ctx,s,'completed');return null;}});
export const disconnected=mutation({args:{id:v.id('sessions')},returns:v.null(),handler:async(ctx,{id})=>{const {s}=await authorized(ctx,id);if(active(s.status)){const at=Date.now();await ctx.db.patch(id,{disconnectedAt:at});await ctx.scheduler.runAfter(60_000,internal.community.expireDisconnected,{id,at});}return null;}});
export const expireDisconnected=internalMutation({args:{id:v.id('sessions'),at:v.number()},returns:v.null(),handler:async(ctx,{id,at})=>{const s=await ctx.db.get(id);if(s&&s.disconnectedAt===at)await release(ctx,s,'expired');return null;}});
export const expireUnjoined=internalMutation({args:{id:v.id('sessions')},returns:v.null(),handler:async(ctx,{id})=>{const s=await ctx.db.get(id);if(s?.status==='accepted')await release(ctx,s,'expired');return null;}});
export const expireRequest=internalMutation({args:{id:v.id('requests')},returns:v.null(),handler:async(ctx,{id})=>{const r=await ctx.db.get(id);if(r?.status==='pending')await ctx.db.patch(id,{status:'expired',updatedAt:Date.now()});return null;}});
