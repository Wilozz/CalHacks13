import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HandFrame } from '../coordinates';
import { decodeHand, encodeHand } from './handWire';
import { apparentScale, DEFAULT_PLACEMENT, HandPlacer, mapToFeed, type Placement } from './placement';
import { LoopbackChannel, RemoteHandState } from './remoteHand';

function hand(tip = { x: 0.4, y: 0.3 }, world = true): HandFrame {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + i * 0.004, y: 0.8 - i * 0.02, z: i * 0.001 }));
  landmarks[8] = { ...tip, z: -0.05 };
  const worldLandmarks = world ? Array.from({ length: 21 }, (_, i) => ({ x: i * 0.004, y: -i * 0.008, z: -i * 0.001 })) : [];
  return { timestamp: 1, landmarks, worldLandmarks, handedness: 'Right', inferenceMs: 4 };
}

test('wire roundtrip is compact and accurate', () => {
  const h = hand();
  const buf = encodeHand(7, 1234, h);
  assert.equal(buf.byteLength, 8 + 126 + 126);
  const m = decodeHand(buf, 99)!;
  assert.equal(m.seq, 7); assert.equal(m.senderMs, 1234);
  assert.equal(m.hand!.handedness, 'Right');
  h.landmarks.forEach((p, i) => { assert.ok(Math.abs(p.x - m.hand!.landmarks[i].x) < 1e-4); assert.ok(Math.abs(p.y - m.hand!.landmarks[i].y) < 1e-4); assert.ok(Math.abs(p.z - m.hand!.landmarks[i].z) < 1e-4); });
  h.worldLandmarks.forEach((p, i) => assert.ok(Math.abs(p.x - m.hand!.worldLandmarks[i].x) < 1e-4));
});

test('no-hand and image-only messages are smaller; malformed input is rejected', () => {
  assert.equal(decodeHand(encodeHand(1, 0, null), 0)!.hand, null);
  assert.equal(encodeHand(1, 0, null).byteLength, 8);
  assert.equal(encodeHand(1, 0, hand(undefined, false)).byteLength, 8 + 126);
  assert.equal(decodeHand(new ArrayBuffer(3), 0), null);
  const bad = encodeHand(1, 0, hand()); new DataView(bad).setUint8(0, 9);
  assert.equal(decodeHand(bad, 0), null);
  assert.equal(decodeHand(encodeHand(1, 0, hand()).slice(0, 100), 0), null);
  assert.equal(decodeHand(new ArrayBuffer(5000), 0), null);
  const lying = new Uint8Array(20); lying[0] = 1; lying[1] = 1; // claims a hand but has no body
  assert.equal(decodeHand(lying.buffer, 0), null);
});

test('receiver ignores out-of-order packets, counts loss, handles seq wrap, goes stale', () => {
  const r = new RemoteHandState(350);
  assert.ok(r.accept(encodeHand(65534, 0, hand()), 1000));
  assert.ok(r.accept(encodeHand(1, 0, hand()), 1033)); // wrapped; 65535 and 0 were lost
  assert.equal(r.lost, 2);
  assert.equal(r.accept(encodeHand(0, 0, hand()), 1040), false);
  assert.equal(r.reordered, 1);
  assert.ok(r.current(1100));
  assert.equal(r.current(1500), null);
  r.accept(encodeHand(2, 0, null), 1600);
  assert.equal(r.current(1601), null);
  assert.equal(r.accept(new ArrayBuffer(2), 1700), false);
  assert.equal(r.malformed, 1);
});

test('loopback applies loss and delivers through the real codec', () => {
  const got: ArrayBuffer[] = [];
  let n = 0;
  const ch = new LoopbackChannel(() => (n++ % 2 === 0 ? 0.0 : 0.99), () => 0);
  ch.onMessage(b => got.push(b)); ch.lossPct = 50;
  for (let i = 0; i < 10; i++) ch.send(hand());
  assert.ok(got.length > 0 && got.length < 10);
  assert.ok(decodeHand(got[0], 0)!.hand);
  ch.close();
});

const pl = (o: Partial<Placement> = {}): Placement => ({ ...DEFAULT_PLACEMENT, ...o });

