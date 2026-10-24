import type { ModelSpec } from '../ai/types';
import { componentsOf, wholeBounds, type Component } from './components';
import type { GraspKind } from './grasp';
import type { P3 } from './placement';
import { QI, qInv, qMul, qRotate, type Q } from './quat';
import { TwinMover, type MoveInput } from './twinMove';

export type Target = 'whole' | number;
const THREADED = /\b(cap|lid|cork|top|cover|stopper)\b/i;
/** How much turning frees a screwed-on piece: about two-thirds of a turn (two or three twists of the wrist). */
const FREE_TURN = Math.PI * 1.3;
/**
 * How far past a piece's edge a hand still takes the piece rather than the body. Fingertips (a pinch, or an open hand
 * about to pinch) go for small pieces; a fist goes for the body, so a grip has to be right on the piece. When the other
 * hand already holds the body, this one can only be after a piece, so it reaches furthest.
 */
const REACH: Record<GraspKind, number> = { none: 0.14, pinch: 0.14, grip: 0.05 };
const REACH_SECOND = 0.24;
/** Fingertips this close to a piece take it even where they are over the body (a pinch on a cap often lands a little low). */
const ON_BODY_SLACK: Record<GraspKind, number> = { none: 0.05, pinch: 0.05, grip: 0 };
export interface Rigid { offset: P3; rotation: Q }
/** What one hand is doing to the object. */
export interface Hold {
  /** what it is holding, if anything */
  target: Target | null;
  /** what it is over, when not holding */
  hover: Target | null;
  grabbing: boolean; kind: GraspKind;
  /** world point where the grip should be drawn */
  anchor: P3 | null;
}
export interface RigState {
  root: Rigid;
  /** each component's movement relative to the whole, so it rides along when the whole moves */
  parts: Rigid[];
  /** the two hands, by slot */
  holds: [Hold, Hold];
  // The first hand, under the names single-hand callers use.
  target: Target | null; hover: Target | null; grabbing: boolean; kind: GraspKind; anchor: P3 | null;
}
type Slot2<T> = [T, T];
const IDLE: Hold = { target: null, hover: null, grabbing: false, kind: 'none', anchor: null };
const WHOLE_MARGIN = 0.18;

/**
 * How far the line o + t·d passes from the box [lo, hi]: the smallest margin m for which it goes through
 * [lo - m, hi + m] (0 = through the box itself), or Infinity if not even within `max`.
 */
export function rayBoxDistance(o: P3, d: P3, lo: P3, hi: P3, max = 1): number {
  const through = (m: number) => {
    let t0 = -Infinity, t1 = Infinity;
    for (let i = 0; i < 3; i++) {
      const a = lo[i] - m, b = hi[i] + m;
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < a || o[i] > b) return false; continue; }
      const u = (a - o[i]) / d[i], v = (b - o[i]) / d[i];
      t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v));
      if (t0 > t1) return false;
    }
    return true;
  };
  if (through(0)) return 0;
  if (!(max > 0) || !through(max)) return Infinity;
  let a = 0, b = max;
  for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (through(m)) b = m; else a = m; }
  return b;
}

/**
 * The object as a whole plus its separately movable components, held by up to two hands. Nothing is selected first:
 * pinching on or near the cap takes the cap (twist it off, then pull it away), and doing so on the body (the neck just
 * under the cap included) takes the whole thing, cap and all. Each hand can hold a different piece at once: one steadies
 * the bottle, which then only moves and no longer turns with that hand, while the other twists the cap. A piece one hand
 * has cannot be taken by the other; reaching for it takes the next thing under the fingers instead.
 */
export class TwinRig {
  readonly components: Component[];
  private readonly root: TwinMover;
  private readonly movers: TwinMover[];
  /** the body's own parts (everything not in a component), in the whole's frame */
  private readonly body: { lo: P3; hi: P3 }[];
  private readonly whole: { lo: P3; hi: P3 };
  private active: Slot2<Target | null> = [null, null];
  constructor(model: ModelSpec) {
    this.components = componentsOf(model);
    this.whole = wholeBounds(model);
    // The rig decides what each hand takes (see pick), so the movers take hold wherever they are told to.
    this.root = new TwinMover(this.whole, undefined, Infinity);
    // Caps and lids are screwed on: they turn in place and climb their own height, then come loose.
    this.movers = this.components.map(c => new TwinMover({ lo: c.lo, hi: c.hi }, [0.6, 0.6, 0.6], Infinity, c.center, THREADED.test(c.name) ? { pitch: (c.hi[1] - c.lo[1]) / FREE_TURN, free: FREE_TURN } : undefined));
    const mine = new Set(this.components.flatMap(c => c.parts));
    this.body = model.parts.filter((_, i) => !mine.has(i)).map(p => ({ lo: p.position.map((v, k) => v - p.size[k] / 2) as P3, hi: p.position.map((v, k) => v + p.size[k] / 2) as P3 }));
  }

  /** How far each component is unscrewed, 0..1 (1 = loose), or null for pieces that are not screwed on. */
  loosened(): (number | null)[] { return this.movers.map(m => m.loosened); }

