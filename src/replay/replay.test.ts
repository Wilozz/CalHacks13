import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HandFrame } from '../coordinates';
import { TOSS_OBJECTS } from '../throw/toss';
import { decodeReplay, encodeReplay, indexAt, MAX_REPLAY_MS, Recorder, type ObjPose, type Replay } from './log';
import { ThrowLesson } from './lesson';

const { label, model } = TOSS_OBJECTS.mug;
const meta = { label, model, aspect: 4 / 3 };
const hand = (x: number): HandFrame => ({ timestamp: 0, handedness: 'Right', inferenceMs: 0,
  landmarks: Array.from({ length: 21 }, (_, i) => ({ x, y: 0.5 + i * 0.01, z: -0.02 })), worldLandmarks: [] });
const at = (u: number): ObjPose => ({ u, v: 0.5, h: 0.3, q: [0, 0, 0, 1] });

test('the recorder keeps hand updates, skips repeated "no hand" and unchanged poses, and survives the file round trip', () => {
  const r = new Recorder(1000, meta);
  r.frame(1000, [hand(0.3)], at(0.5)); r.frame(1033, undefined, at(0.5)); r.frame(1066, [hand(0.4), hand(0.6)], at(0.55));
  r.frame(1100, [], null); r.frame(1133, [], null);
  const rec = r.finish(1150);
  assert.deepEqual(rec.hands.map(h => [h.t, h.hands.length]), [[0, 1], [66, 2], [100, 0]]);
  assert.deepEqual(rec.poses.map(p => p.t), [0, 66, 100]);
  assert.equal(r.finish(1070).hands.length, 2); // finishing early cuts what came after
  const back = decodeReplay(encodeReplay(rec))!;
  assert.ok(back);
  assert.equal(back.label, 'Mug'); assert.equal(back.durationMs, 150); assert.equal(back.model.parts.length, model.parts.length);
  assert.deepEqual(back.hands.map(h => h.hands.length), [1, 2, 0]);
  assert.ok(Math.abs(back.hands[1].hands[1].landmarks[0].x - 0.6) < 1e-3);
  assert.equal(back.poses[1].pose!.u, 0.55); assert.equal(back.poses[2].pose, null);
});

test('a file that is not a valid replay is refused', () => {
  const good = JSON.parse(encodeReplay(new Recorder(0, meta).finish(10)));
  assert.ok(decodeReplay(JSON.stringify(good)));
  for (const bad of [{ ...good, v: 1 }, { ...good, durationMs: MAX_REPLAY_MS + 1 }, { ...good, model: { parts: [] } }, { ...good, aspect: 'x' },
    { ...good, h: [[0, ['not base64!']]] }, { ...good, h: [[0, ['AQAA', 'AQAA', 'AQAA']]] }, { ...good, h: [[5000, []]] }, { ...good, p: [[0, [1, 2]]] }])
    assert.equal(decodeReplay(JSON.stringify(bad)), null);
  assert.equal(decodeReplay('{'), null);
});

test('indexAt finds the last event at or before a time', () => {
  const ev = [{ t: 0 }, { t: 10 }, { t: 20 }];
  assert.deepEqual([-1, 0, 5, 10, 19, 20, 99].map(t => indexAt(ev, t)), [-1, 0, 0, 1, 1, 2, 2]);
  assert.equal(indexAt([], 5), -1);
});

test('a lesson runs from catching an object to throwing that same object back', () => {
  const got: Replay[] = [];
  const lesson = new ThrowLesson(r => got.push(r));
  const run = (from: number, to: number, hands: HandFrame[], poses = [{ id: 'm1', ...at(0.5) }]) => { for (let t = from; t < to; t += 33) lesson.tick(t, hands, t, poses); };
  run(0, 500, [hand(0.4)]); assert.equal(lesson.recording, null);        // nothing caught yet: nothing recorded
  lesson.caught('m1', label, model, 4 / 3, 1000); assert.equal(lesson.recording, 'm1');
  lesson.caught('b2', 'Bear', model, 4 / 3, 1100); assert.equal(lesson.recording, 'm1'); // one at a time
  run(1000, 4000, [hand(0.4)]);
  lesson.thrown('b2', 4000); assert.equal(got.length, 0);               // throwing some other object does not end it
  lesson.thrown('m1', 4000);
  assert.equal(got.length, 1); assert.equal(got[0].durationMs, 3000); assert.equal(lesson.recording, null);
  assert.ok(got[0].hands.length > 50 && got[0].poses.length >= 1);
  lesson.caught('m1', label, model, 4 / 3, 5000); lesson.thrown('m1', 6000); // caught and thrown straight back: not a lesson
  assert.equal(got.length, 1);
  lesson.caught('m1', label, model, 4 / 3, 7000); run(7000, 10000, []); lesson.end(10000); // the call ends while holding it
  assert.equal(got.length, 2);
});
