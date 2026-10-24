import {getAuthUserId} from '@convex-dev/auth/server';
import type {MutationCtx,QueryCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
export async function currentUser(ctx:MutationCtx|QueryCtx){const id=await getAuthUserId(ctx);if(!id)throw new Error('Sign in first');return id;}
export const pair=(a:Id<'users'>,b:Id<'users'>)=>a<b?{a,b}:{a:b,b:a};
export async function conversation(ctx:MutationCtx,a:Id<'users'>,b:Id<'users'>){const p=pair(a,b),existing=await ctx.db.query('conversations').withIndex('by_a_and_b',q=>q.eq('a',p.a).eq('b',p.b)).unique();return existing?existing._id:ctx.db.insert('conversations',{...p,updatedAt:Date.now()});}
export async function member(ctx:QueryCtx|MutationCtx,id:Id<'conversations'>){const uid=await currentUser(ctx),c=await ctx.db.get(id);if(!c||(c.a!==uid&&c.b!==uid))throw new Error('Not a conversation participant');return {uid,c};}
export async function addMessage(ctx:MutationCtx,conversationId:Id<'conversations'>,sender:Id<'users'>,body:string,sessionId?:Id<'sessions'>){await ctx.db.insert('messages',{conversationId,sender,body,...(sessionId?{sessionId}:{})});await ctx.db.patch(conversationId,{updatedAt:Date.now()});}
export async function publicProfile(ctx:QueryCtx|MutationCtx,uid:Id<'users'>){const p=await ctx.db.query('profiles').withIndex('by_userId',q=>q.eq('userId',uid)).unique();return {userId:uid,displayName:p?.displayName??'GHOST user',username:p?.username??null,avatar:p?.avatar??null};}
