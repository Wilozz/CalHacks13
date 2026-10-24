import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HandFrame } from '../coordinates';
import { BUILTIN_MODELS, sanitizeModel } from '../ai/modelSpec';
import { DEFAULT_PLACEMENT, HandPlacer, type Placement } from './placement';
import { fingertipOnTwin, modelBounds, placeHandOnTwin } from './twinPlacement';
import { PinchDetector, pinchCloseness, pinchRatio } from './pinch';
import { TwinMover } from './twinMove';
import { decodePose, decodeTwin, encodePose, encodeTwin, type TwinInfo } from './twinWire';

const pl = (o: Partial<Placement> = {}): Placement => ({ ...DEFAULT_PLACEMENT, depth: 0, ...o });
function hand(tip: { x: number; y: number }): HandFrame {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + i * 0.004, y: 0.8 - i * 0.02, z: 0 }));
  landmarks[8] = { ...tip, z: 0 };
  const worldLandmarks = Array.from({ length: 21 }, (_, i) => ({ x: i * 0.004, y: -i * 0.008, z: 0 }));
  return { timestamp: 0, landmarks, worldLandmarks, handedness: 'Right', inferenceMs: 1 };
}
const model = sanitizeModel(BUILTIN_MODELS.bottle)!;
const bbox: [number, number, number, number] = [0.4, 0.2, 0.6, 0.6];

test('fingertip at the middle of the object box lands at the middle of the model front', () => {
  const r = placeHandOnTwin(hand({ x: 0.5, y: 0.4 }), pl({ flipX: false }), model, bbox, 4 / 3, false)!;
  const { lo, hi } = modelBounds(model);
  assert.ok(Math.abs(r.a - 0.5) < 1e-9 && Math.abs(r.b - 0.5) < 1e-9 && r.onObject);
  assert.ok(Math.abs(r.points[8][0] - (lo[0] + hi[0]) / 2) < 1e-9);
  assert.ok(Math.abs(r.points[8][1] - (lo[1] + hi[1]) / 2) < 1e-9);
  assert.ok(r.points[8][2] > hi[2]);
});

test('the top-left of the object on the feed is the top-left of the model (y flips: feed down is model up)', () => {
  const tl = placeHandOnTwin(hand({ x: 0.4, y: 0.2 }), pl({ flipX: false }), model, bbox, 4 / 3, false)!;
  const br = placeHandOnTwin(hand({ x: 0.6, y: 0.6 }), pl({ flipX: false }), model, bbox, 4 / 3, false)!;
  assert.ok(tl.points[8][0] < br.points[8][0]);
  assert.ok(tl.points[8][1] > br.points[8][1]);
});

test('a remote selfie-style helper is mirrored on the way in; the solo demo is not', () => {
  const left = placeHandOnTwin(hand({ x: 0.45, y: 0.4 }), pl(), model, [0.55, 0.2, 0.75, 0.6], 4 / 3, true)!;
  // helper's x 0.45 mirrors to feed x 0.55: the left edge of that object
  assert.ok(Math.abs(left.a) < 1e-9);
  const solo = placeHandOnTwin(hand({ x: 0.55, y: 0.4 }), pl(), model, [0.55, 0.2, 0.75, 0.6], 4 / 3, false)!;
  assert.ok(Math.abs(solo.a) < 1e-9);
});

test('pointing beside the object is reported, and the hand cannot wander far away', () => {
  const far = placeHandOnTwin(hand({ x: 0.95, y: 0.95 }), pl({ flipX: false }), model, bbox, 4 / 3, false)!;
  assert.equal(far.onObject, false);
  const { lo, hi } = modelBounds(model);
  assert.ok(far.points[8][0] <= hi[0] + 3 * (hi[0] - lo[0]) + 1e-9);
});

test('the hand keeps its on-feed size relative to the object, within readable limits', () => {
  const len = (r: ReturnType<typeof placeHandOnTwin>) => Math.hypot(r!.points[9][0] - r!.points[0][0], r!.points[9][1] - r!.points[0][1]) * 1.95;
  const big = placeHandOnTwin(hand({ x: 0.5, y: 0.4 }), pl({ size: 0.2 }), model, [0.1, 0.1, 0.9, 0.9], 4 / 3, false);
  const small = placeHandOnTwin(hand({ x: 0.5, y: 0.4 }), pl({ size: 0.2 }), model, [0.49, 0.49, 0.51, 0.51], 4 / 3, false);
  assert.ok(len(small) > len(big));
  assert.ok(len(small) <= 1.6 + 1e-6 && len(big) >= 0.5 - 1e-6);
});

