import type { HandFrame } from '../coordinates';
import { CAMERA_ASPECT, palmSize, pinchRatio } from './pinch';
import type { V3 } from './quat';

export type GraspKind = 'none' | 'pinch' | 'grip';

/**
 * How closed the fingers are, relative to the palm so distance to the camera does not matter: thumb tip to index
 * tip (pinch), and thumb tip to middle tip (grip, which also needs the middle finger in). Measured on the 2D image
 * landmarks like `pinchRatio`: the 3D world landmarks' depth guess pushes touching fingertips apart. On real photos
 * (handPhotos.json) a pinch is 0.05-0.15 / middle 0.88-1.14, a fist 0.2 / 0.29, open hands 1.0+ on pinch.
 */
export function graspRatios(frame: HandFrame): { pinch: number; middle: number } | null {
  const palm = palmSize(frame), pinch = pinchRatio(frame), l = frame.landmarks;
  if (palm === null || pinch === null) return null;
  return { pinch, middle: Math.hypot((l[4].x - l[12].x) * CAMERA_ASPECT, l[4].y - l[12].y) / palm };
}

/**
 * Pinch = thumb and index together. Grip = thumb, index and middle together (a firmer hold). Each switches
 * on and off at different thresholds and needs two steady frames, so jitter near a threshold never drops a hold.
 */
export class GraspDetector {
  kind: GraspKind = 'none';
  ratios: { pinch: number; middle: number } | null = null;
  private streak = 0;
  private last: HandFrame | null = null;
  constructor(private readonly t = { pinchOn: 0.32, pinchOff: 0.55, gripOn: 0.5, gripOff: 0.75 }, private readonly confirm = 2) {}

  /** Only new tracker frames count: the same frame passed on every render would make the confirmation a no-op. */
  update(frame: HandFrame | null): GraspKind {
    if (frame && frame === this.last) return this.kind;
    this.last = frame;
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
  reset() { this.kind = 'none'; this.streak = 0; this.last = null; }
}

/**
 * Where to hold, in image coordinates: always the index fingertip. It used to be the midpoint of the holding fingers,
 * but when you open your fingers the thumb swings away, the midpoint jumps with it, and the object is flung sideways
 * for the frames it takes to confirm the release. The index fingertip barely moves when the thumb lets go.
 */
export function grabPoint(frame: HandFrame, _kind: GraspKind = 'none'): { x: number; y: number } {
  const t = frame.landmarks[8];
  return { x: t.x, y: t.y };
}

/**
 * How the hand is turned on screen: the angle of the palm (wrist to middle knuckle), y up. Turning your hand like
 * a knob changes it. It uses the palm, not the thumb-to-index line, because while pinching that line is a few
 * millimetres long and swings wildly as the fingers open or close.
 */
export const twistAngle = (p: V3[]): number => Math.atan2(p[9][1] - p[0][1], p[9][0] - p[0][0]);
