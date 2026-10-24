import test from 'node:test';
import assert from 'node:assert/strict';
import { OneEuro } from './oneEuro';

test('one euro smooths jitter at rest but keeps up with fast motion', () => {
  const still = new OneEuro();
  let out = 0;
  for (let i = 0; i < 60; i++) out = still.filter(i % 2 ? 0.01 : -0.01, i / 30); // ±1 cm jitter at 30 fps
  assert.ok(Math.abs(out) < 0.006, `jitter left: ${out}`);
  const fast = new OneEuro();
  for (let i = 0; i <= 10; i++) out = fast.filter(i * 0.1, i / 30); // 3 units per second
  assert.ok(1 - out < 0.15, `lag: ${1 - out}`);
});
