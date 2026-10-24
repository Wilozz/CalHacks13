import type { HandFrame } from '../coordinates';
import type { V3 } from './quat';

export type GraspKind = 'none' | 'pinch' | 'grip';

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * How closed the fingers are, relative to the rigid palm so distance to the camera does not matter:
 * thumb tip to index tip (pinch), and thumb tip to middle tip (grip, which also needs the middle finger in).
 */
export function graspRatios(frame: HandFrame): { pinch: number; middle: number } | null {
  const world = frame.worldLandmarks.length === 21;
  const lm = world ? frame.worldLandmarks : frame.landmarks;
  if (lm.length !== 21) return null;
  const d = world ? dist : (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
  const palm = d(lm[0], lm[9]);
  if (!(palm > 1e-6)) return null;
  return { pinch: d(lm[4], lm[8]) / palm, middle: d(lm[4], lm[12]) / palm };
}

/**
 * Pinch = thumb and index together. Grip = thumb, index and middle together (a firmer hold). Each switches
 * on and off at different thresholds and needs two steady frames, so jitter near a threshold never drops a hold.
 */
export class GraspDetector {
  kind: GraspKind = 'none';
  ratios: { pinch: number; middle: number } | null = null;
  private streak = 0;
  constructor(private readonly t = { pinchOn: 0.4, pinchOff: 0.62, gripOn: 0.5, gripOff: 0.8 }, private readonly confirm = 2) {}

  update(frame: HandFrame | null): GraspKind {
    this.ratios = frame ? graspRatios(frame) : null;
    if (!this.ratios) { this.reset(); return 'none'; }
    const { pinch, middle } = this.ratios, t = this.t;
    const pinchOn = this.kind === 'none' ? pinch < t.pinchOn : pinch < t.pinchOff;
    const gripOn = pinchOn && (this.kind === 'grip' ? middle < t.gripOff : middle < t.gripOn);
    const want: GraspKind = gripOn ? 'grip' : pinchOn ? 'pinch' : 'none';
    if (want === this.kind) { this.streak = 0; return this.kind; }
    if (++this.streak >= this.confirm) { this.kind = want; this.streak = 0; }
    return this.kind;
  }
  reset() { this.kind = 'none'; this.streak = 0; }
}

/** Where the fingers are holding, in image coordinates: between thumb and index, or among thumb, index and middle. */
export function grabPoint(frame: HandFrame, kind: GraspKind): { x: number; y: number } {
  const l = frame.landmarks;
  const pick = kind === 'grip' ? [4, 8, 12] : kind === 'pinch' ? [4, 8] : [8];
  return { x: pick.reduce((s, i) => s + l[i].x, 0) / pick.length, y: pick.reduce((s, i) => s + l[i].y, 0) / pick.length };
}

/**
 * How the hand is turned on screen: the angle of the palm (wrist to middle knuckle), y up. Turning your hand like
 * a knob changes it. It uses the palm, not the thumb-to-index line, because while pinching that line is a few
 * millimetres long and swings wildly as the fingers open or close.
 */
export const twistAngle = (p: V3[]): number => Math.atan2(p[9][1] - p[0][1], p[9][0] - p[0][0]);
