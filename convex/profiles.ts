import {v} from 'convex/values';
import {query,mutation} from './_generated/server';
import {currentUser,conversation} from './socialHelpers';
export const get=query({args:{userId:v.id('users')},returns:v.any(),handler:async(ctx,{userId})=>{
 const uid=await currentUser(ctx),p=await ctx.db.query('profiles').withIndex('by_userId',q=>q.eq('userId',userId)).unique();if(!p)return null;
 // Explicit allowlist: never expose email, auth data or private room/session assignments.
 return {userId:p.userId,displayName:p.displayName,username:p.username??null,avatar:p.avatar??null,bio:p.bio??'',expertise:p.expertise,available:p.available&&!p.activeSession,isSelf:uid===p.userId,peopleHelped:p.peopleHelped??0,helpSessions:p.helpSessions??0,ratingCount:p.ratingCount??0,rating:p.ratingCount?(p.ratingTotal??0)/p.ratingCount:null};
}});
export const message=mutation({args:{userId:v.id('users')},returns:v.id('conversations'),handler:async(ctx,{userId})=>{
 const uid=await currentUser(ctx);if(uid===userId)throw new Error('Choose another member');const p=await ctx.db.query('profiles').withIndex('by_userId',q=>q.eq('userId',userId)).unique();if(!p)throw new Error('Member not found');return conversation(ctx,uid,userId);
}});
export const rate=mutation({args:{sessionId:v.id('sessions'),rating:v.number()},returns:v.null(),handler:async(ctx,{sessionId,rating})=>{
 const uid=await currentUser(ctx),s=await ctx.db.get(sessionId);if(!s||s.requester!==uid)throw new Error('Only the requester can rate this session');
 const r=await ctx.db.get(s.requestId);if(s.status!=='completed'||s.startedAt===undefined||r?.category==='Friend call')throw new Error('Complete a help call before rating');
 if(!Number.isInteger(rating)||rating<1||rating>5)throw new Error('Choose a rating from 1 to 5');
 if(await ctx.db.query('reviews').withIndex('by_sessionId',q=>q.eq('sessionId',sessionId)).unique())throw new Error('This session is already rated');
 const p=await ctx.db.query('profiles').withIndex('by_userId',q=>q.eq('userId',s.helper)).unique();if(!p)throw new Error('Helper profile not found');
 await ctx.db.insert('reviews',{sessionId,reviewer:uid,helper:s.helper,rating});await ctx.db.patch(p._id,{ratingCount:(p.ratingCount??0)+1,ratingTotal:(p.ratingTotal??0)+rating});return null;
}});
