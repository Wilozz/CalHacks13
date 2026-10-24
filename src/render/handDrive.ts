import { handRollDeg } from '../ai/handHistory';
import type { ActionSpec } from '../ai/types';
import { directionVector, travelUnits, type Pose, type Vec3 } from './motion';

type Lm = { x: number; y: number; z: number };
const wrap = (d: number) => ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const handSize = (lm: Lm[]) => Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 1e-6;

const SLIDE_GAIN = 2.2;  // twin units per frame height of fingertip travel
const PRESS_GAIN = 1.6;

/**
 * Turns the helper's live hand motion into the twin's pose, relative to where the hand was when it
 * first appeared (or since the last reset). Everything is in on-screen terms, so it matches what the
 * viewer of the preview sees, mirrored or not.
 */
export class HandDriver {
  private ref: { tip: { x: number; y: number }; size: number } | null = null;
  private lastRoll: number | null = null;
  private rollAcc = 0; // radians, positive = clockwise on screen
  private d = { x: 0, y: 0, grow: 0 }; // on-screen fingertip offset (x right, y down, frame heights) and size change
  private missing = 0;

  reset() { this.ref = null; this.lastRoll = null; this.rollAcc = 0; this.d = { x: 0, y: 0, grow: 0 }; }

  get tracking() { return this.ref !== null && this.missing === 0; }

  /** Call every render with the latest landmarks, or null when no fresh hand. */
  update(lm: Lm[] | null, aspect: number, mirrored: boolean, dt = 1 / 60) {
    if (!lm || lm.length !== 21) {
      this.missing += dt;
      if (this.missing > 0.8) this.reset(); // hand gone for a while: re-reference on return
      return;
    }
    this.missing = 0;
    const sign = mirrored ? -1 : 1;
    const roll = (handRollDeg(lm) * Math.PI) / 180 * sign;
    if (this.lastRoll !== null) this.rollAcc = clamp(this.rollAcc + wrap(roll - this.lastRoll), -20 * Math.PI, 20 * Math.PI);
    this.lastRoll = roll;
    const tip = lm[8];
    if (!this.ref) this.ref = { tip: { x: tip.x, y: tip.y }, size: handSize(lm) };
    this.d = { x: sign * (tip.x - this.ref.tip.x) * aspect, y: tip.y - this.ref.tip.y, grow: handSize(lm) / this.ref.size - 1 };
  }

  pose(spec: ActionSpec): Pose {
    const pos: Vec3 = [0, 0, 0];
    const rot: Vec3 = [0, 0, 0];
    let progress = 0;
    const { x, y, grow } = this.d;
    switch (spec.actionType) {
      case 'twist': {
        rot[1] = -this.rollAcc; // clockwise on screen = clockwise from above = negative about +y
        pos[1] = Math.sign(rot[1]) * Math.min(0.12, (Math.abs(rot[1]) / (Math.PI * 2)) * 0.05);
        progress = Math.min(1, Math.abs(this.rollAcc) / (Math.PI * 2 * (spec.amount.turns ?? 1)));
        break;
      }
      case 'press': {
        const depth = clamp(Math.max(y * PRESS_GAIN, grow * PRESS_GAIN * 1.5), 0, 0.2);
        pos[1] = -depth; progress = depth / 0.2;
        break;
      }
      case 'pull': case 'push': case 'slide': case 'lift': {
        const d = directionVector(spec);
        const max = travelUnits(spec.amount.distanceCm);
        const along = (d[0] * x + d[1] * -y + d[2] * grow * 1.5) * SLIDE_GAIN;
        const s = clamp(along, 0, max);
        pos[0] = d[0] * s; pos[1] = d[1] * s; pos[2] = d[2] * s; progress = s / max;
        break;
      }
      case 'flip': rot[2] = clamp(-this.rollAcc, -Math.PI / 4, Math.PI / 4); progress = (rot[2] / (Math.PI / 4) + 1) / 2; break;
      case 'tilt': rot[2] = clamp(-this.rollAcc, -Math.PI, Math.PI); progress = Math.abs(rot[2]) / Math.PI; break;
    }
    // + 0 turns -0 into 0 so idle poses compare and render cleanly.
    return { pos: pos.map(v => v + 0) as Vec3, rot: rot.map(v => v + 0) as Vec3, progress };
  }
}
