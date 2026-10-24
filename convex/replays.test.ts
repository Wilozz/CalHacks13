/// <reference types="vite/client" />
import {describe,it,expect} from 'vitest';
import {convexTest} from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import schema from './schema';
import {api} from './_generated/api';
import {TOSS_OBJECTS} from '../src/throw/toss';
import {encodeReplay,Recorder} from '../src/replay/log';
const modules=import.meta.glob('./**/*.ts');
const owner='a'.repeat(32),other='b'.repeat(32);
const log=encodeReplay(new Recorder(0,{...TOSS_OBJECTS.mug,aspect:4/3}).finish(2500));
describe('replays',()=>{
 it('saves a valid log, lists it live for its owner only, and deletes it with its file',async()=>{
  const t=convexTest(schema,modules);presenceTest.register(t);
  const storageId=await t.run(ctx=>ctx.storage.store(new Blob([log])));
  const id=await t.action(api.replays.save,{storageId,name:'  How to open it  ',ownerKey:owner});
  const list=await t.query(api.replays.list,{ownerKey:owner});
  expect(list.map(r=>[r.name,r.label,r.durationMs])).toEqual([['How to open it','Mug',2500]]);
  expect(await t.query(api.replays.list,{ownerKey:other})).toEqual([]);
  expect(await t.query(api.replays.get,{id,ownerKey:other})).toBeNull();
  expect((await t.query(api.replays.get,{id,ownerKey:owner}))?.url).toBeTruthy();
  await expect(t.mutation(api.replays.rename,{id,name:'mine now',ownerKey:other})).rejects.toThrow();
  await t.mutation(api.replays.rename,{id,name:'  Opening the cap ',ownerKey:owner});
  expect((await t.query(api.replays.get,{id,ownerKey:owner}))?.name).toBe('Opening the cap');
  await expect(t.mutation(api.replays.remove,{id,ownerKey:other})).rejects.toThrow();
  await t.mutation(api.replays.remove,{id,ownerKey:owner});
  expect(await t.query(api.replays.list,{ownerKey:owner})).toEqual([]);
  expect(await t.run(ctx=>ctx.storage.get(storageId))).toBeNull();
 });
 it('refuses and deletes an upload that is not a replay',async()=>{
  const t=convexTest(schema,modules);presenceTest.register(t);
  const storageId=await t.run(ctx=>ctx.storage.store(new Blob(['{"v":1,"h":"nope"}'])));
  await expect(t.action(api.replays.save,{storageId,name:'x',ownerKey:owner})).rejects.toThrow(/valid/);
  expect(await t.run(ctx=>ctx.storage.get(storageId))).toBeNull();
 });
});
