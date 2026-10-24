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
}
export const DEFAULT_PLACEMENT: Placement = { mode: 'follow', size: 0.38, reach: 1, flipX: true, pin: null, gain: 1 };

export type P3 = [number, number, number];
const HELPER_ASPECT = 4 / 3;
const OPEN_HAND_PER_PALM = 1.95;

/** Helper-camera point -> normalized feed point, applying reach about the center and the selfie flip. */
export function mapToFeed(p: { x: number; y: number }, pl: Placement) {
  const reach = Math.max(0.2, pl.reach);
  const u = (p.x - 0.5) / reach + 0.5, v = (p.y - 0.5) / reach + 0.5;
  return { x: pl.flipX ? 1 - u : u, y: v };
}

const len = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Turns the helper's landmarks into 21 points in feed units (height 1, width = aspect, y up).
 * The index fingertip is the anchor, so "point here" lands where the helper pointed. The hand's shape
 * (finger curl, wrist roll) comes from the estimated world landmarks when present.
 * Monocular landmarks do not know where a real component is, so this places the hand on the feed; it
 * does not align it to an object.
 */
export class HandPlacer {
  private ref: { x: number; y: number } | null = null;
  private pinKey = '';

  reset() { this.ref = null; }

  place(frame: HandFrame, pl: Placement, aspect: number): P3[] | null {
    const lm = frame.landmarks;
    if (lm.length !== 21) { this.reset(); return null; }
    const world = frame.worldLandmarks.length === 21;
    const src = world ? frame.worldLandmarks : lm;
    const ax = world ? 1 : HELPER_ASPECT; // image x is a fraction of width, y of height
    // Size from the rigid palm (wrist to middle knuckle), not a fingertip: a pointing hand curls that finger,
    // and sizing by it would blow the hand up. An open hand is about OPEN_HAND_PER_PALM times its palm length.
    const palm = world ? len(src[0], src[9]) : Math.hypot((src[9].x - src[0].x) * ax, src[9].y - src[0].y);
    const handLen = palm * OPEN_HAND_PER_PALM;
    if (!(handLen > 1e-6)) return null;
    const k = pl.size / handLen;
    const dir = pl.flipX ? -1 : 1;
    const shape: P3[] = src.map(p => [dir * (p.x - src[0].x) * ax * k, -(p.y - src[0].y) * k, -(p.z - src[0].z) * k]);

    const tip = mapToFeed(lm[8], pl);
    const key = pl.mode === 'pinned' && pl.pin ? `${pl.pin.x},${pl.pin.y}` : '';
    if (key !== this.pinKey) { this.pinKey = key; this.ref = null; }
    let anchor = { x: tip.x * aspect, y: 1 - tip.y };
    if (key && pl.pin) {
      this.ref ??= { x: tip.x, y: tip.y };
      anchor = { x: (pl.pin.x + (tip.x - this.ref.x) * pl.gain) * aspect, y: 1 - (pl.pin.y + (tip.y - this.ref.y) * pl.gain) };
    }
    const t = shape[8];
    return shape.map(s => [anchor.x + s[0] - t[0], anchor.y + s[1] - t[1], s[2] - t[2]] as P3);
  }
}
