import type { GraspKind } from './grasp';
import type { P3 } from './placement';
import { QI, qAxisAngle, qInv, qMul, qRotate, type Q } from './quat';

export interface Bounds { lo: P3; hi: P3 }
export interface MoveState {
  offset: P3; rotation: Q; grabbing: boolean; kind: GraspKind; hover: boolean;
  /** world point where the hand's grip should be drawn, in step with the object (null when not holding) */
  anchor: P3 | null; atLimit: boolean;
}
export interface MoveInput {
  tip: P3;                // where the fingers are holding, on the copy
  kind: GraspKind;
  depth: number;          // hand distance factor; closer pulls the object toward the viewer
  twist: number;          // thumb-to-index angle on screen, radians
  palm: Q | null;         // palm orientation
  /** hold it still: follow the hand's position but not its turning (the other hand is working on a piece of it) */
  steady?: boolean;
}
/** A screwed-on piece (a cap): it turns in place and climbs `pitch` per radian until it has turned `free` radians, then comes loose. */
export interface Thread { pitch: number; free: number }

const Z_GAIN = 0.8;
const DEPTH_DEADZONE = 0.15; // apparent hand size wobbles by this much on its own, especially while twisting
const TWIST_GAIN = 1.2;
const wrap = (d: number) => ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

/**
 * Grab, move and turn the 3D copy.
 *  - Pinch (thumb + index) on the object grabs it. It follows your hand, and twisting your fingers like a knob spins it about its vertical axis.
 *  - Grip (thumb + index + middle) holds it firmly: the object follows your whole hand's orientation in 3D.
 *  - It turns about the spot you are holding, so that spot stays under your fingers.
 *  - Switching between pinch and grip mid-hold does not make it jump. Letting go leaves it as it is.
 *  - A screwed-on piece only turns (and climbs its thread) until it comes loose; hand jitter cannot drag it off the neck.
 * The hit test uses the object's current position, so a moved object can be grabbed again where it now is.
 */
export class TwinMover {
  offset: P3 = [0, 0, 0];
  rotation: Q = QI;
  grabbing = false;
  kind: GraspKind = 'none';
  /** how far a threaded piece has been turned in total, either way (radians) */
  turned = 0;
  private steady = false;
  private start: { tip: P3; pivot: P3; zLift: number; offset: P3; rot: Q; depth: number; palm: Q | null; hold: P3; turned: number } | null = null;
  private twistPrev = 0;
  private twistAcc = 0;
  /**
   * bounds are relative to `center`, the point the body turns about (the model's centre for the whole object, a cap's
   * own centre for the cap). `offset` is how far that centre has moved from where it started.
   */
  constructor(private readonly bounds: Bounds, private readonly limit: P3 = [0.55, 0.55, 0.5], private readonly margin = 0.18, private readonly center: P3 = [0, 0, 0], private readonly thread?: Thread) {}

  /** Still screwed on. */
  get seated() { return !!this.thread && this.turned < this.thread.free; }
  /** How far it is unscrewed, 0..1 (1 = loose), or null if it is not threaded. */
  get loosened(): number | null { return this.thread ? Math.min(1, this.turned / this.thread.free) : null; }

  hits(tip: P3): boolean { return this.distance(tip) <= this.margin; }
  /** How far a point is outside the piece, on screen (0 = over it). */
  distance(tip: P3): number {
    const { lo, hi } = this.bounds, o = this.offset, c = this.center;
    const dx = Math.max(lo[0] + c[0] + o[0] - tip[0], 0, tip[0] - hi[0] - c[0] - o[0]), dy = Math.max(lo[1] + c[1] + o[1] - tip[1], 0, tip[1] - hi[1] - c[1] - o[1]);
    return Math.max(dx, dy);
  }

