import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSpec, twistAngleRad } from './actionLibrary';
import type { AiClient } from './client';
import { gate, keyWordTime } from './gate';
import { HandHistory, isPointingPose } from './handHistory';
import { Orchestrator, type Outcome } from './orchestrator';
import { decide } from './policy';
import { SceneCache } from './sceneCache';
import { Transcript } from './transcript';
import type { ActionSpec, Candidate, ParseResult, SceneObject, Utterance } from './types';

const cap: SceneObject = { objectId: 'cap', label: 'bottle cap', parentLabel: 'bottle', bbox: [0.48, 0.28, 0.56, 0.34], affordances: ['twist', 'lift'], confidence: 0.9, seenAt: 10 };
const bottle: SceneObject = { objectId: 'bottle', label: 'bottle', bbox: [0.4, 0.28, 0.64, 0.9], affordances: ['lift', 'tilt'], confidence: 0.9, seenAt: 10 };
const cand = (o: SceneObject, distance = 0, inside = true): Candidate => ({ object: o, distance, inside });
const spec = (over: Partial<ActionSpec> = {}): ActionSpec => ({
  actionType: 'twist', rotationSense: 'loosen', targetLabel: 'bottle cap', targetObjectId: 'cap', targetPoint2d: null, amount: { turns: 1.5 },
  stepIndex: 1, stepCount: 1, confidence: 0.9, needsConfirmation: false, caption: 'c', captionLanguage: 'en', rationale: '', ...over,
});
const action = (s: ActionSpec): ParseResult => ({ kind: 'action', spec: s });

function pose(pointing: boolean) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  lm[6] = { x: 0.5, y: 0.6, z: 0 }; lm[8] = { x: 0.5, y: pointing ? 0.3 : 0.65, z: 0 };
  for (const [pip, tip] of [[10, 12], [14, 16], [18, 20]]) { lm[pip] = { x: 0.5, y: 0.6, z: 0 }; lm[tip] = { x: 0.5, y: 0.7, z: 0 }; }
  return lm;
}

test('sanitizeSpec rejects unknown actions and clamps amounts', () => {
  assert.equal(sanitizeSpec({ actionType: 'explode' }), null);
  const s = sanitizeSpec({ actionType: 'twist', amount: { turns: 99 }, confidence: 7 })!;
  assert.equal(s.amount.turns, 10);
  assert.equal(s.confidence, 1);
  assert.equal(sanitizeSpec({ actionType: 'press', confidence: 0.5 })!.needsConfirmation, true);
});

test('twist direction follows the standard thread rule and reverse toggle', () => {
  assert.ok(twistAngleRad('loosen', 1) > 0);
  assert.ok(twistAngleRad('tighten', 1) < 0);
  assert.ok(twistAngleRad('loosen', 1, true) < 0);
});

test('pointing pose requires an extended index and curled fingers', () => {
  assert.equal(isPointingPose(pose(true)), true);
  assert.equal(isPointingPose(pose(false)), false);
});

test('gate needs pointing plus a verb or deictic, unless forced', () => {
  const u = (text: string): Utterance => ({ text, words: [], start: 0, end: 1, wordTimesExact: false });
  assert.equal(gate(u('now open the cap'), true).pass, true);
  assert.equal(gate(u('now open the cap'), false).pass, false);
  assert.equal(gate(u('the weather is nice'), true).pass, false);
  assert.equal(gate(u('the weather is nice'), false, true).pass, true);
  assert.equal(gate(u('现在拧开瓶盖'), true).sense, 'loosen');
  assert.equal(gate(u('close it'), true).sense, 'tighten');
});

test('key word time uses the verb word, not the end of the sentence', () => {
  const u: Utterance = { text: 'open the cap slowly', start: 0, end: 4, wordTimesExact: true,
    words: [{ text: 'open', start: 0, end: 0.4 }, { text: 'the', start: 0.4, end: 0.6 }, { text: 'cap', start: 0.6, end: 1 }, { text: 'slowly', start: 3, end: 4 }] };
  assert.equal(keyWordTime(u), 0.2);
});

test('hand history keeps ~2 s and finds the pointed spot around a time', () => {
  const h = new HandHistory(2);
  for (let i = 0; i <= 100; i++) h.pushLandmarks(i / 30, pose(true));
  assert.ok(h.size <= 62);
  const p = h.pointedAt(3)!;
  assert.ok(Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.3) < 1e-9);
  assert.equal(h.isPointingNow(3.3), true);
  assert.equal(h.isPointingNow(9), false);
});

test('scene cache returns the most specific object under the fingertip and expires old ones', () => {
  const c = new SceneCache(6);
  c.update([cap, bottle], 10);
  assert.deepEqual(c.candidatesAt({ x: 0.52, y: 0.3 }).map(x => x.object.objectId), ['cap', 'bottle']);
  assert.deepEqual(c.candidatesAt({ x: 0.9, y: 0.1 }), []);
  c.update([], 20);
  assert.equal(c.all().length, 0);
});

