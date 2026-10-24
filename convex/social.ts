import {v} from 'convex/values';
import {mutation,query,internalMutation} from './_generated/server';
import {internal} from './_generated/api';
import {defaultUsername} from './usernames';
import {currentUser,pair,conversation,member,addMessage,publicProfile} from './socialHelpers';
export const setUsername=mutation({args:{username:v.string()},returns:v.null(),handler:async(ctx,{username})=>{
 const uid=await currentUser(ctx);username=username.trim().replace(/^@/,'').toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(username))throw new Error('Use 3–24 letters, numbers or underscores');
 const other=await ctx.db.query('profiles').withIndex('by_username',q=>q.eq('username',username)).unique();if(other&&other.userId!==uid)throw new Error('Username already taken');
 const p=await ctx.db.query('profiles').withIndex('by_userId',q=>q.eq('userId',uid)).unique();if(!p)throw new Error('Profile not ready');await ctx.db.patch(p._id,{username});return null;
}});
export const search=query({args:{username:v.string()},returns:v.any(),handler:async(ctx,{username})=>{
 const uid=await currentUser(ctx),prefix=username.trim().toLowerCase().replace(/^@/,'');if(!/^[a-z0-9_]{2,24}$/.test(prefix))return [];
 const rows=await ctx.db.query('profiles').withIndex('by_username',q=>q.gte('username',prefix).lt('username',prefix+'\uffff')).take(20);
 return rows.filter(p=>p.userId!==uid).sort((a,b)=>Number(b.username===prefix)-Number(a.username===prefix)).map(p=>({userId:p.userId,displayName:p.displayName,username:p.username,avatar:p.avatar??null}));
}});
export const friends=query({args:{},returns:v.any(),handler:async ctx=>{
 const uid=await currentUser(ctx),rows=(await Promise.all([ctx.db.query('friendships').withIndex('by_a',q=>q.eq('a',uid)).take(100),ctx.db.query('friendships').withIndex('by_b',q=>q.eq('b',uid)).take(100)])).flat();
 return Promise.all(rows.map(async f=>({...f,person:await publicProfile(ctx,f.a===uid?f.b:f.a)})));
}});
export const addFriend=mutation({args:{userId:v.id('users')},returns:v.null(),handler:async(ctx,{userId})=>{
 const uid=await currentUser(ctx);if(uid===userId)throw new Error('Cannot add yourself');if(!await ctx.db.get(userId))throw new Error('User not found');
 const p=pair(uid,userId),f=await ctx.db.query('friendships').withIndex('by_a_and_b',q=>q.eq('a',p.a).eq('b',p.b)).unique();if(f)throw new Error('Friend request already exists');
 await ctx.db.insert('friendships',{...p,sender:uid,status:'pending'});return null;
}});
export const respondFriend=mutation({args:{id:v.id('friendships'),accept:v.boolean()},returns:v.null(),handler:async(ctx,{id,accept})=>{
 const uid=await currentUser(ctx),f=await ctx.db.get(id);if(!f||(f.a!==uid&&f.b!==uid)||f.sender===uid||f.status!=='pending')throw new Error('Not an incoming friend request');
 if(accept){await ctx.db.patch(id,{status:'accepted'});await conversation(ctx,f.a,f.b);}else await ctx.db.delete(id);return null;
}});
export const inbox=query({args:{},returns:v.any(),handler:async ctx=>{
 const uid=await currentUser(ctx),rows=(await Promise.all([ctx.db.query('conversations').withIndex('by_a',q=>q.eq('a',uid)).take(100),ctx.db.query('conversations').withIndex('by_b',q=>q.eq('b',uid)).take(100)])).flat();
 return Promise.all(rows.sort((a,b)=>b.updatedAt-a.updatedAt).map(async c=>({...c,person:await publicProfile(ctx,c.a===uid?c.b:c.a)})));
}});
export const messages=query({args:{id:v.id('conversations')},returns:v.any(),handler:async(ctx,{id})=>{
 const {uid}=await member(ctx,id),rows=await ctx.db.query('messages').withIndex('by_conversationId',q=>q.eq('conversationId',id)).order('desc').take(100);
 return Promise.all(rows.reverse().map(async m=>{const s=m.sessionId?await ctx.db.get(m.sessionId):null;return {...m,mine:m.sender===uid,invite:s?{id:s._id,status:s.status,decision:s.inviteStatus??'accepted',incoming:s.inviter!==uid}:null};}));
}});
export const send=mutation({args:{id:v.id('conversations'),body:v.string()},returns:v.null(),handler:async(ctx,{id,body})=>{
 const {uid}=await member(ctx,id);body=body.trim();if(!body||body.length>2000)throw new Error('Message must be 1–2000 characters');await addMessage(ctx,id,uid,body);return null;
}});
export const invite=mutation({args:{id:v.id('conversations')},returns:v.id('sessions'),handler:async(ctx,{id})=>{
 const {uid,c}=await member(ctx,id),other=c.a===uid?c.b:c.a,p=pair(uid,other);
 const f=await ctx.db.query('friendships').withIndex('by_a_and_b',q=>q.eq('a',p.a).eq('b',p.b)).unique();if(f?.status!=='accepted')throw new Error('Add each other as friends first');
 const profiles=await Promise.all([uid,other].map(userId=>ctx.db.query('profiles').withIndex('by_userId',q=>q.eq('userId',userId)).unique()));if(profiles.some(p=>!p||p.activeSession))throw new Error('One participant is busy');
 const rid=await ctx.db.insert('requests',{requester:other,recipient:uid,helper:uid,title:'Friend call',description:'A direct call invitation from a friend.',category:'Friend call',status:'accepted',updatedAt:Date.now()});
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let roomCode='';do{roomCode='Z'+Array.from({length:5},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');}while(await ctx.db.query('sessions').withIndex('by_roomCode',q=>q.eq('roomCode',roomCode)).first());
 const sid=await ctx.db.insert('sessions',{requestId:rid,requester:other,helper:uid,conversationId:id,inviteStatus:'pending',inviter:uid,roomCode,status:'accepted',updatedAt:Date.now()});
 await ctx.db.insert('notifications',{userId:other,requestId:rid,message:'A friend invited you to a call. Open Messages to respond.',read:false});await ctx.db.patch(rid,{sessionId:sid});for(const p of profiles)if(p)await ctx.db.patch(p._id,{activeSession:sid});await addMessage(ctx,id,uid,'Want to join my call?',sid);
 await ctx.scheduler.runAfter(30*60_000,internal.community.expireUnjoined,{id:sid});return sid;
}});
export const respondInvite=mutation({args:{id:v.id('sessions'),accept:v.boolean()},returns:v.null(),handler:async(ctx,{id,accept})=>{
 const uid=await currentUser(ctx),s=await ctx.db.get(id);if(!s||(s.requester!==uid&&s.helper!==uid)||s.inviter===uid)throw new Error('Not an incoming call invitation');if(s.status!=='accepted'||s.inviteStatus!=='pending')throw new Error('Invitation is no longer pending');
 await ctx.db.patch(id,{inviteStatus:accept?'accepted':'declined',updatedAt:Date.now()});
 if(!accept){await ctx.db.patch(id,{status:'completed',endedAt:Date.now()});await ctx.db.patch(s.requestId,{status:'declined',updatedAt:Date.now()});for(const userId of [s.requester,s.helper]){const p=await ctx.db.query('profiles').withIndex('by_userId',q=>q.eq('userId',userId)).unique();if(p?.activeSession===id)await ctx.db.patch(p._id,{activeSession:undefined});}}
 if(s.conversationId)await addMessage(ctx,s.conversationId,uid,accept?'Call invitation accepted. Let’s connect!':'Call invitation declined.');return null;
}});
export const conversationForSession=mutation({args:{id:v.id('sessions')},returns:v.id('conversations'),handler:async(ctx,{id})=>{const uid=await currentUser(ctx),s=await ctx.db.get(id);if(!s||(s.requester!==uid&&s.helper!==uid)||!s.conversationId)throw new Error('Not a conversation participant');return s.conversationId;}});

// One-time, bounded repair for profiles created before automatic usernames existed.
export const backfillUsernames=internalMutation({args:{cursor:v.optional(v.string())},returns:v.null(),handler:async(ctx,{cursor})=>{
 const batch=await ctx.db.query('profiles').paginate({numItems:100,cursor:cursor??null});
 for(const p of batch.page)if(!p.username)await ctx.db.patch(p._id,{username:await defaultUsername(ctx,p.userId,p.displayName)});
 if(!batch.isDone)await ctx.scheduler.runAfter(0,internal.social.backfillUsernames,{cursor:batch.continueCursor});return null;
}});