  /** input null = no hand: the hold ends, the object stays as it is. */
  update(input: MoveInput | null): MoveState {
    if (!input) { this.release(); return this.state(false, false, null); }
    const grasping = input.kind !== 'none';
    const hover = !this.grabbing && this.hits(input.tip);
    if (!this.grabbing && grasping && hover) this.begin(input);
    else if (this.grabbing && !grasping) this.release();
    else if (this.grabbing && (input.kind !== this.kind || !!input.steady !== this.steady)) this.begin(input); // pinch <-> grip, steadied or not: re-baseline, no jump

    let atLimit = false, anchor: P3 | null = null;
    if (this.grabbing && this.start && this.seated) {
      // Still screwed on: it only turns about its own axis, and climbs as it does (either way, like a real thread), so a
      // shaky hand twists it in place instead of dragging it off the neck. Once turned far enough it comes loose.
      const s = this.start, c = this.center, { lo, hi } = this.bounds;
      this.twistAcc += wrap(input.twist - this.twistPrev); this.twistPrev = input.twist;
      const spin = this.twistAcc * TWIST_GAIN;
      this.turned = s.turned + Math.abs(spin);
      this.rotation = qMul(qAxisAngle([0, 1, 0], spin), s.rot);
      this.offset = [s.offset[0], Math.min(this.limit[1], Math.max(s.offset[1], this.thread!.pitch * this.turned)), s.offset[2]];
      // The fingers stay where they took hold (on the piece), rising with it.
      const clamp = (v: number, i: number) => Math.min(c[i] + this.offset[i] + hi[i], Math.max(c[i] + this.offset[i] + lo[i], v));
      anchor = [clamp(s.pivot[0], 0), clamp(s.pivot[1] + this.offset[1] - s.offset[1], 1), s.pivot[2] + this.offset[2] - s.offset[2] + s.zLift];
      if (!this.seated) this.begin(input); // loose: from here it follows the hand, from where it is now
    } else if (this.grabbing && this.start) {
      const s = this.start, L = this.limit;
      this.twistAcc += wrap(input.twist - this.twistPrev); this.twistPrev = input.twist;
      const rel: Q = input.steady ? QI : input.kind === 'grip'
        ? (input.palm && s.palm ? qMul(input.palm, qInv(s.palm)) : QI)
        : qAxisAngle([0, 1, 0], this.twistAcc * TWIST_GAIN);
      this.rotation = qMul(rel, s.rot);
      // Turn about the held point, taken at the object's own depth: the fingertip sits on its front surface, and
      // turning about that point would make a twisted cap orbit sideways instead of spinning in place.
      const c = this.center, dd = input.depth - s.depth, depthShift = Math.sign(dd) * Math.max(0, Math.abs(dd) - DEPTH_DEADZONE) * Z_GAIN;
      const v = qRotate(rel, [c[0] + s.offset[0] - s.pivot[0], c[1] + s.offset[1] - s.pivot[1], c[2] + s.offset[2] - s.pivot[2]]);
      const raw: P3 = [input.tip[0] + v[0] - c[0], input.tip[1] + v[1] - c[1], s.pivot[2] + depthShift + v[2] - c[2]];
      this.offset = raw.map((x, i) => Math.min(L[i], Math.max(-L[i], x))) as P3;
      atLimit = raw.some((x, i) => Math.abs(x) > L[i]);
      const h = qRotate(this.rotation, s.hold);
      // The grip is drawn at the front surface, in step with the object.
      anchor = [c[0] + this.offset[0] + h[0], c[1] + this.offset[1] + h[1], c[2] + this.offset[2] + h[2] + s.zLift];
    }
    return this.state(hover, atLimit, anchor);
  }

  private begin(input: MoveInput) {
    this.grabbing = true; this.kind = input.kind; this.steady = !!input.steady;
    const c = this.center, cz = c[2] + this.offset[2];
    const pivot: P3 = [input.tip[0], input.tip[1], cz];
    const rel: P3 = [pivot[0] - c[0] - this.offset[0], pivot[1] - c[1] - this.offset[1], 0];
    this.start = { tip: input.tip, pivot, zLift: input.tip[2] - cz, offset: [...this.offset], rot: this.rotation, depth: input.depth, palm: input.palm, hold: qRotate(qInv(this.rotation), rel), turned: this.turned };
    this.twistPrev = input.twist; this.twistAcc = 0;
  }

  release() { this.grabbing = false; this.kind = 'none'; this.steady = false; this.start = null; }
  reset() { this.release(); this.offset = [0, 0, 0]; this.rotation = QI; this.turned = 0; }
  private state(hover: boolean, atLimit: boolean, anchor: P3 | null): MoveState {
    return { offset: [...this.offset], rotation: this.rotation, grabbing: this.grabbing, kind: this.kind, hover, anchor, atLimit };
  }
}