test('follow: fingertip lands at the mapped point; flip mirrors x; reach magnifies', () => {
  assert.deepEqual(mapToFeed({ x: 0.25, y: 0.5 }, pl({ flipX: true })), { x: 0.75, y: 0.5 });
  assert.deepEqual(mapToFeed({ x: 0.25, y: 0.5 }, pl({ flipX: false })), { x: 0.25, y: 0.5 });
  assert.ok(Math.abs(mapToFeed({ x: 0.25, y: 0.5 }, pl({ flipX: false, reach: 0.5 })).x - 0) < 1e-9);
  const pts = new HandPlacer().place(hand({ x: 0.4, y: 0.3 }), pl(), 2)!;
  assert.ok(Math.abs(pts[8][0] - 0.6 * 2) < 1e-9);
  assert.ok(Math.abs(pts[8][1] - 0.7) < 1e-9);
});

test('hand size follows the rigid palm, so curling fingers does not change it', () => {
  for (const world of [true, false]) {
    const open = new HandPlacer().place(hand(undefined, world), pl({ size: 0.3, depth: 0 }), 1.5)!;
    const palm = Math.hypot(open[9][0] - open[0][0], open[9][1] - open[0][1], world ? open[9][2] - open[0][2] : 0);
    assert.ok(Math.abs(palm * 1.95 - 0.3) < 1e-6, `world=${world} got ${palm * 1.95}`);
    const curled = hand(undefined, world);
    for (const src of [curled.landmarks, curled.worldLandmarks]) if (src.length) { src[12] = { ...src[0] }; src[11] = { ...src[0] }; }
    const c = new HandPlacer().place(curled, pl({ size: 0.3, depth: 0 }), 1.5)!;
    const palmC = Math.hypot(c[9][0] - c[0][0], c[9][1] - c[0][1], world ? c[9][2] - c[0][2] : 0);
    assert.ok(Math.abs(palmC - palm) < 1e-9);
  }
});

test('flip mirrors the hand shape, not only its position', () => {
  const a = new HandPlacer().place(hand(), pl({ flipX: false }), 1)!;
  const b = new HandPlacer().place(hand(), pl({ flipX: true }), 1)!;
  assert.ok(Math.abs((a[4][0] - a[8][0]) + (b[4][0] - b[8][0])) < 1e-9);
});

test('pinned: first frame puts the fingertip on the pin, then motion is relative with gain', () => {
  const placer = new HandPlacer();
  const p = pl({ mode: 'pinned', pin: { x: 0.5, y: 0.5 }, gain: 2, flipX: false });
  const first = placer.place(hand({ x: 0.3, y: 0.3 }), p, 1)!;
  assert.ok(Math.abs(first[8][0] - 0.5) < 1e-9 && Math.abs(first[8][1] - 0.5) < 1e-9);
  const moved = placer.place(hand({ x: 0.35, y: 0.3 }), p, 1)!;
  assert.ok(Math.abs(moved[8][0] - 0.6) < 1e-9);
  const repinned = placer.place(hand({ x: 0.35, y: 0.3 }), { ...p, pin: { x: 0.2, y: 0.2 } }, 1)!;
  assert.ok(Math.abs(repinned[8][0] - 0.2) < 1e-9);
});

test('invalid frames place nothing', () => {
  assert.equal(new HandPlacer().place({ ...hand(), landmarks: [] }, pl(), 1), null);
});

test('a hand closer to the helper\'s camera is drawn larger, a farther one smaller, and depth 0 turns it off', () => {
  const scaled = (f: number) => {
    const h = hand(); const w = h.landmarks[0];
    return { ...h, landmarks: h.landmarks.map(p => ({ x: w.x + (p.x - w.x) * f, y: w.y + (p.y - w.y) * f, z: p.z * f })) };
  };
  const palm = (frame: HandFrame, depth: number) => { const p = new HandPlacer().place(frame, pl({ depth }), 1)!; return Math.hypot(p[9][0] - p[0][0], p[9][1] - p[0][1], p[9][2] - p[0][2]); };
  const near = palm(scaled(1.3), 1), mid = palm(scaled(1), 1), far = palm(scaled(0.7), 1);
  assert.ok(near > mid && mid > far, `near ${near} mid ${mid} far ${far}`);
  assert.ok(Math.abs(palm(scaled(1.3), 0) - palm(scaled(0.7), 0)) < 1e-9);
  assert.ok(Math.abs(near / mid - 1.3) < 0.02);
});

test('tilting the palm does not read as moving away', () => {
  const flat = hand();
  const tilted = { ...flat, landmarks: flat.landmarks.map(p => ({ ...p, z: p.z + (p.x - 0.5) * 0.8 })) }; // same x,y, z grows with x
  const a = apparentScale(tilted.landmarks), b = apparentScale(flat.landmarks);
  assert.ok(a >= b - 1e-9);
});
