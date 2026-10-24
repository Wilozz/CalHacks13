import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HandFrame } from '../coordinates';
import { GraspDetector, grabPoint, graspRatios, twistAngle } from './grasp';
import type { P3 } from './placement';
import { palmQuat, qAngle, qAxisAngle, qFromBasis, qInv, qMul, qRotate, type Q, QI } from './quat';
import { TwinMover, type MoveInput } from './twinMove';

const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearV = (a: number[], b: number[], e = 1e-6) => a.forEach((v, i) => near(v, b[i], e));

// ---- quaternions ----
test('quaternion helpers: rotate, compose, invert, basis', () => {
  const q = qAxisAngle([0, 1, 0], Math.PI / 2);
  nearV(qRotate(q, [1, 0, 0]), [0, 0, -1]);
  nearV(qRotate(qMul(q, q), [1, 0, 0]), [-1, 0, 0]);
  nearV(qRotate(qInv(q), qRotate(q, [0.3, 0.5, 0.7])), [0.3, 0.5, 0.7]);
  near(qAngle(QI, q), Math.PI / 2);
  const b = qFromBasis([0, 0, -1], [0, 1, 0], [1, 0, 0]); // the same y quarter-turn written as axes
  near(qAngle(b, q), 0, 1e-6);
});

const flat = (): V[] => Array.from({ length: 21 }, () => [0, 0, 0] as V);
type V = [number, number, number];
test('palm orientation follows the hand: identity when flat to the viewer, turns when the hand turns', () => {
  const h = flat(); h[0] = [0, 0, 0]; h[9] = [0, 1, 0]; h[5] = [0.5, 0.9, 0]; h[17] = [-0.5, 0.8, 0];
  const q0 = palmQuat(h)!;
  near(qAngle(q0, QI), 0, 1e-6);
  const turn = qAxisAngle([0, 0, 1], 0.6);   // roll the hand 0.6 rad about the viewing axis
  const h2 = h.map(p => qRotate(turn, p)) as V[];
  near(qAngle(palmQuat(h2)!, q0), 0.6, 1e-6);
  assert.equal(palmQuat([]), null);
});

// ---- grasp detection ----
function frame(pinchGap: number, middleGap: number): HandFrame {
  const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  world[9] = { x: 0, y: -0.09, z: 0 };               // palm 0.09 m
  world[4] = { x: 0, y: -0.15, z: 0 };
  world[8] = { x: pinchGap * 0.09, y: -0.15, z: 0 };
  world[12] = { x: middleGap * 0.09, y: -0.16, z: 0 };
  const lm = Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + 0.001 * i, y: 0.8 - 0.01 * i, z: 0 }));
  lm[4] = { x: 0.5, y: 0.4, z: 0 }; lm[8] = { x: 0.52, y: 0.4, z: 0 }; lm[12] = { x: 0.53, y: 0.42, z: 0 };
  return { timestamp: 0, landmarks: lm, worldLandmarks: world, handedness: 'Right', inferenceMs: 1 };
}

test('pinch vs grip: the middle finger joining makes it a grip', () => {
  const r = graspRatios(frame(0.2, 0.9))!;
  near(r.pinch, 0.2); near(r.middle, 0.9, 0.02);
  const d = new GraspDetector();
  const run = (f: HandFrame, n = 2) => { let k = d.kind; for (let i = 0; i < n; i++) k = d.update(f); return k; };
  assert.equal(run(frame(1.2, 1.4)), 'none');
  assert.equal(run(frame(0.2, 0.9)), 'pinch');
  assert.equal(run(frame(0.2, 0.3)), 'grip');
  assert.equal(run(frame(0.2, 0.7)), 'grip', 'stays a grip between the two thresholds');
  assert.equal(run(frame(0.2, 0.95)), 'pinch', 'middle finger leaves: back to a pinch');
  assert.equal(run(frame(0.5, 0.95)), 'pinch', 'pinch is sticky until clearly open');
  assert.equal(run(frame(1.0, 1.0)), 'none');
});

