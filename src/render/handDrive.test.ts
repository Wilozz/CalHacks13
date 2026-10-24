import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandDriver } from './handDrive';
import type { ActionSpec } from '../ai/types';

const spec = (over: Partial<ActionSpec>): ActionSpec => ({
  actionType: 'twist', targetLabel: 'x', targetObjectId: 'a', targetPoint2d: null, amount: { turns: 1 },
  stepIndex: 1, stepCount: 1, confidence: 1, needsConfirmation: false, caption: '', captionLanguage: 'en', rationale: '', ...over,
});
// Hand with wrist at (.5,.8), knuckle direction at `rollRad` (image y down), index tip at (tx,ty), size scale.
function hand(rollRad: number, tip = { x: 0.5, y: 0.4 }, size = 0.2) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  lm[9] = { x: 0.5 + Math.cos(rollRad) * size, y: 0.8 + Math.sin(rollRad) * size, z: 0 };
  lm[8] = { ...tip, z: 0 };
  return lm;
}

test('clockwise wrist roll on screen turns the cap clockwise from above, and accumulates past 180 degrees', () => {
  const d = new HandDriver();
  const base = -Math.PI / 2;
  for (let i = 0; i <= 8; i++) d.update(hand(base + (i * Math.PI) / 4), 4 / 3, false); // 360 degrees in 45 degree steps
  const p = d.pose(spec({}));
  assert.ok(Math.abs(p.rot[1] + Math.PI * 2) < 1e-6);
  assert.ok(p.pos[1] < 0);
  assert.equal(p.progress, 1);
});

test('mirrored preview flips the roll direction to match what is shown', () => {
  const d = new HandDriver();
  d.update(hand(0), 1, true); d.update(hand(Math.PI / 2), 1, true);
  assert.ok(d.pose(spec({})).rot[1] > 0);
});

test('slide follows the fingertip along the action direction only', () => {
  const d = new HandDriver();
  d.update(hand(0, { x: 0.4, y: 0.4 }), 1, false);
  d.update(hand(0, { x: 0.55, y: 0.4 }), 1, false);
  const right = d.pose(spec({ actionType: 'slide', amount: { direction: 'right', distanceCm: 10 } }));
  assert.ok(right.pos[0] > 0 && right.pos[1] === 0);
  const left = d.pose(spec({ actionType: 'slide', amount: { direction: 'left', distanceCm: 10 } }));
  assert.equal(left.pos[0], 0); // cannot pull backwards
});

test('press needs the fingertip to move down, and is clamped', () => {
  const d = new HandDriver();
  d.update(hand(0, { x: 0.5, y: 0.3 }), 1, false);
  assert.equal(d.pose(spec({ actionType: 'press' })).pos[1], 0);
  d.update(hand(0, { x: 0.5, y: 0.9 }), 1, false);
  assert.equal(d.pose(spec({ actionType: 'press' })).pos[1], -0.2);
});

test('losing the hand for a while re-references on return', () => {
  const d = new HandDriver();
  d.update(hand(0), 1, false); d.update(hand(Math.PI / 2), 1, false);
  for (let i = 0; i < 60; i++) d.update(null, 1, false, 1 / 30);
  d.update(hand(Math.PI), 1, false);
  assert.equal(d.pose(spec({})).rot[1], 0);
});

test('flip is clamped to a lever range', () => {
  const d = new HandDriver();
  d.update(hand(0), 1, false);
  for (let i = 1; i <= 8; i++) d.update(hand((i * Math.PI) / 8), 1, false);
  assert.ok(Math.abs(d.pose(spec({ actionType: 'flip' })).rot[2]) <= Math.PI / 4 + 1e-9);
});
