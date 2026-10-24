import type { P3 } from './placement';

export interface Bounds { lo: P3; hi: P3 }
export interface MoveState { offset: P3; grabbing: boolean; hover: boolean; hold: P3 | null; atLimit: boolean }

const Z_GAIN = 0.8; // hand closer to the helper's camera pulls the object toward the viewer

/**
 * Grab-and-move for the 3D copy. Pinching with the fingertip on the object grabs it; while pinched the object
 * follows the fingertip; letting go leaves it where it is. The hit test uses the object's current position,
 * so a moved object can be grabbed again where it now is.
 */
export class TwinMover {
  offset: P3 = [0, 0, 0];
  grabbing = false;
  hold: P3 | null = null; // the grabbed point, in the object's own coordinates
  private start: { tip: P3; offset: P3; depth: number } | null = null;
  constructor(private readonly bounds: Bounds, private readonly limit: P3 = [0.7, 0.7, 0.5], private readonly margin = 0.18) {}

  hits(tip: P3): boolean {
    const { lo, hi } = this.bounds, o = this.offset, m = this.margin;
    return tip[0] >= lo[0] + o[0] - m && tip[0] <= hi[0] + o[0] + m && tip[1] >= lo[1] + o[1] - m && tip[1] <= hi[1] + o[1] + m;
  }

  /** input null = no hand: the grab ends, the object stays put. */
  update(input: { tip: P3; pinching: boolean; depth: number } | null): MoveState {
    if (!input) { this.release(); return this.state(false, false); }
    const hover = !this.grabbing && this.hits(input.tip);
    if (!this.grabbing && input.pinching && hover) {
      this.grabbing = true;
      this.start = { tip: input.tip, offset: [...this.offset], depth: input.depth };
      this.hold = [input.tip[0] - this.offset[0], input.tip[1] - this.offset[1], input.tip[2] - this.offset[2]];
    } else if (this.grabbing && !input.pinching) this.release();

    let atLimit = false;
    if (this.grabbing && this.start) {
      const s = this.start, L = this.limit;
      const raw: P3 = [s.offset[0] + (input.tip[0] - s.tip[0]), s.offset[1] + (input.tip[1] - s.tip[1]), s.offset[2] + (input.depth - s.depth) * Z_GAIN];
      this.offset = raw.map((v, i) => Math.min(L[i], Math.max(-L[i], v))) as P3;
      atLimit = raw.some((v, i) => Math.abs(v) > L[i]);
    }
    return this.state(hover, atLimit);
  }

  release() { this.grabbing = false; this.start = null; this.hold = null; }
  reset() { this.release(); this.offset = [0, 0, 0]; }
  private state(hover: boolean, atLimit: boolean): MoveState { return { offset: [...this.offset], grabbing: this.grabbing, hover, hold: this.hold, atLimit }; }
}
