import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionProgress, poseAt, toScene, travelUnits, twinKindFor, twinPlacement } from './motion';
import type { ActionSpec } from '../ai/types';

const spec = (over: Partial<ActionSpec>): ActionSpec => ({
  actionType: 'twist', rotationSense: 'loosen', targetLabel: 'bottle cap', targetObjectId: 'a', targetPoint2d: null, amount: { turns: 1 },
  stepIndex: 1, stepCount: 1, confidence: 1, needsConfirmation: false, caption: '', captionLanguage: 'en', rationale: '', ...over,
});

test('progress holds, acts, then holds, and loops cleanly', () => {
  assert.equal(actionProgress(0), 0);
  assert.equal(actionProgress(0.1), 0);
  assert.equal(actionProgress(0.5), 0.5);
  assert.equal(actionProgress(0.9), 1);
  assert.equal(actionProgress(1.5), 0.5);
});

test('loosen turns counterclockwise and rises; tighten reverses; reverse thread flips', () => {
  const l = poseAt(spec({}), 0.9);
  assert.ok(l.rot[1] > 0 && l.pos[1] > 0);
  const t = poseAt(spec({ rotationSense: 'tighten' }), 0.9);
  assert.ok(t.rot[1] < 0 && t.pos[1] < 0);
  const r = poseAt(spec({}), 0.9, true);
  assert.ok(r.rot[1] < 0 && r.pos[1] < 0);
  assert.ok(Math.abs(l.rot[1] - Math.PI * 2) < 1e-9);
});

test('press dips and returns to rest each repeat', () => {
  const s = spec({ actionType: 'press', amount: { depthCm: 1, repeat: 2 } });
  assert.ok(poseAt(s, 0.35).pos[1] < 0);
  assert.ok(Math.abs(poseAt(s, 0.9).pos[1]) < 1e-9);
});

test('linear actions move along their direction by a clamped distance', () => {
  const pull = poseAt(spec({ actionType: 'pull', amount: { distanceCm: 20 } }), 0.9);
  assert.equal(pull.pos[2], travelUnits(20));
  const push = poseAt(spec({ actionType: 'push', amount: { distanceCm: 20 } }), 0.9);
  assert.equal(push.pos[2], -travelUnits(20));
  assert.equal(poseAt(spec({ actionType: 'slide', amount: { direction: 'left', distanceCm: 8 } }), 0.9).pos[0], -travelUnits(8));
  assert.equal(travelUnits(1000), 1.1);
});

test('tilt rotates by the requested angle', () => {
  const p = poseAt(spec({ actionType: 'tilt', amount: { angleDeg: 90, direction: 'right' } }), 0.9);
  assert.ok(Math.abs(p.rot[2] + Math.PI / 2) < 1e-9);
});

test('twin kind comes from the label, then the action', () => {
  assert.equal(twinKindFor(spec({})), 'bottle');
  assert.equal(twinKindFor(spec({ targetLabel: 'thing', actionType: 'press' })), 'button');
  assert.equal(twinKindFor(spec({ targetLabel: 'thing', actionType: 'slide' })), 'box');
});

test('twin stays inside the frame and on the roomier side; mirroring flips x', () => {
  const left = twinPlacement({ x: 0.2, y: 0.5 }, 4 / 3);
  assert.ok(left.x > 0.2);
  const right = twinPlacement({ x: 1.2, y: 0.95 }, 4 / 3);
  assert.ok(right.x < 1.2 && right.y <= 1 - right.scale * 2.4);
  assert.ok(twinPlacement({ x: 0.5, y: 0.9 }, 4 / 3).y < 0.9, 'room left above for the hand');
  assert.deepEqual(toScene({ x: 0.25, y: 0.25 }, 2, true), { x: 1.5, y: 0.75 });
});
