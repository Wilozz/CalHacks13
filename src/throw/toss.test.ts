import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeToss, encodeToss, releaseVelocity, TOSS_OBJECTS } from './toss';

test('a toss survives the wire with its model intact', () => {
  const { label, model } = TOSS_OBJECTS.mug;
  const t = decodeToss(encodeToss({ id: 'abc', label, model, spin: [1.234, -2, 3] }));
  assert.ok(t);
  assert.equal(t.label, 'Mug');
  assert.deepEqual(t.spin, [1.23, -2, 3]);
  assert.equal(t.model.parts.length, model.parts.length);
  assert.deepEqual(t.model.parts[0].size.map(v => +v.toFixed(3)), model.parts[0].size.map(v => +v.toFixed(3)));
});

test('decodeToss rejects anything that is not a valid toss', () => {
  for (const bad of [null, 42, '', 'not json', '{"type":"twin"}', '{"type":"toss"}', '{"type":"toss","model":{"parts":[{"shape":"teapot"}]}}', 'x'.repeat(30_000)]) assert.equal(decodeToss(bad), null);
});

test('decodeToss clamps a hostile peer', () => {
  const t = decodeToss(JSON.stringify({ type: 'toss', id: 'x'.repeat(99), label: 'y'.repeat(99), spin: [1e9, 'a', -1e9], model: { parts: [{ shape: 'box', size: [99, 99, 99], position: [0, 0, 0], color: 'red' }] } }));
  assert.ok(t);
  assert.deepEqual(t.spin, [20, 0, -20]);
  assert.equal(t.id.length, 16);
  assert.equal(t.label.length, 40);
  assert.equal(t.model.parts[0].color, '#64f5ed');
});

test('releaseVelocity finds the flick even when the hand slows before letting go', () => {
  // slow carry, fast flick (10 units/s on both axes), then a slow-down while the pinch opens
  const hist = [{ t: 0, x: 0, y: 0 }, { t: 0.5, x: 0.5, y: 0 }, { t: 0.55, x: 0.5, y: 0 }, { t: 0.6, x: 1, y: 0.5 }, { t: 0.65, x: 1.5, y: 1 }, { t: 0.7, x: 1.55, y: 1.05 }, { t: 0.75, x: 1.56, y: 1.06 }];
  const [vx, vy] = releaseVelocity(hist);
  assert.ok(Math.abs(vx - 10) < 1e-9 && Math.abs(vy - 10) < 1e-9, `${vx},${vy}`);
  assert.deepEqual(releaseVelocity([{ t: 0, x: 1, y: 1 }]), [0, 0]);
  // Holding still for longer than the window reads as a drop.
  assert.deepEqual(releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 0.2, x: 2, y: 0 }, { t: 0.5, x: 2, y: 0 }, { t: 0.6, x: 2, y: 0 }]), [0, 0]);
});
