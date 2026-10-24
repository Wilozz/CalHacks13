import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentsOf } from '../remote/components';
import { foldParts } from './foldParts';
import { matchObjects } from '../voice/referent';
import type { ModelSpec, SceneObject } from './types';
import scan from './scanFixture.json' with { type: 'json' };

const objs = scan as unknown as SceneObject[];

test('a REAL scan (bottle, bottle cap, button box, red button): caps and buttons fold into what they belong to', () => {
  const out = foldParts(objs);
  assert.deepEqual(out.map(o => o.label), ['bottle', 'button box']);
  const bottle = out[0], box = out[1];
  assert.deepEqual(bottle.partNames, ['cap']); assert.deepEqual(box.partNames, ['button']);
  const cs = componentsOf(bottle.model!);
  assert.equal(cs.length, 1); assert.equal(cs[0].name, 'cap');
  assert.ok(bottle.affordances.includes('twist'), 'the bottle inherits what its cap can do');
  assert.equal(componentsOf(box.model!).length, 1);
});

test('the cap lands at the top of the bottle, at about its real size, and is the cap alone that moves', () => {
  const bottle = foldParts(objs)[0];
  const cap = componentsOf(bottle.model!)[0];
  const parts = bottle.model!.parts;
  const top = Math.max(...parts.filter(p => !p.moving).map(p => p.position[1] + p.size[1] / 2));
  assert.ok(cap.center[1] > 0.3 && cap.center[1] <= top + 0.1, `cap at y ${cap.center[1].toFixed(2)}`);
  assert.ok(Math.abs(cap.center[0]) < 0.1, 'centred on the bottle');
  assert.ok(cap.hi[0] - cap.lo[0] > 0.05 && cap.hi[0] - cap.lo[0] < 0.5, 'a cap-sized piece');
  assert.equal(parts.filter(p => p.moving).length, 1);
  assert.ok(parts.filter(p => !p.moving).length >= 3, 'the bottle body is untouched');
});

test('folding does not change the input objects', () => {
  const before = JSON.stringify(objs);
  foldParts(objs);
  assert.equal(JSON.stringify(objs), before);
});

test('unrelated or large objects are left alone; a part with no model of its own still becomes a piece', () => {
  const model = (objs[0].model as ModelSpec);
  const book: SceneObject = { ...objs[0], objectId: 'book', label: 'book', bbox: [0.4, 0.2, 0.6, 0.8], model };
  const coin: SceneObject = { ...objs[0], objectId: 'coin', label: 'coin', bbox: [0.48, 0.2, 0.52, 0.24], model: undefined };
  assert.equal(foldParts([book, coin]).length, 2, 'a coin is not part of a book');
  const lid: SceneObject = { ...objs[0], objectId: 'lid', label: 'lid on the book', parentLabel: 'book', bbox: [0.48, 0.2, 0.52, 0.24], model: undefined };
  const out = foldParts([book, lid]);
  assert.equal(out.length, 1); assert.equal(componentsOf(out[0].model!)[0].name, 'lid', 'named by its head noun, not by the thing it is on');
  const big: SceneObject = { ...objs[1], objectId: 'bigcap', label: 'bottle cap', bbox: [0.39, 0.2, 0.61, 0.8] };
  assert.equal(foldParts([objs[0], big]).length, 2, 'something nearly as big as the bottle is not its cap');
});

test('saying the part finds the object it belongs to', () => {
  const out = foldParts(objs);
  const m = matchObjects('the cap is stuck', out);
  assert.equal(m.mentions[0]?.objectId, 'bottle_1');
  assert.equal(matchObjects('press the button', out).mentions[0]?.objectId, 'button_box_1');
});
