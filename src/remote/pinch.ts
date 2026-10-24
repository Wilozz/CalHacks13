import type { HandFrame } from '../coordinates';

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Thumb tip to index tip, divided by the rigid palm length, so it does not change with distance to the camera.
 * About 0.2 when pinched, 1 or more with the hand open. Uses the estimated metric landmarks when present.
 */
export function pinchRatio(frame: HandFrame): number | null {
  const world = frame.worldLandmarks.length === 21;
  const lm = world ? frame.worldLandmarks : frame.landmarks;
  if (lm.length !== 21) return null;
  const palm = world ? dist(lm[0], lm[9]) : Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
  if (!(palm > 1e-6)) return null;
  const gap = world ? dist(lm[4], lm[8]) : Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  return gap / palm;
}

/** 0 = fully open, 1 = pinched: for drawing a ring that closes as the fingers meet. */
export const pinchCloseness = (ratio: number | null) => ratio === null ? 0 : Math.min(1, Math.max(0, (0.95 - ratio) / (0.95 - 0.3)));

/**
 * Pinch with hysteresis (engages below `engage`, releases above `release`) and a short confirmation, so
 * landmark jitter around the threshold does not drop or flicker a grab.
 */
export class PinchDetector {
  pinching = false;
  ratio: number | null = null;
  private streak = 0;
  constructor(private readonly engage = 0.4, private readonly release = 0.62, private readonly confirm = 2) {}

  update(frame: HandFrame | null): boolean {
    this.ratio = frame ? pinchRatio(frame) : null;
    if (this.ratio === null) { this.reset(); return false; }
    const wants = this.pinching ? this.ratio < this.release : this.ratio < this.engage;
    if (wants === this.pinching) { this.streak = 0; return this.pinching; }
    if (++this.streak >= this.confirm) { this.pinching = wants; this.streak = 0; }
    return this.pinching;
  }

  reset() { this.pinching = false; this.streak = 0; }
}
