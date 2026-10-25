import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GrabGate } from './grabGate';
import type { HandFrame } from '../coordinates';
import { HandSlots } from './handSlots';

// A hand moving over time. Each step is 33 ms (a camera frame). `speed` is in twin units per second along x.
function run(g: GrabGate, steps: { ms: number; kind: 'none' | 'pinch' | 'grip'; hovering: boolean; speed: number; grabbing?: boolean }[]) {
  let t = 1000, x = 0; const out: string[] = [];
  for (const s of steps) for (let i = 0; i < Math.round(s.ms / 33); i++) { t += 33; x += (s.speed * 33) / 1000; out.push(g.filter({ now: t, kind: s.kind, tip: { x, y: 0 }, hovering: s.hovering, grabbing: !!s.grabbing })); }
  return out;
}
const closing = (kind: 'pinch' | 'grip' = 'pinch') => ({ ms: 99, kind, hovering: true, speed: 0.1 });

test('a deliberate grab: open hand, over the part for a moment, closing slowly', () => {
  const out = run(new GrabGate(), [{ ms: 330, kind: 'none', hovering: true, speed: 0.1 }, closing()]);
  assert.equal(out.at(-1), 'pinch');
});

test('WAVING: a hand swinging fast over the object while its fingers open and close grabs nothing', () => {
  const g = new GrabGate();
  const out = run(g, [
    { ms: 200, kind: 'none', hovering: true, speed: 3 }, { ms: 99, kind: 'pinch', hovering: true, speed: 3 },
    { ms: 130, kind: 'none', hovering: true, speed: 3 }, { ms: 99, kind: 'grip', hovering: true, speed: 3 },
    { ms: 130, kind: 'none', hovering: true, speed: 3 }, { ms: 99, kind: 'pinch', hovering: true, speed: 2.5 },
  ]);
  assert.ok(out.every(k => k === 'none'));
});

test('a fist that is already closed, sweeping onto the object, grabs nothing, even if it then slows down over it', () => {
  const g = new GrabGate();
  const out = run(g, [{ ms: 330, kind: 'none', hovering: false, speed: 0.1 }, { ms: 200, kind: 'grip', hovering: false, speed: 2 }, { ms: 400, kind: 'grip', hovering: true, speed: 0.05 }]);
  assert.ok(out.every(k => k === 'none'));
});

test('closing the instant you arrive over the object, with no pause, does not grab', () => {
  const out = run(new GrabGate(), [{ ms: 330, kind: 'none', hovering: false, speed: 0.1 }, { ms: 33, kind: 'none', hovering: true, speed: 0.1 }, closing()]);
  assert.ok(out.every(k => k === 'none'));
});

test('a hand that was not open first (just appeared closed) does not grab', () => {
  assert.ok(run(new GrabGate(), [{ ms: 400, kind: 'pinch', hovering: true, speed: 0.05 }]).every(k => k === 'none'));
});

test('once held, it stays held however fast you move, and letting go needs no gate', () => {
  const g = new GrabGate();
  run(g, [{ ms: 330, kind: 'none', hovering: true, speed: 0.1 }]);
  const held = run(g, [{ ms: 330, kind: 'pinch', hovering: true, speed: 0.1, grabbing: true }, { ms: 330, kind: 'pinch', hovering: false, speed: 5, grabbing: true }]);
  assert.ok(held.every(k => k === 'pinch'));
  assert.equal(run(g, [{ ms: 66, kind: 'none', hovering: false, speed: 5 }]).at(-1), 'none');
});

test('after letting go there is a short cooldown, then it can grab again, but only after opening the hand', () => {
  const g = new GrabGate();
  run(g, [{ ms: 330, kind: 'none', hovering: true, speed: 0.1 }, { ms: 200, kind: 'pinch', hovering: true, speed: 0.1, grabbing: true }]);
  const soon = run(g, [{ ms: 33, kind: 'none', hovering: true, speed: 0.1 }, { ms: 99, kind: 'pinch', hovering: true, speed: 0.1 }]);
  assert.ok(soon.every(k => k === 'none'), 'too soon after a release');
  const later = run(g, [{ ms: 600, kind: 'none', hovering: true, speed: 0.1 }, closing()]);
  assert.equal(later.at(-1), 'pinch');
});

test('losing the hand resets everything', () => {
  const g = new GrabGate();
  run(g, [{ ms: 330, kind: 'none', hovering: true, speed: 0.1 }]);
  assert.equal(g.filter({ now: 9999, kind: 'none', tip: null, hovering: false, grabbing: false }), 'none');
  assert.ok(run(g, [closing()]).every(k => k === 'none'), 'must be open again first');
});

// ---- two hands: keeping each in its own slot ----
const hand = (x: number, y: number): HandFrame => ({ timestamp: 0, landmarks: Array.from({ length: 21 }, (_, i) => ({ x: x + i * 0.001, y, z: 0 })), worldLandmarks: [], handedness: 'Left', inferenceMs: 1 });
const at = (s: ReturnType<HandSlots['update']>) => s.map(h => (h ? +h.landmarks[0].x.toFixed(2) : null));

test('one hand is slot 0; a second hand appearing takes slot 1, wherever it is', () => {
  const s = new HandSlots();
  assert.deepEqual(at(s.update([hand(0.8, 0.5)], 0)), [0.8, null]);
  assert.deepEqual(at(s.update([hand(0.8, 0.5), hand(0.2, 0.5)], 33)), [0.8, 0.2]);
});

test('both hands at once: the left of the image is slot 0', () => {
  assert.deepEqual(at(new HandSlots().update([hand(0.7, 0.5), hand(0.3, 0.5)], 0)), [0.3, 0.7]);
});

test('each hand keeps its slot as it moves, even when they cross and MediaPipe swaps its labels', () => {
  const s = new HandSlots();
  s.update([hand(0.3, 0.5), hand(0.7, 0.5)], 0);
  let out: ReturnType<HandSlots['update']> = [null, null];
  for (let i = 1; i <= 8; i++) { const a = 0.3 + i * 0.07, b = 0.7 - i * 0.07; out = s.update([{ ...hand(b, 0.5), handedness: 'Left' }, { ...hand(a, 0.5), handedness: 'Right' }], i * 33); }
  assert.ok(out[0]!.landmarks[0].x > 0.8 && out[1]!.landmarks[0].x < 0.2, 'slot 0 started on the left and ended on the right');
});

test('a hand that drops out for a moment returns to its own slot; after a long gap the slot is free', () => {
  const s = new HandSlots();
  s.update([hand(0.3, 0.5), hand(0.7, 0.5)], 0);
  assert.deepEqual(at(s.update([hand(0.7, 0.5)], 100)), [null, 0.7]);        // slot 0's hand is missing
  assert.deepEqual(at(s.update([hand(0.32, 0.5), hand(0.7, 0.5)], 200)), [0.32, 0.7]);
  const t = new HandSlots(); t.update([hand(0.3, 0.5)], 0);
  assert.deepEqual(at(t.update([hand(0.8, 0.5)], 2000)), [0.8, null]);       // gone for 2 s: whoever shows up is slot 0 again
});

test('a third detection is ignored, and frames without landmarks do not count', () => {
  const s = new HandSlots();
  assert.equal(s.update([hand(0.2, 0.5), hand(0.5, 0.5), hand(0.8, 0.5)], 0).filter(Boolean).length, 2);
  assert.deepEqual(new HandSlots().update([{ ...hand(0.5, 0.5), landmarks: [] }], 0), [null, null]);
});