  /** world -> the whole's own frame */
  private toRoot(p: P3): P3 {
    const o = this.root.offset;
    return qRotate(qInv(this.root.rotation), [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
  }
  private fromRoot(p: P3): P3 { const r = qRotate(this.root.rotation, p), o = this.root.offset; return [r[0] + o[0], r[1] + o[1], r[2] + o[2]]; }

  /**
   * The line of sight through the fingertip, in the whole's frame. The fingertip only has a screen position, so what it
   * is "on" is whatever that line passes through. Testing a point at a fixed depth instead goes wrong as soon as the
   * object is tipped toward or away from you: the cap you see under your finger is no longer at that depth.
   */
  private ray(tip: P3): { o: P3; d: P3 } { return { o: this.toRoot(tip), d: qRotate(qInv(this.root.rotation), [0, 0, 1]) }; }

  /** How far the line of sight passes from component i, where it is now and however it is turned. */
  private pieceDistance(i: number, o: P3, d: P3): number {
    const c = this.components[i], m = this.movers[i], inv = qInv(m.rotation);
    const at: P3 = [o[0] - c.center[0] - m.offset[0], o[1] - c.center[1] - m.offset[1], o[2] - c.center[2] - m.offset[2]];
    return rayBoxDistance(qRotate(inv, at), qRotate(inv, d), c.lo, c.hi);
  }

  /** Where the fingertip is on component i, in the whole's frame: on the line of sight, at the front of the piece's seat. */
  private onPiece(tip: P3, i: number): P3 {
    const { o, d } = this.ray(tip), c = this.components[i].center;
    const t = (c[0] - o[0]) * d[0] + (c[1] - o[1]) * d[1] + (c[2] - o[2]) * d[2] + this.components[i].hi[2] + 0.04;
    return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  }

  /**
   * What a hand closing here takes: the nearest free piece within reach (see REACH), unless the fingers are on the body
   * itself (not on the piece), or else the whole. Never what the other hand already holds.
   */
  private pick(tip: P3, slot: 0 | 1, kind: GraspKind): Target | null {
    const { o, d } = this.ray(tip), other = this.active[1 - slot];
    const reach = other === 'whole' ? REACH_SECOND : REACH[kind];
    let best = -1, bestD = Infinity;
    this.movers.forEach((_, i) => { const dist = this.pieceDistance(i, o, d); if (other !== i && dist <= reach && dist < bestD) { best = i; bestD = dist; } });
    const onBody = this.body.some(b => rayBoxDistance(o, d, b.lo, b.hi, 0) === 0);
    if (best >= 0 && (bestD <= ON_BODY_SLACK[kind] || !onBody || other === 'whole')) return best;
    return other !== 'whole' && rayBoxDistance(o, d, this.whole.lo, this.whole.hi, WHOLE_MARGIN) <= WHOLE_MARGIN ? 'whole' : null;
  }

  /** What a hand would take if it closed here (for the highlight and for the grab gate). No side effects. */
  hoverAt(tip: P3, slot: 0 | 1 = 0, kind: GraspKind = 'none'): Target | null { return this.pick(tip, slot, kind); }

  /** One step with both hands (by slot; null = no hand). */
  step(inputs: Slot2<MoveInput | null>): RigState {
    const anchors: Slot2<P3 | null> = [null, null];
    // Letting go (or losing the hand) ends that hand's hold; the pieces stay where they were left.
    ([0, 1] as const).forEach(s => { const i = inputs[s]; if (!i || i.kind === 'none') this.active[s] = null; });
    // A closed hand over something free takes it. Pinching on nothing, or on what the other hand holds, takes nothing.
    ([0, 1] as const).forEach(s => {
      const i = inputs[s];
      if (i && i.kind !== 'none' && this.active[s] === null) { const t = this.pick(i.tip, s, i.kind); if (t !== null) this.active[s] = t; }
    });

    // The whole first, so components are placed in its new frame. While the other hand works on a piece, the hand on
    // the whole is steadying it: the object follows that hand's position but does not turn with it.
    const holder = (t: Target) => ([0, 1] as const).find(s => this.active[s] === t);
    const rs = holder('whole');
    if (rs !== undefined) { const i = inputs[rs]; anchors[rs] = this.root.update(i && { ...i, steady: typeof this.active[1 - rs] === 'number' }).anchor; }
    else this.root.update(null);
    this.movers.forEach((m, ci) => {
      const cs = holder(ci), i = cs === undefined ? null : inputs[cs];
      if (cs === undefined || !i) { m.update(null); return; }
      // Moved in the whole's frame, so it follows the whole and turns about its own axis even if the whole is tilted.
      const a = m.update({ ...i, tip: this.onPiece(i.tip, ci), palm: i.palm ? qMul(qInv(this.root.rotation), i.palm) : null }).anchor;
      anchors[cs] = a ? this.fromRoot(a) : null;
    });

    const holds = ([0, 1] as const).map(s => {
      const i = inputs[s], t = this.active[s];
      if (!i) return IDLE;
      return { target: t, hover: t === null ? this.pick(i.tip, s, i.kind) : null, grabbing: t !== null, kind: t !== null ? i.kind : 'none', anchor: anchors[s] } as Hold;
    }) as Slot2<Hold>;
    return {
      root: { offset: [...this.root.offset], rotation: this.root.rotation },
      parts: this.movers.map(m => ({ offset: [...m.offset] as P3, rotation: m.rotation })),
      holds, target: holds[0].target, hover: holds[0].hover, grabbing: holds[0].grabbing, kind: holds[0].kind, anchor: holds[0].anchor,
    };
  }

  /** One hand. */
  update(input: MoveInput | null): RigState { return this.step([input, null]); }

  reset() { this.active = [null, null]; this.root.reset(); this.movers.forEach(m => m.reset()); }
}

export const REST_RIG = (n: number): Pick<RigState, 'root' | 'parts'> => ({ root: { offset: [0, 0, 0], rotation: QI }, parts: Array.from({ length: n }, () => ({ offset: [0, 0, 0] as P3, rotation: QI })) });
