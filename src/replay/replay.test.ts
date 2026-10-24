import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HandFrame } from '../coordinates';
import { BUILTIN_MODELS, sanitizeModel } from '../ai/modelSpec';
import { DEFAULT_PLACEMENT } from '../remote/placement';
import { REST_POSE, type TwinInfo, type TwinPose } from '../remote/twinWire';
import { decodeReplay, encodeReplay, indexAt, LessonCapture, MAX_REPLAY_MS, Recorder, type Replay } from './log';

const twin: TwinInfo = { objectId: 'bottle_1', label: 'bottle', model: sanitizeModel(BUILTIN_MODELS.bottle)!, bbox: [0.4, 0.2, 0.6, 0.6], feedAspect: 4 / 3 };
const meta = { twin, mirror: true, posFlip: false, placement: DEFAULT_PLACEMENT };
const hand = (x: number): HandFrame => ({ timestamp: 0, handedness: 'Right', inferenceMs: 0,
  landmarks: Array.from({ length: 21 }, (_, i) => ({ x, y: 0.5 + i * 0.01, z: 0 })), worldLandmarks: [] });
const moved = (x: number): TwinPose => ({ ...REST_POSE, offset: [x, 0, 0], grabbing: true, kind: 'pinch', target: -1 });

test('the recorder keeps each new hand once, changed poses at most ~30 Hz, and survives the file round trip', () => {
  const r = new Recorder(1000, meta), a = hand(0.3), b = hand(0.6);
  r.frame(1000, a, REST_POSE); r.frame(1016, a, REST_POSE); r.frame(1033, b, moved(0.1)); r.frame(1050, null, moved(0.2)); r.frame(1070, null, moved(0.3));
  const rec = r.finish(1100);
  assert.equal(r.finish(1040).hands.length, 2); // finishing early cuts what came after
  assert.deepEqual(rec.hands.map(h => h.t), [0, 33, 50]);
  assert.equal(rec.hands[2].hand, null);
  assert.deepEqual(rec.poses.map(p => p.t), [0, 33, 70]); // 1050 was within 33 ms of the last pose
  assert.equal(rec.durationMs, 100);
  const back = decodeReplay(encodeReplay(rec))!;
  assert.ok(back);
  assert.equal(back.twin.label, 'bottle'); assert.equal(back.mirror, true); assert.equal(back.durationMs, 100);
  assert.deepEqual(back.hands.map(h => h.t), [0, 33, 50]);
  assert.ok(Math.abs(back.hands[1].hand!.landmarks[0].x - 0.6) < 1e-3);
  assert.equal(back.hands[2].hand, null);
  assert.deepEqual(back.poses[2].pose.offset, [0.3, 0, 0]);
});

test('a file that is not a valid replay is refused', () => {
  const good = JSON.parse(encodeReplay(new Recorder(0, meta).finish(10)));
  assert.ok(decodeReplay(JSON.stringify(good)));
  for (const bad of [{ ...good, v: 2 }, { ...good, durationMs: MAX_REPLAY_MS + 1 }, { ...good, twin: { label: 'x' } },
    { ...good, h: [[0, 'not base64!']] }, { ...good, h: [[5000, good.h[0]?.[1] ?? 'AQAAAAAAAAA=']] }, { ...good, p: [[0, '{"type":"nope"}']] }])
    assert.equal(decodeReplay(JSON.stringify(bad)), null);
  assert.equal(decodeReplay('{'), null);
});

test('indexAt finds the last event at or before a time', () => {
  const ev = [{ t: 0 }, { t: 10 }, { t: 20 }];
  assert.deepEqual([-1, 0, 5, 10, 19, 20, 99].map(t => indexAt(ev, t)), [-1, 0, 0, 1, 1, 2, 2]);
  assert.equal(indexAt([], 5), -1);
});

test('lessons capture themselves: a hand starts one, 6 s idle ends it trimmed, passing hands are dropped', () => {
  const got: Replay[] = [];
  const cap = new LessonCapture(() => meta, r => got.push(r));
  const run = (from: number, to: number, hand: HandFrame | null, pose: TwinPose = REST_POSE) => { for (let t = from; t < to; t += 33) cap.frame(t, hand, pose); };
  run(0, 1000, null); assert.equal(cap.active, false);                  // nothing on the copy: nothing recorded
  run(1000, 2000, hand(0.4)); assert.equal(cap.active, true);
  run(2000, 3000, hand(0.4), moved(0.1));                               // grabbed and moved: a real lesson
  run(3000, 9500, null);                                                // hand gone for 6.5 s
  assert.equal(cap.active, false); assert.equal(got.length, 1);
  assert.ok(Math.abs(got[0].durationMs - 2500) <= 40, `trimmed to just after the last activity, got ${got[0].durationMs}`);
  assert.equal(got[0].hands.at(-1)!.hand, null);                         // the hand leaving is part of it
  run(10000, 11000, hand(0.5)); run(11000, 18000, null);               // a hand passing for 1 s, nothing held
  assert.equal(got.length, 1);
  run(20000, 25000, hand(0.5)); cap.end(25000);                         // 5 s of pointing counts; closing ends it at once
  assert.equal(got.length, 2);
});

test('two hands: the second hand is recorded in its own slot, survives the file round trip, and keeps a lesson going', () => {
  const r = new Recorder(0, meta), a = hand(0.3), b = hand(0.7);
  const two: TwinPose = { ...moved(0.1), parts: [{ offset: [0, 0.05, 0], rotation: [0, 0, 0, 1] }], second: { target: 0, kind: 'pinch', anchor: null } }; // hand 2 holds the cap
  r.frame(0, a, REST_POSE, b); r.frame(40, a, two, b); r.frame(80, a, two, null);
  const rec = r.finish(100);
  assert.deepEqual(rec.hands.map(h => [h.t, h.slot ?? 0]), [[0, 0], [0, 1], [80, 1]]);
  const back = decodeReplay(encodeReplay(rec))!;
  assert.deepEqual(back.hands.map(h => [h.t, h.slot ?? 0, h.hand === null]), [[0, 0, false], [0, 1, false], [80, 1, true]]);
  assert.ok(Math.abs(back.hands[1].hand!.landmarks[0].x - 0.7) < 1e-3);
  assert.equal(back.poses.at(-1)!.pose.second?.target, 0);
  // only the second hand is on the copy, holding the cap: that is still a lesson in progress
  let got: Replay | null = null;
  const c = new LessonCapture(() => meta, x => { got = x; });
  for (let t = 0; t <= 3000; t += 50) c.frame(t, null, { ...REST_POSE, second: { target: 0, kind: 'pinch', anchor: null } }, hand(0.5));
  assert.equal(c.active, true);
  c.end(3000);
  assert.ok(got, 'kept: something was held');
});
