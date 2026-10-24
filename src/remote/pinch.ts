import type { HandFrame } from '../coordinates';

type XY = { x: number; y: number };
export const CAMERA_ASPECT = 4 / 3; // landmarks are normalized per axis; the trackers ask for 640x480
const d2 = (a: XY, b: XY, aspect: number) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** Palm size on the image: the larger of its length and width, so tilting the hand toward the camera does not shrink it to nothing. */
export function palmSize(frame: HandFrame, aspect = CAMERA_ASPECT): number | null {
  const l = frame.landmarks;
  if (l.length !== 21) return null;
  const s = Math.max(d2(l[0], l[9], aspect), d2(l[5], l[17], aspect));
  return s > 1e-6 ? s : null;
}

/**
 * Thumb tip to index tip over palm size, on the 2D image landmarks. Measured on real photos with MediaPipe:
 * touching fingertips 0.05-0.15, fist 0.2, open or pointing hands 0.67-1.4. The 3D "world" landmarks are not
 * used: their depth guess pushes touching fingertips apart (0.48-0.79), so a real pinch never registered.
 */
export function pinchRatio(frame: HandFrame, aspect = CAMERA_ASPECT): number | null {
  const palm = palmSize(frame, aspect);
  return palm === null ? null : d2(frame.landmarks[4], frame.landmarks[8], aspect) / palm;
}

/** Farthest fingertip from the wrist over palm size. Fist 0.8-0.9; open, pointing or peace sign 1.6-2.3. */
export function fistRatio(frame: HandFrame, aspect = CAMERA_ASPECT): number | null {
  const palm = palmSize(frame, aspect), l = frame.landmarks;
  return palm === null ? null : Math.max(...[8, 12, 16, 20].map(i => d2(l[i], l[0], aspect))) / palm;
}

/** 0 = fully open, 1 = pinched: for drawing a ring that closes as the fingers meet. */
export const pinchCloseness = (ratio: number | null) => ratio === null ? 0 : Math.min(1, Math.max(0, (0.85 - ratio) / (0.85 - 0.25)));

export interface GripOptions { engage?: number; release?: number; confirm?: number; fist?: boolean }

/**
 * Pinch (and optionally fist) with hysteresis and a short confirmation, so landmark jitter around a threshold
 * does not drop or flicker a grab. Only new tracker frames count: callers may pass the same frame on every
 * render, and counting it twice would turn the confirmation into a no-op.
 */
export class PinchDetector {
  pinching = false;
  ratio: number | null = null;
  fist: number | null = null;
  private streak = 0;
  private last: HandFrame | null = null;
  private readonly engage: number; private readonly release: number; private readonly confirm: number; private readonly useFist: boolean;
  constructor({ engage = 0.32, release = 0.48, confirm = 2, fist = false }: GripOptions = {}) {
    this.engage = engage; this.release = release; this.confirm = confirm; this.useFist = fist;
  }

  update(frame: HandFrame | null): boolean {
    if (frame && frame === this.last) return this.pinching;
    this.last = frame;
    this.ratio = frame ? pinchRatio(frame) : null;
    this.fist = frame && this.useFist ? fistRatio(frame) : null;
    if (this.ratio === null) { this.reset(); return false; }
    const pinch = this.pinching ? this.ratio < this.release : this.ratio < this.engage;
    const fist = this.fist !== null && (this.pinching ? this.fist < 1.4 : this.fist < 1.2);
    const wants = pinch || fist;
    if (wants === this.pinching) { this.streak = 0; return this.pinching; }
    if (++this.streak >= this.confirm) { this.pinching = wants; this.streak = 0; }
    return this.pinching;
  }

  reset() { this.pinching = false; this.streak = 0; this.last = null; }
}
