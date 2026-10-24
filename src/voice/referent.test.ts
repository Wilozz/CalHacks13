import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FocusTracker, matchObjects, type ObjectRef } from './referent';

const scene: ObjectRef[] = [{ objectId: 'bottle', label: 'water bottle' }, { objectId: 'phone', label: 'phone' }, { objectId: 'box', label: 'cardboard box' }];
const top = (text: string, objs = scene) => matchObjects(text, objs).mentions[0]?.objectId ?? null;

test('names, plurals and everyday synonyms find the right object', () => {
  assert.equal(top('can you hand me the water bottle'), 'bottle');
  assert.equal(top('the bottle is empty'), 'bottle');
  assert.equal(top('grab my smartphone'), 'phone');
  assert.equal(top('open the carton'), 'box');
  assert.equal(top('it is in the boxes'), 'box');
  assert.equal(top('my flask is leaking'), 'bottle');
  assert.equal(top('did you watch the game last night'), null);
});

test('a part wins over its parent when its own name is said; both lose to nothing when unnamed', () => {
  const objs: ObjectRef[] = [{ objectId: 'bottle', label: 'bottle' }, { objectId: 'cap', label: 'bottle cap' }];
  assert.equal(top('the cap on the bottle is stuck', objs), 'cap');
  assert.equal(top('fill the bottle with water', objs), 'bottle');
});

test('pronouns refer to the current focus instead of naming anything', () => {
  const r = matchObjects('slide it open', scene);
  assert.equal(r.mentions.length, 0); assert.equal(r.refersToCurrent, true);
  assert.equal(matchObjects('yeah can you slide it open', scene).refersToCurrent, false, 'longer sentences go to Claude, which has the context');
  assert.equal(matchObjects('what about the thing with the screen', scene).refersToCurrent, false);
  assert.equal(matchObjects('this one', scene).refersToCurrent, true);
  assert.equal(matchObjects('did you watch the game', scene).refersToCurrent, false);
});

test('a sentence naming two objects is flagged ambiguous so a smarter check can decide', () => {
  assert.equal(matchObjects('put the phone in the box', scene).ambiguous, true);
  assert.equal(matchObjects('put the phone away', scene).ambiguous, false);
});

test('colours alone are weak evidence; a distinctive modifier is stronger', () => {
  const objs: ObjectRef[] = [{ objectId: 'a', label: 'red button' }, { objectId: 'b', label: 'blue button' }];
  const r = matchObjects('press the red one', objs).mentions;
  assert.ok(r.length && r[0].objectId === 'a' && r[0].score < 0.7);
});

// ---- the tracker: your scenarios, on a fake clock (ms) ----
const ids = ['bottle', 'phone', 'box'];

test('talking about an object without pointing focuses it right away and remembers it', () => {
  const t = new FocusTracker();
  t.mention('bottle', 0.95, 1000);
  assert.deepEqual([t.resolve(ids, 1000).objectId, t.resolve(ids, 1000).source], ['bottle', 'voice']);
  // a minute later, still on the bottle: it is remembered until something else happens
  assert.equal(t.resolve(ids, 61_000).objectId, 'bottle');
});

test('pointing must dwell before it counts; a pass-over does not change focus', () => {
  const t = new FocusTracker();
  t.mention('bottle', 0.95, 0); t.resolve(ids, 0);
  t.point('phone', 1000); t.point('phone', 1200);
  assert.equal(t.resolve(ids, 1200).objectId, 'bottle');       // 200 ms: not yet
  t.point('phone', 1500); t.point('phone', 1700);
  const d = t.resolve(ids, 1700);
  assert.equal(d.objectId, 'phone'); assert.equal(d.source, 'point');
});

test('pointing at the object you just named is the most confident case', () => {
  const t = new FocusTracker();
  t.mention('bottle', 0.9, 0);
  for (let ms = 100; ms <= 700; ms += 100) t.point('bottle', ms);
  const d = t.resolve(ids, 700);
  assert.equal(d.source, 'both'); assert.ok(d.confidence > 0.95);
});

test('once you point at something, the earlier mention is settled and does not pull focus back afterwards', () => {
  const t = new FocusTracker();
  t.mention('bottle', 0.95, 0); t.resolve(ids, 0);
  for (let ms = 1000; ms <= 1600; ms += 100) t.point('box', ms);
  assert.equal(t.resolve(ids, 1600).objectId, 'box');
  t.point(null, 1700);
  assert.equal(t.resolve(ids, 5000).objectId, 'box');           // hand away: stays on the box, not the bottle
  assert.equal(t.resolve(ids, 5000).source, 'memory');
});

test('naming a different object after you started pointing takes over; pointing somewhere new later takes it back', () => {
  const t = new FocusTracker();
  for (let ms = 0; ms <= 600; ms += 100) t.point('box', ms);
  assert.equal(t.resolve(ids, 600).objectId, 'box');
  t.mention('phone', 0.95, 2000); t.point('box', 2050);
  assert.equal(t.resolve(ids, 2100).objectId, 'phone');          // said "phone" while still pointing at the box
  for (let ms = 3000; ms <= 3600; ms += 100) t.point('bottle', ms);
  assert.equal(t.resolve(ids, 3600).objectId, 'bottle');
});

test('focus does not flicker faster than half a second', () => {
  const t = new FocusTracker();
  t.mention('bottle', 0.9, 0); assert.equal(t.resolve(ids, 0).objectId, 'bottle');
  t.mention('phone', 0.9, 100);
  assert.equal(t.resolve(ids, 100).objectId, 'bottle');
  assert.equal(t.resolve(ids, 700).objectId, 'phone');
});

test('objects that leave the scene cannot be focused', () => {
  const t = new FocusTracker();
  t.mention('bottle', 0.9, 0); t.resolve(ids, 0);
  const d = t.resolve(['phone', 'box'], 2000);
  assert.equal(d.objectId, null);
  assert.equal(new FocusTracker().resolve([], 0).source, 'none');
});

test('a fingertip leaving an object for a moment does not drop it (grace period)', () => {
  const t = new FocusTracker();
  for (let ms = 0; ms <= 600; ms += 100) t.point('phone', ms);
  t.point(null, 800);
  assert.equal(t.resolve(ids, 1500).objectId, 'phone');
  assert.equal(t.resolve(ids, 1500).source, 'point');
});
