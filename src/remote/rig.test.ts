import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_MODELS, sanitizeModel } from '../ai/modelSpec';
import type { ModelSpec } from '../ai/types';
import { componentsOf } from './components';
import type { P3 } from './placement';
import { qAngle, QI, qRotate } from './quat';
import { TwinRig } from './twinRig';
import type { MoveInput } from './twinMove';

const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearV = (a: number[], b: number[], e = 1e-6) => a.forEach((v, i) => near(v, b[i], e));
const bottle = sanitizeModel(BUILTIN_MODELS.bottle)!;
const comp = componentsOf(bottle)[0];
const cap: P3 = [comp.center[0], comp.center[1], 0.3];   // a point on the cap
const body: P3 = [0, -0.25, 0.3];                         // a point on the body, well below the cap
const inp = (tip: P3, kind: MoveInput['kind'], o: Partial<MoveInput> = {}): MoveInput => ({ tip, kind, depth: 1, twist: 0, palm: null, ...o });
const at = (p: P3, dx = 0, dy = 0): P3 => [p[0] + dx, p[1] + dy, p[2]];

test('a bottle splits into the cap and the whole; objects with no separate moving part, or where everything moves, do not split', () => {
  const cs = componentsOf(bottle);
  assert.equal(cs.length, 1); assert.equal(cs[0].name, 'cap');
  assert.ok(cs[0].parts.every(i => bottle.parts[i].moving));
  assert.ok(cs[0].center[1] > 0.3, 'the cap is at the top');
  const fixed: ModelSpec = { pivot: [0, 0, 0], parts: bottle.parts.map(p => ({ ...p, moving: false })) };
  const allMoving: ModelSpec = { pivot: [0, 0, 0], parts: bottle.parts.map(p => ({ ...p, moving: true })) };
  assert.equal(componentsOf(fixed).length, 0); assert.equal(componentsOf(allMoving).length, 0);
});

test('two touching moving pieces are one component; far-apart ones are two, largest first', () => {
  const mk = (pos: P3, size: P3, name: string) => ({ shape: 'box' as const, size, position: pos, color: '#fff', moving: true, name });
  const m: ModelSpec = { pivot: [0, 0, 0], parts: [
    { shape: 'box', size: [1, 0.6, 0.6], position: [0, -0.2, 0], color: '#0ff', moving: false },
    mk([0.3, 0.2, 0], [0.2, 0.1, 0.2], 'knob'), mk([0.3, 0.27, 0], [0.05, 0.05, 0.05], 'knob'), mk([-0.3, 0.2, 0], [0.3, 0.2, 0.3], 'lever'),
  ] };
  const cs = componentsOf(m);
  assert.equal(cs.length, 2); assert.equal(cs[0].name, 'lever'); assert.equal(cs[1].parts.length, 2);
});

test('with nothing pressed, hovering reports what you are over: the cap, the whole, or nothing', () => {
  const r = new TwinRig(bottle);
  assert.equal(r.update(inp(cap, 'none')).hover, 0);
  assert.equal(r.update(inp(body, 'none')).hover, 'whole');
  assert.equal(r.update(inp([1.5, 0, 0.3], 'none')).hover, null);
});

test('PINCH ON THE CAP moves only the cap; the bottle stays put', () => {
  const r = new TwinRig(bottle);
  r.update(inp(cap, 'pinch'));
  const s = r.update(inp(at(cap, 0.1, 0.25), 'pinch'));
  assert.equal(s.target, 0);
  near(s.parts[0].offset[0], 0.1); near(s.parts[0].offset[1], 0.25);
  assert.deepEqual(s.root.offset, [0, 0, 0]);
  assert.equal(qAngle(s.root.rotation, QI), 0);
});

test('PINCH ON THE BODY moves the whole bottle, and the cap rides along without moving relative to it', () => {
  const r = new TwinRig(bottle);
  r.update(inp(body, 'pinch'));
  const s = r.update(inp(at(body, 0.2, -0.1), 'pinch'));
  assert.equal(s.target, 'whole');
  near(s.root.offset[0], 0.2); near(s.root.offset[1], -0.1);
  assert.deepEqual(s.parts[0].offset, [0, 0, 0]);   // the cap's own offset is unchanged, so it travels with the bottle
});