test('one noisy frame does not change the gesture; losing the hand ends it', () => {
  const d = new GraspDetector();
  d.update(frame(0.2, 0.9)); d.update(frame(0.2, 0.9));
  assert.equal(d.update(frame(1.2, 1.2)), 'pinch');
  assert.equal(d.update(frame(0.2, 0.9)), 'pinch');
  assert.equal(d.update(null), 'none');
});

test('the grab point is between the fingers that hold', () => {
  const f = frame(0.2, 0.3);
  near(grabPoint(f, 'pinch').x, 0.51); near(grabPoint(f, 'grip').x, (0.5 + 0.52 + 0.53) / 3); near(grabPoint(f, 'none').x, 0.52);
});

test('twist angle is the palm direction on screen, and opening the fingers does not change it', () => {
  const p = flat(); p[0] = [0, 0, 0]; p[9] = [1, 0, 0]; near(twistAngle(p), 0);
  p[9] = [0, 1, 0]; near(twistAngle(p), Math.PI / 2);
  const before = twistAngle(p);
  p[4] = [0.3, 0.2, 0]; p[8] = [-0.4, 0.9, 0];                       // thumb and index swing about
  near(twistAngle(p), before);
});

// ---- grab, move, turn ----
const bounds = { lo: [-0.2, -0.5, -0.2] as P3, hi: [0.2, 0.5, 0.2] as P3 };
const at = (x: number, y: number): P3 => [x, y, 0.24];
const inp = (tip: P3, kind: MoveInput['kind'], o: Partial<MoveInput> = {}): MoveInput => ({ tip, kind, depth: 1, twist: 0, palm: null, ...o });

test('pinching on the object grabs it; it follows the hand; letting go leaves it; an open hand does nothing', () => {
  const m = new TwinMover(bounds);
  assert.equal(m.update(inp(at(0, 0), 'none')).hover, true);
  assert.equal(m.update(inp(at(0, 0), 'pinch')).grabbing, true);
  const s = m.update(inp(at(0.3, -0.2), 'pinch'));
  near(s.offset[0], 0.3); near(s.offset[1], -0.2);
  assert.equal(m.update(inp(at(0.3, -0.2), 'none')).grabbing, false);
  m.update(inp(at(0.5, 0.5), 'none')); near(m.offset[0], 0.3);
});

test('a pinch away from the object grabs nothing, but sweeping onto it while pinched does', () => {
  const m = new TwinMover(bounds);
  assert.equal(m.update(inp(at(1.5, 0), 'pinch')).grabbing, false);
  assert.equal(m.update(inp(at(0, 0), 'pinch')).grabbing, true);
});

test('a moved object is grabbed where it is now', () => {
  const m = new TwinMover(bounds);
  m.update(inp(at(0, 0), 'pinch')); m.update(inp(at(0.5, 0), 'pinch')); m.update(inp(at(0.5, 0), 'none'));
  assert.equal(m.update(inp(at(0, 0), 'pinch')).grabbing, false);
  assert.equal(m.update(inp(at(0.5, 0.1), 'pinch')).grabbing, true);
});

test('movement is limited, a closer hand pulls it toward the viewer, reset recenters and unturns', () => {
  const m = new TwinMover(bounds);
  m.update(inp(at(0, 0), 'pinch'));
  const s = m.update(inp(at(5, -5), 'pinch', { depth: 2 }));
  assert.deepEqual(s.offset, [0.55, -0.55, 0.5]); assert.equal(s.atLimit, true);
  m.update(null); assert.equal(m.grabbing, false); assert.deepEqual(m.offset, [0.55, -0.55, 0.5]);
  m.reset(); assert.deepEqual(m.offset, [0, 0, 0]); assert.deepEqual(m.rotation, QI);
});

