import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_MODELS, sanitizeModel } from '../ai/modelSpec';
import type { ModelSpec } from '../ai/types';
import { componentsOf } from './components';
import type { P3 } from './placement';
import { qAngle, QI, qRotate } from './quat';
import { rayBoxDistance, TwinRig } from './twinRig';
import type { MoveInput } from './twinMove';

const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearV = (a: number[], b: number[], e = 1e-6) => a.forEach((v, i) => near(v, b[i], e));
const bottle = sanitizeModel(BUILTIN_MODELS.bottle)!;
const comp = componentsOf(bottle)[0];
const cap: P3 = [comp.center[0], comp.center[1], 0.3];   // a point on the cap
const body: P3 = [0, -0.25, 0.3];                         // a point on the body, well below the cap
const inp = (tip: P3, kind: MoveInput['kind'], o: Partial<MoveInput> = {}): MoveInput => ({ tip, kind, depth: 1, twist: 0, palm: null, ...o });
const at = (p: P3, dx = 0, dy = 0): P3 => [p[0] + dx, p[1] + dy, p[2]];
const FREE = Math.PI * 1.3, capH = comp.hi[1] - comp.lo[1];
/** Twist the cap loose (a few turns of the wrist, re-gripping each time) and let go; returns how far it climbed. */
const unscrew = (r: TwinRig, where: P3 = cap) => {
  let y = 0;
  for (let i = 0; i < 4; i++) { const p = at(where, 0, y); r.update(inp(p, 'pinch', { twist: 0 })); y = r.update(inp(p, 'pinch', { twist: 1.4 })).parts[0].offset[1]; r.update(inp(p, 'none')); }
  return y;
};

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

test('PINCH ON THE (UNSCREWED) CAP moves only the cap; the bottle stays put', () => {
  const r = new TwinRig(bottle);
  const y = unscrew(r);
  r.update(inp(at(cap, 0, y), 'pinch'));
  const s = r.update(inp(at(cap, 0.1, y + 0.25), 'pinch'));
  assert.equal(s.target, 0);
  near(s.parts[0].offset[0], 0.1); near(s.parts[0].offset[1], y + 0.25);
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
  near(s.parts[0].offset[1], (capH / FREE) * 0.9 * 1.2, 1e-6);                 // and climbs its thread as it turns
});

test('a screwed-on cap cannot be pulled or dragged off; once twisted loose it can, and stays off when you let go', () => {
  const r = new TwinRig(bottle);
  r.update(inp(cap, 'pinch')); const pulled = r.update(inp(at(cap, 0.3, 0.5), 'pinch')); r.update(inp(cap, 'none'));
  assert.deepEqual(pulled.parts[0].offset, [0, 0, 0], 'still screwed on');
  const y = unscrew(r);
  r.update(inp(at(cap, 0, y), 'pinch')); r.update(inp(at(cap, 0, y + 0.4), 'pinch'));
  const dropped = r.update(inp(at(cap, 0, y + 0.4), 'none'));
  assert.equal(dropped.grabbing, false);
  near(dropped.parts[0].offset[1], y + 0.4);
});

test('once the cap is off, grabbing where it used to be takes the bottle, and grabbing the cap where it is now takes the cap', () => {
  const r = new TwinRig(bottle);
  const y = unscrew(r);
  r.update(inp(at(cap, 0, y), 'pinch')); r.update(inp(at(cap, 0.4, 0.5), 'pinch')); r.update(inp(at(cap, 0.4, 0.5), 'none'));
  assert.equal(r.update(inp(cap, 'none')).hover, 'whole');                     // the old spot is just the bottle's neck now
  assert.equal(r.update(inp(at(cap, 0.4, 0.5), 'none')).hover, 0);              // the cap is over here
  assert.equal(r.update(inp(at(cap, 0.4, 0.5), 'pinch')).target, 0);
});

test('after moving the whole bottle, the cap is still the cap: it is grabbed where it now is', () => {
  const r = new TwinRig(bottle);
  r.update(inp(body, 'pinch')); r.update(inp(at(body, 0.3, 0), 'pinch')); r.update(inp(at(body, 0.3, 0), 'none'));
  assert.equal(r.update(inp(at(cap, 0.3, 0), 'none')).hover, 0);
  const y = unscrew(r, at(cap, 0.3, 0));
  const s1 = r.update(inp(at(cap, 0.3, y), 'pinch'));
  const s2 = r.update(inp(at(cap, 0.3, y + 0.2), 'pinch'));
  assert.equal(s2.target, 0); near(s2.parts[0].offset[1], y + 0.2); assert.ok(s1.target === 0);
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
  unscrew(r); r.update(inp(cap, 'pinch')); r.update(inp(at(cap, 0.3, 0.3), 'pinch', { twist: 1 })); r.reset();
  const s = r.update(inp([9, 9, 9], 'none'));
  assert.deepEqual(r.loosened(), [0], 'screwed back on');
  assert.deepEqual(s.parts[0].offset, [0, 0, 0]); assert.equal(qAngle(s.parts[0].rotation, QI), 0); assert.equal(s.target, null);
});

