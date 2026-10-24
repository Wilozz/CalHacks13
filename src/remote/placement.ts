import type { HandFrame } from '../coordinates';

export interface Placement {
  mode: 'follow' | 'pinned';
  /** length of an open hand (wrist to middle fingertip) as a fraction of the feed height */
  size: number;
  /** fraction of the helper's camera frame that maps onto the whole feed (smaller = more sensitive) */
  reach: number;
  /** mirror like the helper's selfie view, so moving right on their screen moves right on the feed */
  flipX: boolean;
  pin: { x: number; y: number } | null; // normalized feed coordinates, origin top-left
  /** pinned mode: how far the hand travels from the pin per unit of helper fingertip travel */
  gain: number;
  /** how strongly the helper's distance from their camera scales the hand: 0 = none, 1 = true to size, >1 exaggerates */
  depth: number;
}
export const DEFAULT_PLACEMENT: Placement = { mode: 'follow', size: 0.38, reach: 1, flipX: true, pin: null, gain: 1, depth: 1 };

export type P3 = [number, number, number];
const HELPER_ASPECT = 4 / 3;
const OPEN_HAND_PER_PALM = 1.95;
// Mean palm-bone length in frame heights for a hand at roughly 0.5 m from a typical webcam.
const REFERENCE_PALM = 0.18;
const PALM_BONES = [[0, 5], [0, 9], [0, 17], [5, 17]] as const;

/**
 * How big the helper's hand looks to their own camera, relative to a hand at about 0.5 m.
 * Bigger on their screen means closer to their camera. Uses image landmarks including z, so tilting the
 * palm does not read as moving away. Above 1 is closer than the reference, below 1 is farther.
 */
export function apparentScale(lm: { x: number; y: number; z: number }[]): number {
  if (lm.length !== 21) return 1;
  let sum = 0;
  for (const [a, b] of PALM_BONES) sum += Math.hypot((lm[b].x - lm[a].x) * HELPER_ASPECT, lm[b].y - lm[a].y, (lm[b].z - lm[a].z) * HELPER_ASPECT);
  const ratio = sum / PALM_BONES.length / REFERENCE_PALM;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/** Helper-camera point -> normalized feed point, applying reach about the center and the selfie flip. */
export function mapToFeed(p: { x: number; y: number }, pl: Placement) {
  const reach = Math.max(0.2, pl.reach);
  const u = (p.x - 0.5) / reach + 0.5, v = (p.y - 0.5) / reach + 0.5;
  return { x: pl.flipX ? 1 - u : u, y: v };
}

const len = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Depth multiplier for the hand's size, from how close the helper's hand is to their camera. */
export function depthScale(frame: HandFrame, pl: Placement): number {
  return Math.min(2.5, Math.max(0.4, Math.pow(apparentScale(frame.landmarks), pl.depth)));
}

/**
 * The hand's shape (finger curl, wrist roll) as 21 points relative to the wrist, with an open hand
 * `length` long. Sized from the rigid palm, not a fingertip: a pointing hand curls that finger, and
 * sizing by it would blow the hand up. flipX mirrors the shape like the helper's selfie view.
 */
export function handShape(frame: HandFrame, length: number, flipX: boolean): P3[] | null {
  const lm = frame.landmarks;
  if (lm.length !== 21) return null;
  const world = frame.worldLandmarks.length === 21;
  const src = world ? frame.worldLandmarks : lm;
  const ax = world ? 1 : HELPER_ASPECT; // image x is a fraction of width, y of height
  const palm = world ? len(src[0], src[9]) : Math.hypot((src[9].x - src[0].x) * ax, src[9].y - src[0].y);
  const palmLen = palm * OPEN_HAND_PER_PALM;
  if (!(palmLen > 1e-6)) return null;
  const k = length / palmLen, dir = flipX ? -1 : 1;
  return src.map(p => [dir * (p.x - src[0].x) * ax * k, -(p.y - src[0].y) * k, -(p.z - src[0].z) * k] as P3);
}

/**
 * Turns the helper's landmarks into 21 points in feed units (height 1, width = aspect, y up).
 * The index fingertip is the anchor, so "point here" lands where the helper pointed.
 * viewMirrored: the video it is drawn over is shown mirrored (a selfie view), so reflect the whole hand.
 * Monocular landmarks do not know where a real component is, so this places the hand on the feed; it
 * does not align it to an object.
 */
export class HandPlacer {
  private ref: { x: number; y: number } | null = null;
  private pinKey = '';

  reset() { this.ref = null; }

  place(frame: HandFrame, pl: Placement, aspect: number, viewMirrored = false): P3[] | null {
    const lm = frame.landmarks;
    const shape = handShape(frame, pl.size * depthScale(frame, pl), pl.flipX);
    if (lm.length !== 21 || !shape) { this.reset(); return null; }

    const tip = mapToFeed(lm[8], pl);
    const key = pl.mode === 'pinned' && pl.pin ? `${pl.pin.x},${pl.pin.y}` : '';
    if (key !== this.pinKey) { this.pinKey = key; this.ref = null; }
    let anchor = { x: tip.x * aspect, y: 1 - tip.y };
    if (key && pl.pin) {
      this.ref ??= { x: tip.x, y: tip.y };
      anchor = { x: (pl.pin.x + (tip.x - this.ref.x) * pl.gain) * aspect, y: 1 - (pl.pin.y + (tip.y - this.ref.y) * pl.gain) };
    }
    const t = shape[8];
    return shape.map(s => {
      const x = anchor.x + s[0] - t[0];
      return [viewMirrored ? aspect - x : x, anchor.y + s[1] - t[1], s[2] - t[2]] as P3;
    });
  }
}
