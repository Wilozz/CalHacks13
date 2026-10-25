import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_MODELS, sanitizeModel } from '../ai/modelSpec';
import { componentsOf } from './components';
import { isLanyard, KitRig, lanyardProfile, seatOffset, START_APART } from './kitRig';
import type { P3 } from './placement';
import type { MoveInput } from './twinMove';
import { twinKindForLabel } from '../render/motion';

const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const lanyard = sanitizeModel(BUILTIN_MODELS.lanyard)!;
const profile = lanyardProfile(lanyard), clasp = componentsOf(lanyard)[0];
const inp = (tip: P3, kind: MoveInput['kind']): MoveInput => ({ tip, kind, depth: 1, twist: 0, palm: null });
const at = (p: P3, dx = 0, dy = 0): P3 => [p[0] + dx, p[1] + dy, 0.3];

/** A rig on a fake clock that advances one 60 Hz frame per step. */
function rig(start: 'joined' | 'apart' = 'apart') {
  let t = 0;
  const r = new KitRig(lanyard, profile, () => t, start);
  const step = (a: MoveInput | null, b: MoveInput | null = null) => { t += 1000 / 60; return r.step([a, b]); };
  /** Where the clasp's box is now, on screen (the hand closes on it there). */
  const claspAt = (): P3 => { const h = r.hookAt(); return [h[0] + clasp.center[0] - profile.hook[0], h[1] + clasp.center[1] - profile.hook[1], 0.3]; };
  const cardAt = (): P3 => { const h = r.holeAt(); return [h[0], h[1] - 0.25, 0.3]; };
  const hold = (n: number, a: () => MoveInput | null, b: () => MoveInput | null = () => null) => { let s; for (let i = 0; i < n; i++) s = step(a(), b()); return s!; };
  return { r, step, claspAt, cardAt, hold };
}
/** Pinch the clasp and carry it, in steps, until its hook is at `to`. */
function carry(k: ReturnType<typeof rig>, to: P3, kind: MoveInput['kind'] = 'pinch', frames = 20) {
  const from = k.claspAt(), hook0 = k.r.hookAt();
  for (let i = 0; i <= frames; i++) { const f = i / frames; k.step(inp([from[0] + (to[0] - hook0[0]) * f, from[1] + (to[1] - hook0[1]) * f, 0.3], kind)); }
}

test('a lanyard, badge or lobster clasp is the lanyard kit; the card is the body and the clasp the moving piece', () => {
  for (const l of ['lanyard', 'ID badge on a lanyard', 'lobster clasp', 'name tag']) assert.ok(isLanyard(l), l);
  assert.ok(!isLanyard('water bottle'));
  assert.equal(twinKindForLabel('lanyard with card'), 'lanyard');
  assert.equal(clasp.name, 'clasp');
  assert.ok(profile.hole[1] < 0.1 && profile.hole[1] > -0.1, 'the hole is near the top of the card');
  assert.ok(profile.hook[1] < profile.attach[1], 'the hook is below where the claw hangs from the clasp');
});

test('it starts clipped together, as it was scanned: the claw through the hole; or apart, for practising', () => {
  const k = rig('joined'), s = k.step(null);
  assert.equal(k.r.kit.joined, true);
  near(s.parts[0].offset[1], seatOffset(profile)[1]);
  const hook = k.r.hookAt(), hole = k.r.holeAt();
  near(hook[0], hole[0]); near(hook[1], hole[1]);
  const a = rig('apart'), t = a.step(null);
  assert.equal(a.r.kit.joined, false);
  near(t.parts[0].offset[0], START_APART[0]); near(t.parts[0].offset[1], START_APART[1]);
});