test('invalid inputs place nothing', () => {
  assert.equal(placeHandOnTwin({ ...hand({ x: .5, y: .5 }), landmarks: [] }, pl(), model, bbox, 1, false), null);
  assert.equal(placeHandOnTwin(hand({ x: .5, y: .5 }), pl(), model, [0.5, 0.5, 0.5, 0.6], 1, false), null);
});

test('viewMirrored reflects the whole hand about the frame center', () => {
  const f = hand({ x: 0.3, y: 0.4 });
  const a = new HandPlacer().place(f, pl(), 2, false)!, b = new HandPlacer().place(f, pl(), 2, true)!;
  a.forEach((p, i) => { assert.ok(Math.abs(p[0] + b[i][0] - 2) < 1e-9); assert.ok(Math.abs(p[1] - b[i][1]) < 1e-9); });
});

const twin: TwinInfo = { objectId: 'cap1', label: 'bottle cap', model, bbox, feedAspect: 4 / 3 };
test('twin message roundtrips and clears', () => {
  const t = decodeTwin(encodeTwin(twin))!;
  assert.equal(t.label, 'bottle cap');
  assert.deepEqual(t.bbox, bbox);
  assert.equal(t.model.parts.length, model.parts.length);
  assert.equal(decodeTwin(encodeTwin(null)), null);
});

test('twin messages from the peer are validated, not trusted', () => {
  assert.equal(decodeTwin('not json'), undefined);
  assert.equal(decodeTwin(JSON.stringify({ type: 'other' })), undefined);
  assert.equal(decodeTwin(JSON.stringify({ type: 'twin', bbox: [0.5, 0.5, 0.4, 0.6], model, feedAspect: 1 })), undefined);
  assert.equal(decodeTwin(JSON.stringify({ type: 'twin', bbox, model: { parts: [] }, feedAspect: 1 })), undefined);
  assert.equal(decodeTwin(JSON.stringify({ type: 'twin', bbox, model, feedAspect: 99 })), undefined);
  assert.equal(decodeTwin('x'.repeat(30000)), undefined);
  const wild = decodeTwin(JSON.stringify({ type: 'twin', label: 'L'.repeat(500), bbox: [-5, 0.1, 9, 0.9], model, feedAspect: 1.5 }))!;
  assert.equal(wild.label.length, 60);
  assert.deepEqual(wild.bbox, [0, 0.1, 1, 0.9]);
});

// ---- pinch and move ----
function pinched(gapFraction: number): HandFrame {
  // palm length 0.09 m (wrist to knuckle), thumb-to-index gap = gapFraction * palm
  const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  world[9] = { x: 0, y: -0.09, z: 0 };
  world[4] = { x: 0, y: -0.15, z: 0 };
  world[8] = { x: gapFraction * 0.09, y: -0.15, z: 0 };
  const lm = Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.8 - i * 0.01, z: 0 }));
  return { timestamp: 0, landmarks: lm, worldLandmarks: world, handedness: 'Right', inferenceMs: 1 };
}

test('pinch ratio is relative to the palm, so it is independent of hand distance', () => {
  assert.ok(Math.abs(pinchRatio(pinched(0.2))! - 0.2) < 1e-9);
  assert.ok(Math.abs(pinchRatio(pinched(1.4))! - 1.4) < 1e-9);
  assert.equal(pinchRatio({ ...pinched(0.2), landmarks: [], worldLandmarks: [] }), null);
  assert.equal(pinchCloseness(0.2), 1); assert.equal(pinchCloseness(1.2), 0);
});

test('pinch has hysteresis and needs two confirming frames', () => {
  const d = new PinchDetector();
  assert.equal(d.update(pinched(0.2)), false);  // one frame is not enough
  assert.equal(d.update(pinched(0.2)), true);
  assert.equal(d.update(pinched(0.5)), true);   // between engage and release: stays pinched
  assert.equal(d.update(pinched(0.9)), true);   // first open frame
  assert.equal(d.update(pinched(0.9)), false);
  assert.equal(d.update(pinched(0.5)), false);  // between the thresholds: stays open
  d.update(pinched(0.2)); d.update(pinched(0.2));
  assert.equal(d.update(null), false);          // hand lost
});

const bounds = { lo: [-0.2, -0.5, -0.2] as [number, number, number], hi: [0.2, 0.5, 0.2] as [number, number, number] };
const at = (x: number, y: number): [number, number, number] => [x, y, 0.24];