test('TWISTING THE CAP spins just the cap about its own centre; it stays where it was while it turns', () => {
  const r = new TwinRig(bottle);
  r.update(inp(cap, 'pinch', { twist: 0 }));
  const s = r.update(inp(cap, 'pinch', { twist: 0.9 }));
  near(qAngle(s.parts[0].rotation, QI), 0.9 * 1.2, 1e-6);
  nearV(qRotate(s.parts[0].rotation, [0, 1, 0]), [0, 1, 0]);      // a spin about the bottle's vertical axis
  assert.equal(qAngle(s.root.rotation, QI), 0);
  near(s.parts[0].offset[0], 0, 1e-6); near(s.parts[0].offset[2], 0, 1e-6);   // gripped at its centre, so it turns in place, not around you
  near(s.parts[0].offset[1], 0.075 * 0.9 * 1.2, 1e-6);                        // and climbs its thread as it turns
});

test('the cap can be pulled off (lifted well clear of the bottle), and stays off when you let go', () => {
  const r = new TwinRig(bottle);
  r.update(inp(cap, 'pinch')); r.update(inp(at(cap, 0, 0.5), 'pinch'));
  const dropped = r.update(inp(at(cap, 0, 0.5), 'none'));
  assert.equal(dropped.grabbing, false);
  near(dropped.parts[0].offset[1], 0.5);
});

test('once the cap is off, grabbing where it used to be takes the bottle, and grabbing the cap where it is now takes the cap', () => {
  const r = new TwinRig(bottle);
  r.update(inp(cap, 'pinch')); r.update(inp(at(cap, 0.4, 0.5), 'pinch')); r.update(inp(at(cap, 0.4, 0.5), 'none'));
  assert.equal(r.update(inp(cap, 'none')).hover, 'whole');                     // the old spot is just the bottle's neck now
  assert.equal(r.update(inp(at(cap, 0.4, 0.5), 'none')).hover, 0);              // the cap is over here
  assert.equal(r.update(inp(at(cap, 0.4, 0.5), 'pinch')).target, 0);
});

test('after moving the whole bottle, the cap is still the cap: it is grabbed where it now is', () => {
  const r = new TwinRig(bottle);
  r.update(inp(body, 'pinch')); r.update(inp(at(body, 0.3, 0), 'pinch')); r.update(inp(at(body, 0.3, 0), 'none'));
  assert.equal(r.update(inp(at(cap, 0.3, 0), 'none')).hover, 0);
  const s1 = r.update(inp(at(cap, 0.3, 0), 'pinch'));
  const s2 = r.update(inp(at(cap, 0.3, 0.2), 'pinch'));
  assert.equal(s2.target, 0); near(s2.parts[0].offset[1], 0.2); assert.ok(s1.target === 0);
  near(s2.root.offset[0], 0.3);                                                  // the bottle did not move again
});

test('pinching on nothing grabs nothing, but sweeping onto the cap while pinched grabs it', () => {
  const r = new TwinRig(bottle);
  assert.equal(r.update(inp([1.5, 0, 0.3], 'pinch')).grabbing, false);
  assert.equal(r.update(inp(cap, 'pinch')).target, 0);
});

test('you cannot grab the cap and the bottle at once; the first thing you touched stays held until you let go', () => {
  const r = new TwinRig(bottle);
  r.update(inp(body, 'pinch'));
  const s = r.update(inp(cap, 'pinch'));          // fingers slide up over the cap while still pinching
  assert.equal(s.target, 'whole');
  assert.equal(r.update(inp(cap, 'none')).grabbing, false);
});

