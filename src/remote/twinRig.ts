import type { ModelSpec } from '../ai/types';
import { componentsOf, wholeBounds, type Component } from './components';
import type { GraspKind } from './grasp';
import type { P3 } from './placement';
import { QI, qInv, qMul, qRotate, type Q } from './quat';
import { TwinMover, type MoveInput } from './twinMove';

export type Target = 'whole' | number;
const THREADED = /\b(cap|lid|cork|top|cover|stopper)\b/i;
export interface Rigid { offset: P3; rotation: Q }
export interface RigState {
  root: Rigid;
  /** each component's movement relative to the whole, so it rides along when the whole moves */
  parts: Rigid[];
  /** what the fingers are holding, if anything */
  target: Target | null;
  /** what they are over, when not holding */
  hover: Target | null;
  grabbing: boolean; kind: GraspKind;
  /** world point where the grip should be drawn */
  anchor: P3 | null;
}

/**
 * The object as a whole plus its separately movable components. Nothing is selected first: pinching or gripping
 * on the cap takes the cap (turn it, pull it off), and doing so anywhere else on the object takes the whole
 * thing, cap included. Components are tested first, because they sit on top of the body.
 */
export class TwinRig {
  readonly components: Component[];
  private readonly root: TwinMover;
  private readonly movers: TwinMover[];
  private active: Target | null = null;
  constructor(model: ModelSpec) {
    this.components = componentsOf(model);
    this.root = new TwinMover(wholeBounds(model));
    // Small pieces get a forgiving grab area, and caps/lids climb as they are twisted (about three turns frees one).
    this.movers = this.components.map(c => new TwinMover({ lo: c.lo, hi: c.hi }, [0.6, 0.6, 0.6], 0.18, c.center, THREADED.test(c.name) ? { pitch: 0.075 } : undefined));
  }

  private rootRot(): Q { return this.root.rotation; }
  /** world -> the whole's own frame */
  private toRoot(p: P3): P3 {
    const o = this.root.offset, r = qRotate(qInv(this.root.rotation), [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
    return r;
  }
  private fromRoot(p: P3): P3 { const r = qRotate(this.root.rotation, p), o = this.root.offset; return [r[0] + o[0], r[1] + o[1], r[2] + o[2]]; }

  private pick(tip: P3): Target | null {
    const local = this.toRoot(tip);
    const hit = this.movers.findIndex(m => m.hits(local));
    if (hit >= 0) return hit;
    return this.root.hits(tip) ? 'whole' : null;
  }

  update(input: MoveInput | null): RigState {
    const grasping = !!input && input.kind !== 'none';
    if (!input || !grasping) {
      // Letting go ends whatever was held; the pieces stay where they were left.
      this.active = null;
      const none = input ? { ...input, kind: 'none' as const } : null;
      this.root.update(none); this.movers.forEach(m => m.update(none ? { ...none, tip: this.toRoot(none.tip) } : null));
      return this.state(input ? this.pick(input.tip) : null, null);
    }

    if (this.active === null) {
      const t = this.pick(input.tip);
      if (t !== null) this.active = t;
      else return this.state(null, null);     // pinching on nothing grabs nothing
    }

    let anchor: P3 | null = null;
    if (this.active === 'whole') {
      anchor = this.root.update(input).anchor;
    } else {
      // A component is moved in the whole's frame, so it follows the whole and turns about its own axis even if the whole is tilted.
      const m = this.movers[this.active], rr = this.rootRot();
      const a = m.update({ ...input, tip: this.toRoot(input.tip), palm: input.palm ? qMul(qInv(rr), input.palm) : null }).anchor;
      anchor = a ? this.fromRoot(a) : null;
    }
    return this.state(null, anchor);
  }

  private state(hover: Target | null, anchor: P3 | null): RigState {
    return {
      root: { offset: [...this.root.offset], rotation: this.root.rotation },
      parts: this.movers.map(m => ({ offset: [...m.offset] as P3, rotation: m.rotation })),
      target: this.active, hover: this.active === null ? hover : null,
      grabbing: this.active !== null, kind: this.active !== null ? (this.active === 'whole' ? this.root.kind : this.movers[this.active].kind) : 'none',
      anchor,
    };
  }

  reset() { this.active = null; this.root.reset(); this.movers.forEach(m => m.reset()); }
}

export const REST_RIG = (n: number): Pick<RigState, 'root' | 'parts'> => ({ root: { offset: [0, 0, 0], rotation: QI }, parts: Array.from({ length: n }, () => ({ offset: [0, 0, 0] as P3, rotation: QI })) });