test('UNSCREWING: twisting the cap raises it like a thread (either way), it cannot sink below its seat, and a few twists free it', () => {
  const r = new TwinRig(bottle);
  const twistBy = (a: number, y = 0) => { r.update(inp(at(cap, 0, y), 'pinch', { twist: 0 })); const s = r.update(inp(at(cap, 0, y), 'pinch', { twist: a })); r.update(inp(cap, 'none')); return s; };
  const one = twistBy(1.0);
  near(one.parts[0].offset[1], (capH / FREE) * 1.2);
  const other = twistBy(-1.0, one.parts[0].offset[1]);                              // twist the other way: still climbs
  assert.ok(other.parts[0].offset[1] > one.parts[0].offset[1], 'twisting the other way also raises it');
  assert.ok(r.loosened()[0]! < 1, 'not loose yet');
  // a shaky hand while twisting: the cap turns in place, it is not dragged off the neck
  r.update(inp(cap, 'pinch', { twist: 0 }));
  const shaky = r.update(inp(at(cap, 0.08, -0.05), 'pinch', { twist: 0.3 }));
  near(shaky.parts[0].offset[0], 0); near(shaky.parts[0].offset[2], 0);
  r.update(inp(cap, 'none'));
  const y = unscrew(r);
  assert.equal(r.loosened()[0], 1);
  assert.ok(y >= capH - 1e-9, `the cap climbed its own height (${y.toFixed(3)})`);
  // twisting never pushes it below where it sits
  const fresh = new TwinRig(bottle);
  fresh.update(inp(cap, 'pinch', { twist: 0 }));
  assert.ok(fresh.update(inp(at(cap, 0, -0.3), 'pinch', { twist: 0.2 })).parts[0].offset[1] >= 0);
});