test('PINCH + TWIST spins the object about its vertical axis, as much as you twist; letting go keeps the turn', () => {
  const m = new TwinMover(bounds);
  m.update(inp(at(0, 0), 'pinch', { twist: 0.2 }));
  const s = m.update(inp(at(0, 0), 'pinch', { twist: 0.2 + 0.5 }));
  near(qAngle(s.rotation, QI), 0.5 * 1.2, 1e-6);
  nearV(qRotate(s.rotation, [0, 1, 0]), [0, 1, 0]);                // vertical axis unchanged: a spin, not a tilt
  m.update(inp(at(0, 0), 'none'));
  near(qAngle(m.rotation, QI), 0.6, 1e-6);
  // turning again continues from where it was left
  m.update(inp(at(0, 0), 'pinch', { twist: 1 })); const t = m.update(inp(at(0, 0), 'pinch', { twist: 1.5 }));
  near(qAngle(t.rotation, QI), 1.2, 1e-6);
});

test('twisting across the +-PI seam does not flip the object', () => {
  const m = new TwinMover(bounds);
  m.update(inp(at(0, 0), 'pinch', { twist: Math.PI - 0.1 }));
  const s = m.update(inp(at(0, 0), 'pinch', { twist: -Math.PI + 0.1 })); // +0.2 rad the short way round
  near(qAngle(s.rotation, QI), 0.2 * 1.2, 1e-6);
});

test('GRIP follows the whole hand in 3D: roll about the view axis turns it about that axis', () => {
  const m = new TwinMover(bounds);
  const q0 = qAxisAngle([1, 0, 0], 0.3);
  m.update(inp(at(0, 0), 'grip', { palm: q0 }));
  const roll = qAxisAngle([0, 0, 1], 0.8);
  const s = m.update(inp(at(0, 0), 'grip', { palm: qMul(roll, q0) }));
  near(qAngle(s.rotation, roll), 0, 1e-6);
  nearV(qRotate(s.rotation, [1, 0, 0]), [Math.cos(0.8), Math.sin(0.8), 0]);
});

test('it turns about the held point, so the spot under your fingers stays put', () => {
  const m = new TwinMover(bounds);
  const grab = at(0.15, 0.3);                                      // holding near the top right
  const s0 = m.update(inp(grab, 'grip', { palm: QI }));
  const held0 = s0.anchor!;
  const s = m.update(inp(grab, 'grip', { palm: qAxisAngle([0, 0, 1], 1.0) }));
  nearV(s.anchor!, held0, 1e-6);                                   // the held spot did not move
  assert.ok(Math.hypot(s.offset[0], s.offset[1]) > 0.1, 'the centre swung around it');
});

test('switching between pinch and grip mid-hold does not make the object jump', () => {
  const m = new TwinMover(bounds);
  m.update(inp(at(0, 0), 'pinch', { twist: 0 })); const a = m.update(inp(at(0, 0), 'pinch', { twist: 0.4 }));
  const b = m.update(inp(at(0, 0), 'grip', { twist: 0.4, palm: qAxisAngle([0, 1, 0], 2) }));
  near(qAngle(a.rotation, b.rotation), 0, 1e-6); nearV(a.offset, b.offset, 1e-9);
  assert.equal(b.kind, 'grip');
  const c = m.update(inp(at(0, 0), 'grip', { palm: qAxisAngle([0, 1, 0], 2 + 0.3) }));
  near(qAngle(c.rotation, b.rotation), 0.3, 1e-6);
});

test('with no hand, the hold ends and the turn is kept', () => {
  const m = new TwinMover(bounds);
  m.update(inp(at(0, 0), 'pinch', { twist: 0 })); m.update(inp(at(0, 0), 'pinch', { twist: 1 }));
  const s = m.update(null);
  assert.equal(s.grabbing, false); near(qAngle(s.rotation, QI), 1.2, 1e-6);
});
