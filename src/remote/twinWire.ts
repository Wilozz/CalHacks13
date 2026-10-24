import { sanitizeModel } from '../ai/modelSpec';
import type { ModelSpec } from '../ai/types';

/** The object a helper is guiding with, shared over a reliable data channel so both screens show the same box. */
export interface TwinInfo {
  objectId: string;
  label: string;
  model: ModelSpec;
  /** the object's box in the recipient's camera frame, normalized, origin top-left */
  bbox: [number, number, number, number];
  /** aspect ratio of that camera frame */
  feedAspect: number;
}

const MAX_BYTES = 20_000;
const clamp01 = (n: unknown) => Math.min(1, Math.max(0, Number(n)));

export const encodeTwin = (t: TwinInfo | null): string => JSON.stringify(t ? { type: 'twin', ...t } : { type: 'twin-clear' });

/** undefined = not a twin message or invalid (ignore it); null = clear; otherwise a validated twin. Never trusts the peer. */
export function decodeTwin(text: string): TwinInfo | null | undefined {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return undefined;
  let m: any;
  try { m = JSON.parse(text); } catch { return undefined; }
  if (!m || typeof m !== 'object') return undefined;
  if (m.type === 'twin-clear') return null;
  if (m.type !== 'twin' || !Array.isArray(m.bbox) || m.bbox.length !== 4) return undefined;
  const model = sanitizeModel(m.model);
  const [x0, y0, x1, y1] = m.bbox.map(clamp01);
  const aspect = Number(m.feedAspect);
  if (!model || !(x1 > x0 && y1 > y0) || !Number.isFinite(aspect) || aspect < 0.3 || aspect > 4) return undefined;
  return { objectId: String(m.objectId ?? '').slice(0, 40), label: String(m.label ?? 'object').slice(0, 60), model, bbox: [x0, y0, x1, y1], feedAspect: aspect };
}

/** Where the helper has moved and turned the copy. The helper's side computes it; the recipient just displays it. */
export interface TwinPose { offset: [number, number, number]; rotation: [number, number, number, number]; grabbing: boolean; kind: 'none' | 'pinch' | 'grip'; anchor: [number, number, number] | null }
export const REST_POSE: TwinPose = { offset: [0, 0, 0], rotation: [0, 0, 0, 1], grabbing: false, kind: 'none', anchor: null };
const num = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.min(2, Math.max(-2, v)) : 0; };
const vec3 = (v: unknown): [number, number, number] | null => Array.isArray(v) && v.length === 3 ? [num(v[0]), num(v[1]), num(v[2])] : null;
const KINDS: TwinPose['kind'][] = ['none', 'pinch', 'grip'];
const unitQuat = (v: unknown): [number, number, number, number] => {
  if (!Array.isArray(v) || v.length !== 4) return [0, 0, 0, 1];
  const q = v.map(Number); const n = Math.hypot(...q);
  return q.every(Number.isFinite) && n > 1e-6 ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : [0, 0, 0, 1];
};

export const encodePose = (p: TwinPose): string => JSON.stringify({
  type: 'twin-pose', o: p.offset.map(v => +v.toFixed(3)), q: p.rotation.map(v => +v.toFixed(4)), g: p.grabbing ? 1 : 0,
  k: KINDS.indexOf(p.kind), h: p.anchor ? p.anchor.map(v => +v.toFixed(3)) : null,
});

/** null = not a pose message or invalid. Values are clamped and the rotation is renormalized, never trusted. */
export function decodePose(text: string): TwinPose | null {
  if (typeof text !== 'string' || text.length > 500) return null;
  let m: any;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || m.type !== 'twin-pose') return null;
  const offset = vec3(m.o);
  return offset ? { offset, rotation: unitQuat(m.q), grabbing: m.g === 1, kind: KINDS[m.k] ?? 'none', anchor: vec3(m.h) } : null;
}

/** A finished sentence, shared so both screens' listening agents hear the whole conversation. Text only: audio never leaves the device except to the speech service. */
export const encodeSay = (text: string): string => JSON.stringify({ type: 'say', text: text.slice(0, 600) });
export function decodeSay(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null;
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  return m && m.type === 'say' && typeof m.text === 'string' && m.text.trim() ? m.text.trim().slice(0, 600) : null;
}
