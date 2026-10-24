import type { HandFrame } from '../coordinates';
import type { ModelSpec } from '../ai/types';
import type { GraspKind } from './grasp';
import { depthScale, handShape, mapToFeed, type P3, type Placement } from './placement';

export interface TwinHand {
  points: P3[];
  /** 0..1 in the object's box; outside means the helper is pointing next to the object */
  a: number; b: number;
  onObject: boolean;
}

export const modelBounds = (m: ModelSpec) => {
  const lo: P3 = [Infinity, Infinity, Infinity], hi: P3 = [-Infinity, -Infinity, -Infinity];
  for (const p of m.parts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.position[i] - p.size[i] / 2); hi[i] = Math.max(hi[i], p.position[i] + p.size[i] / 2); }
  return { lo, hi };
};

const HAND_MIN = 0.5, HAND_MAX = 1.6; // hand length in object units; keeps both readable in a small box
const A_MIN = -2, A_MAX = 3;           // how far past the object's box the fingertip may be mapped (dragging needs room)

export interface TipOnTwin { a: number; b: number; target: P3; onObject: boolean; length: number }

/**
 * Where the helper's fingertip is on the 3D copy (before any movement of the copy). The fingertip is mapped
 * into the feed (the recipient's camera), then into the object's bounding box there, then onto the front of
 * the model: pointing at the top-left of the cap on the feed is the top-left of the cap model.
 *
 * posFlip: mirror the fingertip's x on the way in. True for a remote helper who moves their hand like a
 * selfie; false in the solo demo, where the object and the hand share one raw camera frame.
 * length: the hand is sized as it is on the feed relative to the object, clamped so a small object does not
 * vanish under a huge hand.
 */
export function fingertipOnTwin(frame: HandFrame, pl: Placement, model: ModelSpec, bbox: [number, number, number, number], feedAspect: number, posFlip: boolean, from?: { x: number; y: number }): TipOnTwin | null {
  if (frame.landmarks.length !== 21) return null;
  const [x0, y0, x1, y1] = bbox;
  const bw = x1 - x0, bh = y1 - y0;
  if (!(bw > 0 && bh > 0)) return null;

  const tip = mapToFeed(from ?? frame.landmarks[8], { ...pl, flipX: posFlip });
  const a = (tip.x - x0) / bw, b = (tip.y - y0) / bh;
  const ca = Math.min(A_MAX, Math.max(A_MIN, a)), cb = Math.min(A_MAX, Math.max(A_MIN, b));

  const { lo, hi } = modelBounds(model);
  const target: P3 = [lo[0] + ca * (hi[0] - lo[0]), hi[1] - cb * (hi[1] - lo[1]), hi[2] + 0.04];

  const objectOnFeed = Math.max(bw * feedAspect, bh);
  const modelSize = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const length = Math.min(HAND_MAX, Math.max(HAND_MIN, ((pl.size * depthScale(frame, pl)) / objectOnFeed) * modelSize));
  return { a, b, target, onObject: a >= 0 && a <= 1 && b >= 0 && b <= 1, length };
}

const mean = (shape: P3[], idx: number[]): P3 => [0, 1, 2].map(i => idx.reduce((s, k) => s + shape[k][i], 0) / idx.length) as P3;
/** Which fingertips the hold point sits between: just the index when pointing, thumb + index for a pinch, thumb + index + middle for a grip. */
export const HOLD_FINGERS: Record<GraspKind, number[]> = { none: [8], pinch: [4, 8], grip: [4, 8, 12] };

/**
 * The hand's 21 points on the copy, with the holding fingers' meeting point at `anchor` (default: where they
 * are pointing). `from` is the same meeting point in image coordinates, so hit-testing and drawing agree.
 */
export function placeHandOnTwin(frame: HandFrame, pl: Placement, model: ModelSpec, bbox: [number, number, number, number], feedAspect: number, posFlip: boolean, anchor?: P3, kind: GraspKind = 'none', from?: { x: number; y: number }): TwinHand | null {
  const tip = fingertipOnTwin(frame, pl, model, bbox, feedAspect, posFlip, from);
  const shape = tip && handShape(frame, tip.length, pl.flipX);
  if (!tip || !shape) return null;
  const at = anchor ?? tip.target, t = mean(shape, HOLD_FINGERS[kind]);
  return {
    points: shape.map(s => [at[0] + s[0] - t[0], at[1] + s[1] - t[1], at[2] + s[2] - t[2]] as P3),
    a: tip.a, b: tip.b, onObject: tip.onObject,
  };
}
