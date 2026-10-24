import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_MODELS, movingTop, sanitizeModel } from './modelSpec';

test('sanitizeModel clamps, drops bad shapes, defaults colors and pivots at the moving centroid', () => {
  const m = sanitizeModel({ parts: [
    { shape: 'cylinder', size: [0.4, 9, 0.4], position: [0, 0, 0], color: 'red' },
    { shape: 'torus', size: [1, 1, 1] },
    { shape: 'cylinder', size: [0.2, 0.1, 0.2], position: [0, 0.5, 0], color: '#AABBCC', moving: true },
  ] })!;
  assert.equal(m.parts.length, 2);
  assert.ok(Math.abs(m.parts[0].size[1] - 1) < 1e-9, 'tallest dimension is fitted to 1 unit');
  assert.equal(m.parts[0].color, '#64f5ed');
  assert.equal(m.parts[1].color, '#AABBCC');
  assert.ok(Math.abs(m.pivot[1] - 0.3125) < 1e-9, 'pivot follows the scaling');
  assert.ok(Math.abs(movingTop(m) - 0.34375) < 1e-9);
});

test('a lone small part is enlarged to a readable size and centered', () => {
  const m = sanitizeModel({ parts: [{ shape: 'cylinder', size: [0.1, 0.05, 0.1], position: [0.3, 0.4, 0], color: '#ff0000', moving: true }] })!;
  assert.ok(Math.abs(m.parts[0].size[0] - 1) < 1e-9);
  assert.deepEqual(m.parts[0].position.map(Math.abs), [0, 0, 0]);
});

test('sanitizeModel rejects junk and caps part count', () => {
  assert.equal(sanitizeModel(null), null);
  assert.equal(sanitizeModel({ parts: [] }), null);
  assert.equal(sanitizeModel({ parts: Array.from({ length: 40 }, () => ({ shape: 'box' })) })!.parts.length, 10);
});

test('built-in models are valid under the same rules', () => {
  for (const m of Object.values(BUILTIN_MODELS)) assert.ok(sanitizeModel(m));
});
