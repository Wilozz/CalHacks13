import { sanitizeModel } from '../ai/modelSpec';
import type { ModelPart, ModelSpec, PartShape, V3 } from '../ai/types';

/** One object thrown across the call. Shape data only: the receiver rebuilds the hologram locally. */
export interface Toss { id: string; label: string; model: ModelSpec; spin: V3; scale: number }

export const MIN_SCALE = 0.5, MAX_SCALE = 2.2; // how far a hologram can be shrunk or stretched

const P = (shape: PartShape, size: V3, position: V3, color: string, moving = false): ModelPart => ({ shape, size, position, color, moving });

// Demo objects in the same ModelSpec format a Claude scan returns; no scan needed for the prototype.
export const TOSS_OBJECTS = {
  mug: { label: 'Mug', model: sanitizeModel({ parts: [
    P('cylinder', [0.66, 0.86, 0.66], [-0.06, -0.07, 0], '#ece6db'), P('cylinder', [0.6, 0.02, 0.6], [-0.06, 0.355, 0], '#3b2416'),
    P('box', [0.1, 0.44, 0.14], [0.4, -0.07, 0], '#ece6db'), P('box', [0.16, 0.09, 0.14], [0.32, 0.12, 0], '#ece6db'), P('box', [0.16, 0.09, 0.14], [0.32, -0.26, 0], '#ece6db'),
  ] })! },
  bottle: { label: 'Pill bottle', model: sanitizeModel({ parts: [
    P('cylinder', [0.46, 0.74, 0.46], [0, -0.13, 0], '#d9782a'), P('cylinder', [0.47, 0.34, 0.47], [0, -0.14, 0], '#f4efe6'),
    P('cylinder', [0.3, 0.06, 0.3], [0, 0.27, 0], '#c8691f'), P('cylinder', [0.5, 0.2, 0.5], [0, 0.4, 0], '#f6f3ee', true),
  ] })! },
  bear: { label: 'Teddy bear', model: sanitizeModel({ parts: [
    P('sphere', [0.62, 0.62, 0.5], [0, -0.19, 0], '#a8743f'), P('sphere', [0.36, 0.38, 0.12], [0, -0.2, 0.21], '#dcb98a'),
    P('sphere', [0.48, 0.44, 0.42], [0, 0.25, 0], '#a8743f'), P('sphere', [0.17, 0.17, 0.1], [-0.18, 0.44, 0], '#a8743f'),
    P('sphere', [0.17, 0.17, 0.1], [0.18, 0.44, 0], '#a8743f'), P('sphere', [0.2, 0.14, 0.14], [0, 0.2, 0.2], '#dcb98a'),
  ] })! },
} satisfies Record<string, { label: string; model: ModelSpec }>;
export type TossKind = keyof typeof TOSS_OBJECTS;

const MAX_BYTES = 20_000;
const num = (n: unknown, lim: number) => { const v = Number(n); return Number.isFinite(v) ? Math.min(lim, Math.max(-lim, v)) : 0; };

export const encodeToss = (t: Toss): string => JSON.stringify({ type: 'toss', id: t.id, label: t.label, model: t.model, spin: t.spin.map(v => +v.toFixed(2)), scale: +t.scale.toFixed(3) });

/** null = not a toss or invalid. Never trusts the peer: the model goes through the same validation as a Claude scan. */
export function decodeToss(text: unknown): Toss | null {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return null;
  let m: any;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || m.type !== 'toss') return null;
  const model = sanitizeModel(m.model);
  if (!model) return null;
  const spin = Array.isArray(m.spin) ? m.spin : [];
  const scale = Number(m.scale);
  return { id: String(m.id ?? '').slice(0, 16), label: String(m.label ?? 'Object').slice(0, 40), model, spin: [num(spin[0], 20), num(spin[1], 20), num(spin[2], 20)],
    scale: Number.isFinite(scale) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) : 1 };
}

export interface Sample { t: number; x: number; y: number }

/**
 * Release velocity (units per second): the fastest stretch of at least `span` seconds within the last `window`.
 * A flick peaks just before letting go, and a pinch is only seen as released a frame or two later, so the
 * plain last-samples speed reads a throw as a drop.
 */
export function releaseVelocity(hist: Sample[], window = 0.2, span = 0.05): [number, number] {
  if (hist.length < 2) return [0, 0];
  const end = hist[hist.length - 1].t;
  let best: [number, number] = [0, 0], bestSpeed = 0;
  for (let i = hist.length - 1, j = i; i > 0 && end - hist[i].t <= window; i--) {
    j = Math.min(j, i - 1);
    while (j > 0 && hist[i].t - hist[j].t < span) j--;
    const dt = hist[i].t - hist[j].t;
    if (dt <= 1e-3) continue;
    const v: [number, number] = [(hist[i].x - hist[j].x) / dt, (hist[i].y - hist[j].y) / dt], speed = Math.hypot(v[0], v[1]);
    if (speed > bestSpeed) { bestSpeed = speed; best = v; }
  }
  return best;
}

export const MIN_HOLD = 0.25;  // s: a grab-and-let-go faster than this is a fumble, never a throw
export const PUSH_RATE = 1.6;  // palm growing this fast (log size per second) = a push toward the screen
/**
 * A release is a throw only if it was held a moment, then pushed toward the screen or flicked up-and-forward
 * (within about 55° of straight up). Fast sideways or downward moves, and slow releases, are drops.
 */
export function isThrow(heldFor: number, [vx, vy]: [number, number], push: number, minSpeed: number): boolean {
  if (heldFor < MIN_HOLD) return false;
  if (push > PUSH_RATE) return true;
  return Math.hypot(vx, vy) > minSpeed && vy > 0 && vy >= Math.abs(vx) * 0.7;
}