test('ONE HAND: pinch the clasp (the claw opens) and lift it, and the card slips off and stays; grip and lift, and the card comes along swinging', () => {
  const k = rig('joined');
  for (let i = 0; i < 300; i++) k.step(null);
  const c = k.claspAt(), hung = k.r.holeAt();
  k.step(inp(c, 'pinch'));
  for (let i = 1; i <= 12; i++) k.step(inp([c[0] + i * 0.01, c[1] + i * 0.015, 0.3], 'pinch'));
  assert.equal(k.r.kit.joined, false, 'lifted off the open claw');
  assert.equal(k.r.kit.near, false, 'just off: it does not line straight back up');
  near(k.r.holeAt()[1], hung[1], 1e-9);                           // an open claw does not drag the card up: it stayed where it hung
  const dropped = k.r.holeAt();
  for (let i = 13; i <= 25; i++) k.step(inp([c[0] + i * 0.01, c[1] + i * 0.015, 0.3], 'pinch'));
  near(k.r.holeAt()[1], dropped[1], 1e-9);                        // the card stays where it slipped off; the clasp goes on
  const g = rig('joined');
  for (let i = 0; i < 300; i++) g.step(null);
  const c2 = g.claspAt();
  g.step(inp(c2, 'grip'));
  for (let i = 1; i <= 12; i++) g.step(inp([c2[0] + i * 0.01, c2[1] + i * 0.015, 0.3], 'grip'));
  assert.equal(g.r.kit.joined, true, 'a shut claw carries it');
  assert.ok(g.r.holeAt()[1] > profile.hole[1] + 0.1, 'the card came up with it');
});

test('a small nudge with the claw open does not drop the card', () => {
  const k = rig('joined');
  for (let i = 0; i < 300; i++) k.step(null);
  const c = k.claspAt();
  k.step(inp(c, 'pinch')); for (let i = 1; i <= 5; i++) k.step(inp([c[0] + i * 0.01, c[1] + i * 0.01, 0.3], 'pinch'));
  assert.equal(k.r.kit.joined, true);
});

test('a hand on the clasp takes the clasp, a hand on the card takes the card', () => {
  const k = rig();
  assert.equal(k.r.hoverAt(k.claspAt(), 0, 'pinch'), 0);
  assert.equal(k.r.hoverAt(k.cardAt(), 0, 'grip'), 'whole');
  assert.equal(k.r.hoverAt([1.5, 1.5, 0.3], 0, 'pinch'), null);
});

test('PINCHING the clasp opens the claw; a grip keeps it shut', () => {
  const k = rig();
  k.hold(15, () => inp(k.claspAt(), 'pinch'));
  near(k.r.kit.gate, 1);
  k.hold(15, () => null);
  near(k.r.kit.gate, 0);
  k.hold(15, () => inp(k.claspAt(), 'grip'));
  near(k.r.kit.gate, 0);
});

test('CLIPPING ON: the open claw brought to the hole lines itself up, and letting go clips it on', () => {
  const k = rig();
  carry(k, at(k.r.holeAt(), 0.06, 0.05));                         // close to the hole, not on it
  assert.equal(k.r.kit.near, true, 'close enough: it lines up');
  const before = Math.hypot(k.r.hookAt()[0] - k.r.holeAt()[0], k.r.hookAt()[1] - k.r.holeAt()[1]);
  assert.ok(before < Math.hypot(0.06, 0.05), 'pulled toward the hole');
  k.step(null);                                                   // let go
  assert.equal(k.r.kit.joined, true);
  const d = Math.hypot(...([0, 1, 2] as const).map(i => k.r.hookAt()[i] - k.r.holeAt()[i]) as [number, number, number]);
  near(d, 0, 1e-9);
});

test('letting go of the open claw away from the hole does not clip it on, and neither does closing a grip near it', () => {
  const k = rig();
  carry(k, at(k.r.holeAt(), 0.3, 0.1)); k.step(null);
  assert.equal(k.r.kit.joined, false);
  const g = rig();
  carry(g, at(g.r.holeAt(), 0.02, 0.02), 'grip'); g.step(null);
  assert.equal(g.r.kit.joined, false, 'a grip never opened the claw');
});

