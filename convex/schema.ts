import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { authTables } from '@convex-dev/auth/server';
export const state=v.union(...(['pending','accepted','in_session','completed','declined','cancelled','expired'] as const).map(v.literal));
export default defineSchema({
 ...authTables,
 reviews:defineTable({sessionId:v.id('sessions'),reviewer:v.id('users'),helper:v.id('users'),rating:v.number()}).index('by_sessionId',['sessionId']),
 helpedPairs:defineTable({helper:v.id('users'),requester:v.id('users')}).index('by_helper_and_requester',['helper','requester']),
 friendships:defineTable({a:v.id('users'),b:v.id('users'),sender:v.id('users'),status:v.union(v.literal('pending'),v.literal('accepted'))}).index('by_a',['a']).index('by_b',['b']).index('by_a_and_b',['a','b']),
 conversations:defineTable({a:v.id('users'),b:v.id('users'),updatedAt:v.number()}).index('by_a',['a']).index('by_b',['b']).index('by_a_and_b',['a','b']),
 messages:defineTable({conversationId:v.id('conversations'),sender:v.id('users'),body:v.string(),sessionId:v.optional(v.id('sessions'))}).index('by_conversationId',['conversationId']),
 profiles:defineTable({userId:v.id('users'),bio:v.optional(v.string()),peopleHelped:v.optional(v.number()),helpSessions:v.optional(v.number()),ratingTotal:v.optional(v.number()),ratingCount:v.optional(v.number()),displayName:v.string(),username:v.optional(v.string()),avatar:v.optional(v.string()),expertise:v.array(v.string()),available:v.boolean(),activeSession:v.optional(v.id('sessions'))}).index('by_userId',['userId']).index('by_username',['username']),
 requests:defineTable({requester:v.id('users'),recipient:v.optional(v.id('users')),helper:v.optional(v.id('users')),title:v.string(),description:v.string(),category:v.string(),status:state,sessionId:v.optional(v.id('sessions')),updatedAt:v.number()})
 .index('by_status',['status']).index('by_status_and_recipient',['status','recipient']).index('by_requester_and_status',['requester','status']).index('by_requester',['requester']).index('by_recipient',['recipient']).index('by_helper',['helper']),
 sessions:defineTable({startedAt:v.optional(v.number()),conversationId:v.optional(v.id('conversations')),inviteStatus:v.optional(v.union(v.literal('pending'),v.literal('accepted'),v.literal('declined'))),inviter:v.optional(v.id('users')),requestId:v.id('requests'),requester:v.id('users'),helper:v.id('users'),roomCode:v.string(),status:v.union(v.literal('accepted'),v.literal('in_session'),v.literal('completed'),v.literal('expired')),updatedAt:v.number(),endedAt:v.optional(v.number()),disconnectedAt:v.optional(v.number())}).index('by_roomCode',['roomCode']).index('by_requester',['requester']).index('by_helper',['helper']),
 notifications:defineTable({userId:v.id('users'),requestId:v.id('requests'),message:v.string(),read:v.boolean()}).index('by_userId',['userId']),
 // Saved tutorials: the 3D event log is a file (src/replay/log.ts), owned by a random browser key, not an account.
 replays:defineTable({ownerKey:v.string(),name:v.string(),label:v.string(),durationMs:v.number(),logFile:v.id('_storage')}).index('by_ownerKey',['ownerKey']).index('by_logFile',['logFile']),
});