test('policy: matching pointed object at high confidence plays', () => {
  const d = decide(action(spec()), [cand(cap)], 'open the bottle cap');
  assert.equal(d.kind, 'play');
});

test('policy: model target conflicting with pointed object is overridden and confirmed', () => {
  const d = decide(action(spec({ targetObjectId: 'bottle', confidence: 0.95 })), [cand(cap)], 'open that');
  assert.equal(d.kind, 'confirm');
  if (d.kind === 'confirm') assert.equal(d.spec.targetObjectId, 'cap');
});

test('policy: nothing pointed at asks the helper to tap', () => {
  assert.equal(decide(action(spec()), [], 'open it').kind, 'ask');
});

test('policy: invalid action for object asks a clarification', () => {
  const d = decide(action(spec({ actionType: 'press', targetObjectId: 'bottle', targetLabel: 'bottle' })), [cand(bottle)], 'press this');
  assert.equal(d.kind, 'ask');
  if (d.kind === 'ask') assert.equal(d.clarification?.options.length, 2);
});

test('policy: cutoffs 0.85 / 0.6', () => {
  assert.equal(decide(action(spec({ confidence: 0.85 })), [cand(cap)], 'cap').kind, 'play');
  assert.equal(decide(action(spec({ confidence: 0.84 })), [cand(cap)], 'cap').kind, 'confirm');
  assert.equal(decide(action(spec({ confidence: 0.59 })), [cand(cap)], 'cap').kind, 'ask');
});

test('policy: unnamed target with two unrelated close candidates is capped to confirm', () => {
  const knob: SceneObject = { ...cap, objectId: 'knob', label: 'knob', bbox: [0.5, 0.3, 0.7, 0.4] };
  assert.equal(decide(action(spec({ confidence: 0.95 })), [cand(cap), cand(knob)], 'open this').kind, 'confirm');
  assert.equal(decide(action(spec({ confidence: 0.95 })), [cand(cap), cand(bottle)], 'open this').kind, 'play');
});

function setup(client: Partial<AiClient>, now = { t: 5 }) {
  const outcomes: Outcome[] = [];
  const skipped: string[] = [];
  const tr = new Transcript();
  const full: AiClient = {
    parseAction: async () => action(spec()),
    resolveFocus: async () => ({ objectId: null, confidence: 0, reason: '', topic: '' }),
    voiceToken: async () => ({ token: 't', model: 'm', version: 'v', expiresIn: 1 }),
    summarize: async () => ({ taskSummary: 's', mentionedObjects: [], currentStep: '', language: 'en', updatedAt: 0 }),
    analyzeScene: async () => [],
    findLanyard: async () => ({ found: false, bbox: null }),
    ...client,
  };
  const o = new Orchestrator(tr, { client: full, clock: () => now.t, viewerLanguage: () => 'en', parseTimeoutMs: 100, onOutcome: x => outcomes.push(x), onSkipped: (_, w) => skipped.push(w), summaryIntervalSec: 1e9 });
  o.scene.update([cap, bottle], 5);
  for (let i = 0; i < 60; i++) o.hands.pushLandmarks(4 + i / 60, pose(true).map(p => ({ ...p, x: p.x + 0.02, y: p.y - 0.01 })));
  return { o, tr, outcomes, skipped };
}

test('orchestrator: pointing + verb plays a demonstration end to end', async () => {
  const { o, outcomes } = setup({});
  const out = await o.handle({ text: 'now open the cap', words: [], start: 4, end: 5, wordTimesExact: false });
  assert.equal(out?.decision.kind, 'play');
  assert.equal(outcomes.length, 1);
});

test('orchestrator: chatter without pointing is skipped, no model call', async () => {
  let calls = 0;
  const { o, skipped } = setup({ parseAction: async () => { calls++; return action(spec()); } });
  o.hands.clear();
  assert.equal(await o.handle({ text: 'open the cap', words: [], start: 4, end: 5, wordTimesExact: false }), null);
  assert.equal(calls, 0);
  assert.equal(skipped.length, 1);
});

test('orchestrator: model failure falls back offline and never auto-plays', async () => {
  const { o } = setup({ parseAction: async () => { throw new Error('boom'); } });
  const out = await o.handle({ text: 'unscrew this', words: [], start: 4, end: 5, wordTimesExact: false });
  assert.equal(out?.timing.usedFallback, true);
  assert.equal(out?.decision.kind, 'confirm');
});

test('orchestrator: slow model aborts at the timeout and falls back', async () => {
  const { o } = setup({ parseAction: (_r, signal) => new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted')))) });
  const out = await o.handle({ text: 'open this', words: [], start: 4, end: 5, wordTimesExact: false });
  assert.equal(out?.timing.usedFallback, true);
});