test('CLIPPED ON: moving the clasp sideways swings the card, which then settles hanging straight down', () => {
  const k = rig();
  carry(k, at(k.r.holeAt())); k.step(null);
  assert.equal(k.r.kit.joined, true);
  // grab the clasp again (a grip: the claw stays shut) and jerk it right and stop
  const c0 = k.claspAt();
  for (let i = 0; i < 10; i++) k.step(inp([c0[0] + i * 0.03, c0[1], 0.3], 'grip'));
  let maxSwing = 0;
  for (let i = 0; i < 40; i++) { const s = k.step(inp([c0[0] + 0.27, c0[1], 0.3], 'grip')); maxSwing = Math.max(maxSwing, Math.abs(2 * Math.asin(s.root.rotation[2]))); }
  assert.ok(maxSwing > 0.1, `the card swung (${maxSwing.toFixed(2)} rad)`);
  assert.equal(k.r.kit.joined, true, 'and is still on');
  let s = k.step(null);
  for (let i = 0; i < 600; i++) s = k.step(null);
  near(2 * Math.asin(s.root.rotation[2]), 0, 0.02);
  const hole = k.r.holeAt(), hook = k.r.hookAt();
  near(hole[0], hook[0], 1e-9); near(hole[1], hook[1], 1e-9);    // still hanging from the hook
});

test('CLIPPED ON: holding the card moves both; the clasp stays in the hole', () => {
  const k = rig();
  carry(k, at(k.r.holeAt())); k.step(null);
  for (let i = 0; i < 300; i++) k.step(null);                     // let the clip-on swing settle
  const c0 = k.cardAt();
  k.step(inp(c0, 'grip'));
  for (let i = 1; i <= 10; i++) k.step(inp([c0[0] - i * 0.02, c0[1] + i * 0.01, 0.3], 'grip'));
  const hole = k.r.holeAt(), hook = k.r.hookAt();
  near(hole[0], hook[0], 1e-6); near(hole[1], hook[1], 1e-6);
  assert.ok(hole[0] < -0.15, 'it moved');
});

test('TAKING IT OFF: open the claw and pull the card away with the other hand; pinching alone leaves it on', () => {
  const k = rig();
  carry(k, at(k.r.holeAt())); k.step(null);
  for (let i = 0; i < 300; i++) k.step(null);
  const c = k.claspAt(), card = k.cardAt();
  k.hold(10, () => inp(c, 'pinch'));
  assert.equal(k.r.kit.joined, true, 'just opening the claw: still on');
  k.step(inp(c, 'pinch'), inp(card, 'grip'));
  for (let i = 1; i <= 15; i++) k.step(inp(c, 'pinch'), inp([card[0], card[1] - i * 0.03, 0.3], 'grip'));
  assert.equal(k.r.kit.joined, false, 'pulled off the open claw');
  const g = rig();
  carry(g, at(g.r.holeAt())); g.step(null);
  for (let i = 0; i < 300; i++) g.step(null);
  const c2 = g.claspAt(), card2 = g.cardAt();
  g.step(inp(c2, 'grip'), inp(card2, 'grip'));
  for (let i = 1; i <= 15; i++) g.step(inp(c2, 'grip'), inp([card2[0], card2[1] - i * 0.03, 0.3], 'grip'));
  assert.equal(g.r.kit.joined, true, 'with the claw shut it cannot come off');
});

test('reset puts it back as it started', () => {
  const k = rig('joined');
  const c = k.claspAt(); k.step(inp(c, 'pinch')); for (let i = 1; i <= 15; i++) k.step(inp([c[0], c[1] + i * 0.02, 0.3], 'pinch'));
  assert.equal(k.r.kit.joined, false);
  k.r.reset();
  assert.equal(k.r.kit.joined, true);
  near(k.step(null).parts[0].offset[1], seatOffset(profile)[1]);
});

test('after taking it off, the claw clips back on once it has been moved clear and brought back', () => {
  const k = rig('joined');
  for (let i = 0; i < 300; i++) k.step(null);
  const c = k.claspAt();
  k.step(inp(c, 'pinch'));
  for (let i = 1; i <= 10; i++) k.step(inp([c[0], c[1] + i * 0.015, 0.3], 'pinch'));
  assert.equal(k.r.kit.joined, false);
  k.step(null);                                                   // letting go right there does not clip it back on
  assert.equal(k.r.kit.joined, false);
  carry(k, at(k.r.holeAt(), 0, 0.3)); carry(k, at(k.r.holeAt(), 0.02, 0.02)); k.step(null);
  assert.equal(k.r.kit.joined, true);
});
