import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FocusRequest, FocusResult } from '../ai/client';
import type { SceneObject } from '../ai/types';
import { VoiceAgent } from './agent';
import type { FocusDecision } from './referent';

const obj = (objectId: string, label: string): SceneObject => ({ objectId, label, bbox: [0, 0, 1, 1], affordances: [], confidence: 1, seenAt: 0 });
const scene = [obj('bottle', 'water bottle'), obj('phone', 'phone'), obj('box', 'cardboard box')];

function setup(resolve: (r: FocusRequest) => Promise<FocusResult> = async () => ({ objectId: null, confidence: 0, reason: '', topic: '' })) {
  let t = 0; const focus: FocusDecision[] = []; const topics: string[] = []; const calls: FocusRequest[] = []; let objects = scene;
  const agent = new VoiceAgent({
    now: () => t, getObjects: () => objects,
    client: {
      resolveFocus: async r => { calls.push(r); return resolve(r); },
      summarize: async i => ({ taskSummary: `summary of ${i.turns.length} turns`, mentionedObjects: [], currentStep: '', language: 'en', updatedAt: 0 }),
    },
    onFocus: d => focus.push(d), onTopic: x => topics.push(x), summaryEveryMs: 10_000,
  });
  return { agent, focus, topics, calls, advance: (ms: number) => { t += ms; }, setObjects: (o: SceneObject[]) => { objects = o; }, now: () => t };
}
const settle = () => new Promise(r => setTimeout(r, 5));

test('three objects in view: talking about one focuses it instantly with no Claude call', async () => {
  const s = setup();
  s.agent.hear('me', 'the cap on this water bottle is really stuck');
  s.agent.tick();
  assert.equal(s.focus.at(-1)!.objectId, 'bottle'); assert.equal(s.focus.at(-1)!.source, 'voice');
  assert.equal(s.calls.length, 0);
});

test('the friend\'s words count too, and the object stays remembered with no pointing', async () => {
  const s = setup();
  s.agent.hear('friend', 'can you grab the phone');
  s.agent.tick(); s.advance(90_000);
  assert.equal(s.agent.tick().objectId, 'phone');
});

test('then pointing at something takes over', async () => {
  const s = setup();
  s.agent.hear('me', 'look at the phone'); s.agent.tick(); s.advance(1000);
  for (let i = 0; i < 6; i++) { s.agent.point('box'); s.advance(100); }
  const d = s.agent.tick();
  assert.equal(d.objectId, 'box'); assert.equal(d.source, 'point');
  assert.equal(s.focus.at(-1)!.objectId, 'box');
});

test('pronouns do not change anything and do not cost a Claude call', async () => {
  const s = setup();
  s.agent.hear('me', 'the water bottle'); s.agent.tick(); s.advance(1000);
  s.agent.hear('me', 'ok slide it open');
  assert.equal(s.agent.tick().objectId, 'bottle'); assert.equal(s.calls.length, 0);
});

test('descriptions that name nothing known go to Claude, which sees the conversation and the visible objects', async () => {
  const s = setup(async () => ({ objectId: 'phone', confidence: 0.8, reason: 'has a screen', topic: 'Fixing a phone' }));
  s.agent.hear('friend', 'I am trying to unlock it'); await settle();
  s.advance(600);
  s.agent.hear('me', 'what about the thing with the screen'); await settle();
  assert.equal(s.calls.length >= 1, true);
  const req = s.calls.at(-1)!;
  assert.deepEqual(req.objects.map(o => o.objectId), ['bottle', 'phone', 'box']);
  assert.ok(req.recent.some(t => t.text.includes('unlock')));
  s.advance(600);
  assert.equal(s.agent.tick().objectId, 'phone');
  assert.deepEqual(s.topics, ['Fixing a phone']);
});

test('ambiguous sentences ask Claude, and its answer wins over the local guess', async () => {
  const s = setup(async () => ({ objectId: 'box', confidence: 0.9, reason: 'the box is what is being filled', topic: '' }));
  s.agent.hear('me', 'put the phone in the box'); s.agent.tick();
  assert.equal(s.focus.at(-1)!.objectId !== null, true);            // instant local guess first
  await settle(); s.advance(700);
  assert.equal(s.agent.tick().objectId, 'box');
});

test('small talk does not change focus; Claude saying "none" is respected', async () => {
  const s = setup();
  s.agent.hear('me', 'the water bottle'); s.agent.tick(); s.advance(1000);
  s.agent.hear('friend', 'did you see the game last night'); await settle();
  assert.equal(s.agent.tick().objectId, 'bottle');
});

test('a slow answer to an old sentence cannot override a newer one', async () => {
  let n = 0;
  const s = setup(r => new Promise(res => { const mine = ++n; setTimeout(() => res(mine === 1 ? { objectId: 'box', confidence: 0.9, reason: '', topic: '' } : { objectId: 'phone', confidence: 0.9, reason: '', topic: '' }), mine === 1 ? 40 : 5); }));
  s.agent.hear('me', 'what is that thing over there'); s.agent.hear('me', 'no the one with the screen'); await new Promise(r => setTimeout(r, 80));
  s.advance(700);
  assert.equal(s.agent.tick().objectId, 'phone');
});

test('Claude failing is harmless; with nothing scanned yet, speech is only logged', async () => {
  const s = setup(async () => { throw new Error('offline'); });
  s.agent.hear('me', 'what about the thing with the screen'); await settle();
  assert.equal(s.agent.tick().objectId, null);
  s.setObjects([]);
  s.agent.hear('me', 'the phone is dead'); assert.equal(s.agent.tick().objectId, null); assert.equal(s.agent.log.length, 2);
});

test('the conversation is summarized as it goes', async () => {
  const s = setup();
  s.agent.hear('me', 'the water bottle'); s.advance(11_000); s.agent.hear('friend', 'I will open it'); await settle();
  assert.match(s.agent.topic, /summary of 2 turns/); assert.ok(s.agent.summary);
});