test('a tilted bottle: the cap still spins about the bottle\'s own axis', () => {
  const r = new TwinRig(bottle);
  r.update(inp(body, 'grip', { palm: QI }));
  const tilt = (a: number): [number, number, number, number] => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];   // tilt about z
  r.update(inp(body, 'grip', { palm: tilt(0.8) }));
  r.update(inp(body, 'none'));
  const capWorld = (): P3 => { const s = r.update(inp([9, 9, 9], 'none')); const c = qRotate(s.root.rotation, comp.center); return [c[0] + s.root.offset[0], c[1] + s.root.offset[1], 0.3]; };
  const where = capWorld();
  assert.equal(r.update(inp(where, 'pinch', { twist: 0 })).target, 0);
  const s = r.update(inp(where, 'pinch', { twist: 0.5 }));
  nearV(qRotate(s.parts[0].rotation, [0, 1, 0]), [0, 1, 0]);                      // spun about the bottle's axis, in the bottle's own frame
  near(qAngle(s.root.rotation, QI), 0.8, 1e-6);
});

test('reset puts everything back', () => {
  const r = new TwinRig(bottle);
  r.update(inp(cap, 'pinch')); r.update(inp(at(cap, 0.3, 0.3), 'pinch', { twist: 1 })); r.reset();
  const s = r.update(inp([9, 9, 9], 'none'));
  assert.deepEqual(s.parts[0].offset, [0, 0, 0]); assert.equal(qAngle(s.parts[0].rotation, QI), 0); assert.equal(s.target, null);
});

test('UNSCREWING: twisting the cap raises it like a thread (either way), it cannot sink below its seat, and a few twists free it', () => {
  const r = new TwinRig(bottle);
  const twistBy = (a: number) => { r.update(inp(cap, 'pinch', { twist: 0 })); const s = r.update(inp(cap, 'pinch', { twist: a })); r.update(inp(cap, 'none')); return s; };
  const one = twistBy(1.0);
  near(one.parts[0].offset[1], 0.075 * 1.2);
  const back = r.update(inp(at(cap, 0, one.parts[0].offset[1]), 'pinch', { twist: 0 }));      // grab it where it is now
  const other = r.update(inp(at(cap, 0, one.parts[0].offset[1]), 'pinch', { twist: -1.0 }));   // twist the other way: still climbs
  assert.ok(other.parts[0].offset[1] > one.parts[0].offset[1], 'twisting the other way also raises it'); void back;
  r.update(inp(at(cap, 0, other.parts[0].offset[1]), 'none'));
  // ratchet: release, re-grab where it is, twist again, until it is clear of the neck
  let y = r.update(inp([9, 9, 9], 'none')).parts[0].offset[1];
  for (let i = 0; i < 4; i++) {
    r.update(inp(at(cap, 0, y), 'pinch', { twist: 0 })); y = r.update(inp(at(cap, 0, y), 'pinch', { twist: 1.4 })).parts[0].offset[1]; r.update(inp(at(cap, 0, y), 'none'));
  }
  assert.ok(y > 0.35, `cap is clear after a few twists (y ${y.toFixed(2)})`);
  // twisting never pushes it below where it sits
  const fresh = new TwinRig(bottle);
  fresh.update(inp(cap, 'pinch', { twist: 0 }));
  assert.ok(fresh.update(inp(at(cap, 0, -0.3), 'pinch', { twist: 0.2 })).parts[0].offset[1] >= 0);
});

test('only threaded pieces climb: a button spins in place without rising', () => {
  const m = sanitizeModel(BUILTIN_MODELS.button)!;
  const c = componentsOf(m)[0];
  const r = new TwinRig(m);
  const p: P3 = [c.center[0], c.center[1], 0.3];
  r.update(inp(p, 'pinch', { twist: 0 }));
  near(r.update(inp(p, 'pinch', { twist: 1 })).parts[0].offset[1], 0);
});

test('a small piece has a forgiving grab area: just beside the cap still takes the cap', () => {
  const r = new TwinRig(bottle);
  const edge: P3 = [comp.center[0] + comp.hi[0] + 0.12, comp.center[1], 0.3];
  assert.equal(r.update(inp(edge, 'none')).hover, 0);
});
