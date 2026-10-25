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

/** One piece's movement: how far its centre has moved, and how it has turned. */
export interface PieceWire { offset: [number, number, number]; rotation: [number, number, number, number] }
/**
 * Where the helper has moved and turned the copy. The helper's side computes it; the recipient just displays it.
 * `offset`/`rotation` are the whole object; `parts` are its separately movable components (the cap), relative to the whole.
 * `target` is what is held: -2 nothing, -1 the whole, 0.. a component.
 */
/** What the second hand is holding (the first hand's is in the pose itself). */
export interface HoldWire { target: number; kind: 'none' | 'pinch' | 'grip'; anchor: [number, number, number] | null }
export interface TwinPose {
  offset: [number, number, number]; rotation: [number, number, number, number]; grabbing: boolean; kind: 'none' | 'pinch' | 'grip';
  anchor: [number, number, number] | null; parts: PieceWire[]; target: number;
  second?: HoldWire | null;
  /** a lanyard: clipped on, how far the claw is open (0..1), and whether the open claw is at the hole */
  kit?: { joined: boolean; gate: number; near: boolean } | null;
  /** the sender's count, so a pose that arrives late (the pose channel is unordered) is dropped */
  seq?: number;
  /** when it arrived (this screen's clock); never sent */
  at?: number;
}
export const REST_POSE: TwinPose = { offset: [0, 0, 0], rotation: [0, 0, 0, 1], grabbing: false, kind: 'none', anchor: null, parts: [], target: -2 };
const MAX_PARTS = 4;
const num = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.min(2, Math.max(-2, v)) : 0; };
const vec3 = (v: unknown): [number, number, number] | null => Array.isArray(v) && v.length === 3 ? [num(v[0]), num(v[1]), num(v[2])] : null;
const KINDS: TwinPose['kind'][] = ['none', 'pinch', 'grip'];
const unitQuat = (v: unknown): [number, number, number, number] => {
  if (!Array.isArray(v) || v.length !== 4) return [0, 0, 0, 1];
  const q = v.map(Number); const n = Math.hypot(...q);
  return q.every(Number.isFinite) && n > 1e-6 ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : [0, 0, 0, 1];
};
const r3 = (v: number[]) => v.map(x => +x.toFixed(3));
const r4 = (v: number[]) => v.map(x => +x.toFixed(4));

export const encodePose = (p: TwinPose, seq?: number): string => JSON.stringify({
  type: 'twin-pose', ...(seq !== undefined ? { n: seq } : {}), o: r3(p.offset), q: r4(p.rotation), g: p.grabbing ? 1 : 0,
  k: KINDS.indexOf(p.kind), h: p.anchor ? r3(p.anchor) : null, t: p.target,
  c: p.parts.slice(0, MAX_PARTS).map(x => [...r3(x.offset), ...r4(x.rotation)]),
  s: p.second ? [p.second.target, KINDS.indexOf(p.second.kind), p.second.anchor ? r3(p.second.anchor) : null] : null,
  ...(p.kit ? { j: [p.kit.joined ? 1 : 0, Math.round(p.kit.gate * 100), p.kit.near ? 1 : 0] } : {}),
});

/** null = not a pose message or invalid. Values are clamped and rotations renormalized, never trusted. */
export function decodePose(text: string): TwinPose | null {
  if (typeof text !== 'string' || text.length > 1100) return null;
  let m: any;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || m.type !== 'twin-pose') return null;
  const offset = vec3(m.o);
  if (!offset) return null;
  const parts: PieceWire[] = (Array.isArray(m.c) ? m.c : []).slice(0, MAX_PARTS).flatMap((x: unknown): PieceWire[] =>
    Array.isArray(x) && x.length === 7 ? [{ offset: vec3(x.slice(0, 3))!, rotation: unitQuat(x.slice(3)) }] : []);
  const ok = (v: unknown) => (Number.isInteger(v) && (v as number) >= -2 && (v as number) < parts.length ? (v as number) : -2);
  const second: HoldWire | null = Array.isArray(m.s) && m.s.length === 3 ? { target: ok(m.s[0]), kind: KINDS[m.s[1]] ?? 'none', anchor: vec3(m.s[2]) } : null;
  const kit = Array.isArray(m.j) && m.j.length === 3 ? { joined: m.j[0] === 1, gate: Math.min(1, Math.max(0, Number(m.j[1]) / 100 || 0)), near: m.j[2] === 1 } : null;
  const seq = Number.isSafeInteger(m.n) && m.n >= 0 ? { seq: m.n as number } : {};
  return { offset, rotation: unitQuat(m.q), grabbing: m.g === 1, kind: KINDS[m.k] ?? 'none', anchor: vec3(m.h), parts, target: ok(m.t), second, ...(kit ? { kit } : {}), ...seq };
}

/** A finished sentence, shared so both screens' listening agents hear the whole conversation. Text only: audio never leaves the device except to the speech service. */
export const encodeSay = (text: string): string => JSON.stringify({ type: 'say', text: text.slice(0, 600) });
export function decodeSay(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null;
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  return m && m.type === 'say' && typeof m.text === 'string' && m.text.trim() ? m.text.trim().slice(0, 600) : null;
}