test('pinching on the object grabs it and it follows the fingertip; releasing leaves it there', () => {
  const m = new TwinMover(bounds);
  assert.equal(m.update({ tip: at(0, 0), pinching: false, depth: 1 }).hover, true);
  assert.equal(m.update({ tip: at(0, 0), pinching: true, depth: 1 }).grabbing, true);
  const s = m.update({ tip: at(0.3, -0.2), pinching: true, depth: 1 });
  assert.ok(Math.abs(s.offset[0] - 0.3) < 1e-9 && Math.abs(s.offset[1] + 0.2) < 1e-9);
  const dropped = m.update({ tip: at(0.3, -0.2), pinching: false, depth: 1 });
  assert.equal(dropped.grabbing, false);
  assert.ok(Math.abs(dropped.offset[0] - 0.3) < 1e-9);
  m.update({ tip: at(0.5, 0.5), pinching: false, depth: 1 }); // moving an open hand does not move it
  assert.ok(Math.abs(m.offset[0] - 0.3) < 1e-9);
});

test('pinching away from the object grabs nothing, even if the pinch is held while moving onto it', () => {
  const m = new TwinMover(bounds);
  assert.equal(m.update({ tip: at(1.5, 0), pinching: true, depth: 1 }).grabbing, false);
  assert.equal(m.update({ tip: at(0, 0), pinching: true, depth: 1 }).grabbing, true); // sweeping onto it with a pinch does grab
});

test('a moved object is grabbed where it is now, and grabbing keeps the held point under the fingertip', () => {
  const m = new TwinMover(bounds);
  m.update({ tip: at(0, 0), pinching: true, depth: 1 }); m.update({ tip: at(0.5, 0), pinching: true, depth: 1 }); m.update({ tip: at(0.5, 0), pinching: false, depth: 1 });
  assert.equal(m.update({ tip: at(0, 0), pinching: true, depth: 1 }).grabbing, false); // old spot is empty now
  const g = m.update({ tip: at(0.5, 0.1), pinching: true, depth: 1 });
  assert.equal(g.grabbing, true);
  assert.ok(Math.abs(g.hold![0] - 0) < 1e-9 && Math.abs(g.hold![1] - 0.1) < 1e-9, 'hold is in object coordinates');
});

test('movement is limited so the object stays in view, closer hand pulls it toward the viewer, reset recenters', () => {
  const m = new TwinMover(bounds);
  m.update({ tip: at(0, 0), pinching: true, depth: 1 });
  const s = m.update({ tip: at(5, -5), pinching: true, depth: 2 });
  assert.deepEqual(s.offset, [0.7, -0.7, 0.5]);
  assert.equal(s.atLimit, true);
  m.update(null);
  assert.equal(m.grabbing, false); assert.deepEqual(m.offset, [0.7, -0.7, 0.5]); // losing the hand keeps the object
  m.reset(); assert.deepEqual(m.offset, [0, 0, 0]);
});

test('fingertipOnTwin exposes the target used to move the copy', () => {
  const t = fingertipOnTwin(hand({ x: 0.5, y: 0.4 }), pl({ flipX: false }), model, bbox, 4 / 3, false)!;
  assert.ok(t.onObject && t.length >= 0.5 && t.length <= 1.6);
  const anchored = placeHandOnTwin(hand({ x: 0.5, y: 0.4 }), pl({ flipX: false }), model, bbox, 4 / 3, false, [1, 1, 1])!;
  assert.ok(Math.abs(anchored.points[8][0] - 1) < 1e-9 && Math.abs(anchored.points[8][2] - 1) < 1e-9);
});

test('pose messages roundtrip, and malformed or wild ones are clamped or rejected', () => {
  const p = decodePose(encodePose({ offset: [0.3, -0.2, 0.1], grabbing: true, hold: [0, 0.1, 0.2] }))!;
  assert.deepEqual(p.offset, [0.3, -0.2, 0.1]); assert.equal(p.grabbing, true); assert.deepEqual(p.hold, [0, 0.1, 0.2]);
  assert.equal(decodePose(encodePose({ offset: [0, 0, 0], grabbing: false, hold: null }))!.hold, null);
  assert.equal(decodePose('nope'), null);
  assert.equal(decodePose(JSON.stringify({ type: 'twin-pose', o: [1, 2] })), null);
  assert.deepEqual(decodePose(JSON.stringify({ type: 'twin-pose', o: [99, -99, 'x'], g: 1, h: null }))!.offset, [2, -2, 0]);
  assert.equal(decodePose('x'.repeat(500)), null);
});
