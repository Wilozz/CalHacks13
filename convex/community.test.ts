/// <reference types="vite/client" />
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import schema from './schema';
import {api,internal} from './_generated/api';
const modules=import.meta.glob('./**/*.ts');
beforeEach(()=>vi.useFakeTimers());afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
async function setup(){
 const t=convexTest(schema,modules);presenceTest.register(t);
 async function member(name:string){
  const id=await t.run(ctx=>ctx.db.insert('users',{name,email:`${name}@test.invalid`}));
  const client=t.withIdentity({subject:`${id}|session`,issuer:'http://localhost:3211',tokenIdentifier:`http://localhost:3211|${id}|session`});
  await client.mutation(api.community.ensureProfile,{});
  await client.mutation(api.community.saveProfile,{displayName:name,expertise:['Repairs'],available:true});
  await client.mutation(api.presence.heartbeat,{roomId:'community',userId:id,sessionId:name,interval:10000});
  return {id,client};
 }
 const a=await member('Requester'),b=await member('Helper'),c=await member('Other');
 return {t,a,b,c};
}
const request={title:'Fix a loose handle',description:'The cabinet handle is loose and I need help tightening it.',category:'Home repair'};
describe('Community authorization and lifecycle',()=>{
 it('requires authenticated mutations, prevents profile impersonation and presence spoofing',async()=>{
  const {t,a,b}=await setup();await expect(t.mutation(api.community.createRequest,request)).rejects.toThrow('Sign in');
  await expect(a.client.mutation(api.presence.heartbeat,{roomId:'community',userId:b.id,sessionId:'spoof',interval:1})).rejects.toThrow('Unauthorized');
  const helpers=await a.client.query(api.community.helpers,{});expect(helpers.length).toBe(3);expect(helpers[0]).not.toHaveProperty('email');
 });
 it('creates public requests, notifies helpers, accepts exactly once and never leaks the room',async()=>{
  const {t,a,b,c}=await setup();const id=await a.client.mutation(api.community.createRequest,request);
  expect((await b.client.query(api.community.notifications,{})).length).toBe(1);
  await expect(a.client.mutation(api.community.accept,{id})).rejects.toThrow('own');
  const sid=await b.client.mutation(api.community.accept,{id});
  await expect(c.client.mutation(api.community.accept,{id})).rejects.toThrow('no longer pending');
  await expect(a.client.query(api.community.authorize,{id:sid})).rejects.toThrow('not been accepted');
  await a.client.mutation(api.social.respondInvite,{id:sid,accept:true});
  const assignment=await a.client.query(api.community.authorize,{id:sid});expect(assignment.roomCode).toMatch(/^Z[A-HJ-NP-Z2-9]{5}$/);
  await expect(c.client.query(api.community.authorize,{id:sid})).rejects.toThrow('participant');
  for(const fn of [api.community.connected,api.community.complete,api.community.disconnected])await expect(c.client.mutation(fn,{id:sid})).rejects.toThrow('participant');
  await expect(t.query(api.community.authorize,{id:sid})).rejects.toThrow('Sign in');
  expect(await t.query(api.community.feed,{})).toEqual([]);
  expect((await a.client.query(api.community.activity,{}))[0]).not.toHaveProperty('roomCode');
  expect((await a.client.query(api.community.viewer,{})).activeSession).toBe(sid);
  await b.client.mutation(api.community.connected,{id:sid});expect((await a.client.query(api.community.activity,{}))[0].status).toBe('in_session');
  await a.client.mutation(api.community.complete,{id:sid});await b.client.mutation(api.community.complete,{id:sid});
  expect((await b.client.query(api.community.viewer,{})).activeSession).toBeUndefined();
  expect((await a.client.query(api.community.activity,{}))[0].status).toBe('completed');
  await expect(b.client.query(api.community.authorize,{id:sid})).rejects.toThrow('ended');
 });
 it('protects private requests; supports decline, cancellation and expiry',async()=>{
  const {t,a,b,c}=await setup();let id=await a.client.mutation(api.community.createRequest,{...request,recipient:b.id});
  expect(await t.query(api.community.feed,{})).toEqual([]);expect(await c.client.query(api.community.activity,{})).toEqual([]);
  await expect(c.client.mutation(api.community.accept,{id})).rejects.toThrow('private');
  await expect(c.client.mutation(api.community.changeRequest,{id,decision:'declined'})).rejects.toThrow('authorized');
  await b.client.mutation(api.community.changeRequest,{id,decision:'declined'});
  id=await a.client.mutation(api.community.createRequest,request);await a.client.mutation(api.community.changeRequest,{id,decision:'cancelled'});
  id=await a.client.mutation(api.community.createRequest,request);await t.mutation(internal.community.expireRequest,{id});
  expect((await a.client.query(api.community.activity,{})).map((r:any)=>r.status)).toEqual(expect.arrayContaining(['declined','cancelled','expired']));
 });
 it('blocks accepting another session while busy and handles disconnect grace and reconnect',async()=>{
  const {t,a,b,c}=await setup();const id=await a.client.mutation(api.community.createRequest,request);const sid=await b.client.mutation(api.community.accept,{id});
  const other=await c.client.mutation(api.community.createRequest,request);await expect(b.client.mutation(api.community.accept,{id:other})).rejects.toThrow('busy');
  await a.client.mutation(api.social.respondInvite,{id:sid,accept:true});await b.client.mutation(api.community.connected,{id:sid});await b.client.mutation(api.community.disconnected,{id:sid});
  const record=await t.run(ctx=>ctx.db.get(sid));await a.client.mutation(api.community.connected,{id:sid});
  await t.mutation(internal.community.expireDisconnected,{id:sid,at:record!.disconnectedAt!});
  expect((await a.client.query(api.community.authorize,{id:sid})).roomCode).toBeTruthy();
  await b.client.mutation(api.community.disconnected,{id:sid});const r=await t.run(ctx=>ctx.db.get(sid));await t.mutation(internal.community.expireDisconnected,{id:sid,at:r!.disconnectedAt!});
  await expect(a.client.query(api.community.authorize,{id:sid})).rejects.toThrow('ended');
 });
 it('validates input lengths and profile ownership while allowing bounded profile edits',async()=>{
  const {a,b}=await setup();await expect(a.client.mutation(api.community.createRequest,{...request,title:'x'})).rejects.toThrow('Title');
  await expect(a.client.mutation(api.community.saveProfile,{displayName:'A',expertise:[],available:true,avatar:'javascript:alert(1)'})).rejects.toThrow('HTTPS');
  await a.client.mutation(api.community.saveProfile,{displayName:'New name',expertise:['DIY'],available:false});
  expect((await b.client.query(api.community.viewer,{})).displayName).toBe('Helper');
 });
});
it('concurrent helpers cannot assign the same request twice',async()=>{
 const {a,b,c,t}=await setup();const id=await a.client.mutation(api.community.createRequest,request);
 const results=await Promise.allSettled([b.client.mutation(api.community.accept,{id}),c.client.mutation(api.community.accept,{id})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const stored=await t.run(ctx=>ctx.db.get(id));expect(stored!.status).toBe('accepted');
});
it('presence supports multiple tabs and removes helpers after all sessions disconnect',async()=>{
 const {a,b}=await setup();
 const first=await b.client.mutation(api.presence.heartbeat,{roomId:'community',userId:b.id,sessionId:'Helper',interval:10000});
 const second=await b.client.mutation(api.presence.heartbeat,{roomId:'community',userId:b.id,sessionId:'another-tab',interval:10000});
 await b.client.mutation(api.presence.disconnect,{sessionToken:first.sessionToken});
 expect((await a.client.query(api.community.helpers,{})).some((p:any)=>p.userId===b.id)).toBe(true);
 await b.client.mutation(api.presence.disconnect,{sessionToken:second.sessionToken});
 expect((await a.client.query(api.community.helpers,{})).some((p:any)=>p.userId===b.id)).toBe(false);
});

it('help offers create private DMs and require recipient consent before signaling',async()=>{
 const {t,a,b,c}=await setup();const rid=await a.client.mutation(api.community.createRequest,request),sid=await b.client.mutation(api.community.accept,{id:rid});
 const cid=await b.client.mutation(api.social.conversationForSession,{id:sid});
 const messages=await a.client.query(api.social.messages,{id:cid});expect(messages[0].body).toBe("Hey, I'm here to help! Want to join my call?");
 await expect(c.client.query(api.social.messages,{id:cid})).rejects.toThrow('participant');await expect(c.client.mutation(api.social.send,{id:cid,body:'intrusion'})).rejects.toThrow('participant');
 await expect(b.client.mutation(api.social.respondInvite,{id:sid,accept:true})).rejects.toThrow('incoming');
 await expect(b.client.mutation(api.community.connected,{id:sid})).rejects.toThrow('not been accepted');
 await a.client.mutation(api.social.send,{id:cid,body:'Thanks, let’s connect.'});expect((await b.client.query(api.social.messages,{id:cid})).length).toBe(2);
 await a.client.mutation(api.social.respondInvite,{id:sid,accept:false});await expect(b.client.query(api.community.authorize,{id:sid})).rejects.toThrow('ended');
 expect((await b.client.query(api.community.viewer,{})).activeSession).toBeUndefined();expect((await a.client.query(api.community.viewer,{})).activeSession).toBeUndefined();
 await expect(t.query(api.social.inbox,{})).rejects.toThrow('Sign in');
});
it('unique usernames, friend requests, private messages and friend calls enforce membership',async()=>{
 const {a,b,c}=await setup();await a.client.mutation(api.social.setUsername,{username:'Hetarth'});await b.client.mutation(api.social.setUsername,{username:'wilson'});
 await expect(c.client.mutation(api.social.setUsername,{username:'WILSON'})).rejects.toThrow('taken');await expect(c.client.mutation(api.social.setUsername,{username:'x'})).rejects.toThrow('3–24');
 const found=await a.client.query(api.social.search,{username:'wi'});expect(found[0]).toMatchObject({username:'wilson'});expect(found[0]).not.toHaveProperty('email');
 await a.client.mutation(api.social.addFriend,{userId:b.id});await expect(b.client.mutation(api.social.addFriend,{userId:a.id})).rejects.toThrow('exists');
 const f=(await b.client.query(api.social.friends,{}))[0];await expect(a.client.mutation(api.social.respondFriend,{id:f._id,accept:true})).rejects.toThrow('incoming');await expect(c.client.mutation(api.social.respondFriend,{id:f._id,accept:true})).rejects.toThrow('incoming');
 await b.client.mutation(api.social.respondFriend,{id:f._id,accept:true});const cid=(await a.client.query(api.social.inbox,{}))[0]._id;
 await expect(c.client.mutation(api.social.invite,{id:cid})).rejects.toThrow('participant');
 const sid=await a.client.mutation(api.social.invite,{id:cid});await expect(a.client.query(api.community.authorize,{id:sid})).rejects.toThrow('not been accepted');
 await b.client.mutation(api.social.respondInvite,{id:sid,accept:true});await expect(b.client.mutation(api.social.respondInvite,{id:sid,accept:true})).rejects.toThrow('no longer pending');
 expect((await a.client.query(api.community.authorize,{id:sid})).roomCode).toMatch(/^Z/);await a.client.mutation(api.community.complete,{id:sid});
 expect((await b.client.query(api.community.viewer,{})).activeSession).toBeUndefined();
});

it('member profiles reveal only public data; only completed help calls build stats and ratings',async()=>{
 const {t,a,b,c}=await setup();await b.client.mutation(api.community.saveProfile,{displayName:'Helper',bio:'I fix furniture.',expertise:['Furniture'],available:true});
 const publicData=await a.client.query(api.profiles.get,{userId:b.id});expect(publicData.bio).toBe('I fix furniture.');for(const field of ['email','activeSession','roomCode','ratingTotal'])expect(publicData).not.toHaveProperty(field);
 await expect(t.query(api.profiles.get,{userId:b.id})).rejects.toThrow('Sign in');expect(publicData.rating).toBeNull();
 let id=await a.client.mutation(api.community.createRequest,request),sid=await b.client.mutation(api.community.accept,{id});await a.client.mutation(api.community.complete,{id:sid});
 expect((await a.client.query(api.profiles.get,{userId:b.id})).helpSessions).toBe(0);await expect(a.client.mutation(api.profiles.rate,{sessionId:sid,rating:5})).rejects.toThrow('Complete a help call');
 id=await a.client.mutation(api.community.createRequest,request);sid=await b.client.mutation(api.community.accept,{id});await a.client.mutation(api.social.respondInvite,{id:sid,accept:true});await b.client.mutation(api.community.connected,{id:sid});await a.client.mutation(api.community.complete,{id:sid});await b.client.mutation(api.community.complete,{id:sid});
 await expect(c.client.mutation(api.profiles.rate,{sessionId:sid,rating:5})).rejects.toThrow('Only the requester');await expect(b.client.mutation(api.profiles.rate,{sessionId:sid,rating:5})).rejects.toThrow('Only the requester');await expect(a.client.mutation(api.profiles.rate,{sessionId:sid,rating:7})).rejects.toThrow('1 to 5');
 await a.client.mutation(api.profiles.rate,{sessionId:sid,rating:4});await expect(a.client.mutation(api.profiles.rate,{sessionId:sid,rating:5})).rejects.toThrow('already rated');let p=await a.client.query(api.profiles.get,{userId:b.id});expect(p).toMatchObject({rating:4,ratingCount:1,peopleHelped:1,helpSessions:1});
 id=await a.client.mutation(api.community.createRequest,request);sid=await b.client.mutation(api.community.accept,{id});await a.client.mutation(api.social.respondInvite,{id:sid,accept:true});await b.client.mutation(api.community.connected,{id:sid});await a.client.mutation(api.community.complete,{id:sid});p=await a.client.query(api.profiles.get,{userId:b.id});expect(p).toMatchObject({peopleHelped:1,helpSessions:2});
});
it('friend calls do not count as help sessions or allow helper reviews',async()=>{
 const {a,b}=await setup();await a.client.mutation(api.social.addFriend,{userId:b.id});const f=(await b.client.query(api.social.friends,{}))[0];await b.client.mutation(api.social.respondFriend,{id:f._id,accept:true});const cid=(await a.client.query(api.social.inbox,{}))[0]._id;const sid=await a.client.mutation(api.social.invite,{id:cid});await b.client.mutation(api.social.respondInvite,{id:sid,accept:true});await a.client.mutation(api.community.connected,{id:sid});await a.client.mutation(api.community.complete,{id:sid});expect((await b.client.query(api.profiles.get,{userId:a.id})).helpSessions).toBe(0);await expect(b.client.mutation(api.profiles.rate,{sessionId:sid,rating:5})).rejects.toThrow('Complete a help call');
});

it('automatically assigns searchable usernames and backfills old profiles without overwriting handles',async()=>{
 const {t,a,b,c}=await setup();expect((await b.client.query(api.community.viewer,{})).username).toBe('helper');expect((await a.client.query(api.social.search,{username:' @HeLpEr '}))[0].userId).toBe(b.id);
 await c.client.mutation(api.social.setUsername,{username:'@custom_handle'});const p=await b.client.query(api.community.viewer,{});await t.run(ctx=>ctx.db.patch(p._id,{username:undefined}));await t.mutation(internal.social.backfillUsernames,{});expect((await b.client.query(api.community.viewer,{})).username).toBe('helper');expect((await c.client.query(api.community.viewer,{})).username).toBe('custom_handle');
 const id=await t.run(ctx=>ctx.db.insert('users',{name:'Helper'}));const duplicate=t.withIdentity({subject:`${id}|session`});await duplicate.mutation(api.community.ensureProfile,{});expect((await duplicate.query(api.community.viewer,{})).username).not.toBe('helper');
 expect(await a.client.query(api.social.search,{username:'@missing_user'})).toEqual([]);await a.client.mutation(api.social.addFriend,{userId:b.id});const incoming=(await b.client.query(api.social.friends,{}))[0];expect(incoming.sender).toBe(a.id);await b.client.mutation(api.social.respondFriend,{id:incoming._id,accept:false});expect(await a.client.query(api.social.friends,{})).toEqual([]);
});