test('coming loose mid-twist does not make the cap jump: from there it follows the hand', () => {
  const r = new TwinRig(bottle);
  r.update(inp(cap, 'pinch', { twist: 0 }));
  r.update(inp(cap, 'pinch', { twist: FREE / 2.4 }));
  const s = r.update(inp(cap, 'pinch', { twist: FREE / 1.2 + 0.05 }));            // one long twist frees it
  assert.equal(r.loosened()[0], 1);
  const y = s.parts[0].offset[1];
  const t = r.update(inp(at(cap, 0.2, 0.1), 'pinch', { twist: FREE / 1.2 + 0.05 }));
  near(t.parts[0].offset[0], 0.2); near(t.parts[0].offset[1], y + 0.1);
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

// ---- two hands ----
const two = (a: MoveInput | null, b: MoveInput | null): [MoveInput | null, MoveInput | null] => [a, b];

test('TWO HANDS: one holds the bottle while the other twists the cap; each only moves its own piece', () => {
  const r = new TwinRig(bottle);
  r.step(two(inp(body, 'pinch'), inp(cap, 'pinch', { twist: 0 })));
  const s = r.step(two(inp(body, 'pinch'), inp(cap, 'pinch', { twist: 0.9 })));
  assert.equal(s.holds[0].target, 'whole'); assert.equal(s.holds[1].target, 0);
  assert.equal(qAngle(s.root.rotation, QI), 0, 'the bottle is steady');
  near(qAngle(s.parts[0].rotation, QI), 0.9 * 1.2, 1e-6);
  assert.ok(s.parts[0].offset[1] > 0, 'and the cap climbs its thread');
});

test('TWO HANDS: a screwed-on cap goes with the bottle; once loose, pulling the bottle away leaves the cap in the other hand', () => {
  const r = new TwinRig(bottle);
  r.step(two(inp(body, 'pinch'), inp(cap, 'pinch')));
  let s = r.step(two(inp(at(body, 0.1, 0), 'pinch'), inp(cap, 'pinch')));          // still screwed on: it rides along
  near(s.root.offset[0], 0.1); near(s.parts[0].offset[0], 0);
  r.step(two(inp(at(body, 0.1, 0), 'none'), inp(cap, 'none')));
  const y = unscrew(r, at(cap, 0.1, 0));
  const capAt = at(cap, 0.1, y);
  r.step(two(inp(at(body, 0.1, 0), 'pinch'), inp(capAt, 'pinch')));
  s = r.step(two(inp(at(body, 0.4, 0), 'pinch'), inp(capAt, 'pinch')));            // hand A drags the bottle right; hand B does not move
  near(s.root.offset[0], 0.4);
  near(s.root.offset[0] + s.parts[0].offset[0], 0.1, 1e-6);                        // the cap is still where hand B holds it
});

test('TWO HANDS: the hand steadying the bottle does not turn it while the other works on the cap, but still moves it', () => {
  const r = new TwinRig(bottle);
  const tilt = (a: number): [number, number, number, number] => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
  r.step(two(inp(body, 'grip', { palm: QI }), inp(cap, 'pinch')));
  const s = r.step(two(inp(at(body, 0.05, 0), 'grip', { palm: tilt(0.5) }), inp(cap, 'pinch', { twist: 0.4 })));
  assert.equal(qAngle(s.root.rotation, QI), 0, 'not turned by the steadying hand');
  near(s.root.offset[0], 0.05);
  r.step(two(inp(at(body, 0.05, 0), 'grip', { palm: tilt(0.5) }), inp(cap, 'none')));   // cap hand lets go
  const t = r.step(two(inp(at(body, 0.05, 0), 'grip', { palm: tilt(0.9) }), null));
  near(qAngle(t.root.rotation, QI), 0.4, 1e-6);                                         // alone again, it turns with the hand, without a jump
});

test('TELLING BOTTLE FROM CAP: a fist on the neck or shoulder takes the bottle; fingertips on or just around the cap take the cap', () => {
  const r = new TwinRig(bottle);
  const neck: P3 = [0, comp.center[1] + comp.lo[1] - 0.08, 0.3];                  // on the neck, under the cap
  const low: P3 = [0, comp.center[1] + comp.lo[1] - 0.03, 0.3];                   // a pinch that lands a little low
  const shoulder: P3 = [0.15, comp.center[1] + comp.lo[1] - 0.17, 0.3];           // top of the body
  const above: P3 = [0, comp.center[1] + comp.hi[1] + 0.1, 0.3];                  // just above the cap
  const beside: P3 = [comp.center[0] + comp.hi[0] + 0.03, comp.center[1], 0.3];
  assert.equal(r.hoverAt(neck, 0, 'grip'), 'whole'); assert.equal(r.hoverAt(neck, 0, 'pinch'), 'whole');
  assert.equal(r.hoverAt(shoulder, 0, 'grip'), 'whole'); assert.equal(r.hoverAt(shoulder, 0, 'pinch'), 'whole');
  assert.equal(r.hoverAt(above, 0, 'pinch'), 0); assert.equal(r.hoverAt(above, 0, 'grip'), 'whole');
  assert.equal(r.hoverAt(beside, 0, 'pinch'), 0); assert.equal(r.hoverAt(cap, 0, 'grip'), 0, 'a fist right on the cap still takes the cap');
  assert.equal(r.hoverAt(low, 0, 'pinch'), 0, 'fingertips a little low still get the cap'); assert.equal(r.hoverAt(low, 0, 'grip'), 'whole');
});

test('TELLING BOTTLE FROM CAP: once one hand holds the bottle, the other one closing near the cap (even on the neck) takes the cap', () => {
  const r = new TwinRig(bottle);
  const neck: P3 = [0, comp.center[1] + comp.lo[1] - 0.05, 0.3];
  r.step(two(inp(body, 'grip'), null));
  assert.equal(r.hoverAt(neck, 1, 'grip'), 0);
  const s = r.step(two(inp(body, 'grip'), inp(neck, 'pinch')));
  assert.equal(s.holds[0].target, 'whole'); assert.equal(s.holds[1].target, 0);
});

test('TWO HANDS: a piece one hand holds cannot be taken by the other; the other hand can take something else', () => {
  const r = new TwinRig(bottle);
  r.step(two(inp(cap, 'pinch'), null));
  const s = r.step(two(inp(cap, 'pinch'), inp(at(cap, 0.02, 0), 'pinch')));        // hand B closes on the cap hand A has: it gets the bottle under it
  assert.equal(s.holds[0].target, 0); assert.equal(s.holds[1].target, 'whole');
  r.step(two(inp(cap, 'pinch'), inp(body, 'none')));
  const t = r.step(two(inp(cap, 'pinch'), inp(body, 'pinch')));                    // ...and so does closing on the body
  assert.equal(t.holds[1].target, 'whole');
});

test('TWO HANDS: letting go with one hand leaves the other holding, and a lost hand is the same as letting go', () => {
  const r = new TwinRig(bottle);
  r.step(two(inp(body, 'pinch'), inp(cap, 'pinch')));
  let s = r.step(two(inp(body, 'none'), inp(cap, 'pinch')));
  assert.equal(s.holds[0].target, null); assert.equal(s.holds[1].target, 0);
  s = r.step(two(null, null));
  assert.equal(s.holds[1].target, null); assert.equal(s.grabbing, false);
});

test('hoverAt reports what a hand would take, without taking it, and skips what the other hand already holds', () => {
  const r = new TwinRig(bottle);
  assert.equal(r.hoverAt(cap, 0), 0); assert.equal(r.hoverAt(body, 0), 'whole'); assert.equal(r.hoverAt([1.5, 0, 0.3], 0), null);
  r.step(two(inp(cap, 'pinch'), null));
  assert.equal(r.hoverAt(cap, 1), 'whole', 'hand A has the cap, so for hand B it is the bottle');
  assert.equal(r.hoverAt(cap, 0), 0, 'but for hand A itself it is still the cap');
  assert.equal(r.step(two(inp(cap, 'pinch'), null)).grabbing, true);
});

test('single-hand callers still see the first hand under the old names', () => {
  const r = new TwinRig(bottle);
  const s = r.update(inp(cap, 'pinch'));
  assert.equal(s.target, 0); assert.equal(s.holds[0].target, 0); assert.equal(s.grabbing, true);
});

test('A TIPPED BOTTLE: where the cap appears on screen is where the cap is grabbed, however the bottle is turned in 3D', () => {
  for (const axis of [[1, 0, 0], [0, 1, 0], [0.6, 0.3, 0.74]] as P3[]) {
    const r = new TwinRig(bottle);
    const n = Math.hypot(...axis), a = 1.0, s = Math.sin(a / 2);
    const q: [number, number, number, number] = [axis[0] / n * s, axis[1] / n * s, axis[2] / n * s, Math.cos(a / 2)];
    r.update(inp(body, 'grip', { palm: QI })); r.update(inp(body, 'grip', { palm: q })); r.update(inp(body, 'none'));
    const st = r.update(inp([9, 9, 9], 'none'));
    near(qAngle(st.root.rotation, QI), a, 1e-6);
    // the cap's centre as seen on screen (straight down the view axis), with the fingertip at its usual depth in front
    const c = qRotate(st.root.rotation, comp.center), seen: P3 = [c[0] + st.root.offset[0], c[1] + st.root.offset[1], 0.3];
    assert.equal(r.hoverAt(seen, 0, 'pinch'), 0, `tipped about ${axis}: the cap under the finger is the cap`);
    const s1 = r.update(inp(seen, 'pinch', { twist: 0 }));
    assert.equal(s1.target, 0);
    const s2 = r.update(inp(seen, 'pinch', { twist: 0.6 }));
    assert.ok(qAngle(s2.parts[0].rotation, QI) > 0.5, 'and twisting it unscrews it');
    near(s2.parts[0].offset[0], 0, 1e-9); near(s2.parts[0].offset[2], 0, 1e-9);
    r.update(inp(seen, 'none'));
    const b = qRotate(st.root.rotation, [0, -0.25, 0]);
    assert.equal(r.hoverAt([b[0] + st.root.offset[0], b[1] + st.root.offset[1], 0.3], 0, 'grip'), 'whole', 'and the body under the finger is the bottle');
  }
});

test('rayBoxDistance: through the box is 0, beside it is the gap, a tilted line is measured along its whole length', () => {
  const lo: P3 = [-0.1, -0.1, -0.1], hi: P3 = [0.1, 0.1, 0.1];
  assert.equal(rayBoxDistance([0, 0, 5], [0, 0, 1], lo, hi), 0);
  near(rayBoxDistance([0.3, 0, 5], [0, 0, 1], lo, hi), 0.2, 1e-3);
  assert.equal(rayBoxDistance([0.3, 0, 5], [0, 0, 1], lo, hi, 0.1), Infinity);
  const d = Math.SQRT1_2;
  assert.equal(rayBoxDistance([0.5, 0, 0.5], [d, 0, d], lo, hi), 0, 'a diagonal line through the box');
});
