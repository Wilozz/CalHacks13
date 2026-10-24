import type { ModelPart, ModelSpec, PartShape, V3 } from './types';

const SHAPES: readonly PartShape[] = ['cylinder', 'box', 'sphere', 'cone'];
const clamp = (n: unknown, lo: number, hi: number, d = 0) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
const vec = (v: unknown, lo: number, hi: number, d: number): V3 => {
  const a = Array.isArray(v) ? v : [];
  return [clamp(a[0], lo, hi, d), clamp(a[1], lo, hi, d), clamp(a[2], lo, hi, d)];
};

export const movingTop = (m: ModelSpec): number => {
  const mv = m.parts.filter(p => p.moving);
  return Math.max(...(mv.length ? mv : m.parts).map(p => p.position[1] + p.size[1] / 2));
};

/** Validate a model written by Claude. Returns null when unusable so the caller can use a built-in. */
export function sanitizeModel(raw: unknown): ModelSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.parts)) return null;
  const parts: ModelPart[] = r.parts.slice(0, 10).flatMap((p: any): ModelPart[] => {
    if (!p || !SHAPES.includes(p.shape)) return [];
    return [{
      shape: p.shape,
      size: vec(p.size, 0.02, 1.6, 0.2),
      position: vec(p.position, -1.2, 1.2, 0),
      color: typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#64f5ed',
      moving: p.moving === true,
    }];
  });
  if (!parts.length) return null;
  const moving = parts.filter(p => p.moving);
  const centroid: V3 = moving.length
    ? [0, 1, 2].map(i => moving.reduce((a, p) => a + p.position[i], 0) / moving.length) as V3
    : [0, 0, 0];
  const pivot = Array.isArray(r.pivot) ? vec(r.pivot, -1.2, 1.2, 0) : centroid;
  return normalize({ parts, pivot });
}

/** Fit the model's largest dimension to 1 unit and center it, so a lone cap is as readable as a whole bottle. */
export function normalize(m: ModelSpec): ModelSpec {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of m.parts) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], p.position[i] - p.size[i] / 2); hi[i] = Math.max(hi[i], p.position[i] + p.size[i] / 2);
  }
  const f = 1 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const c = [0, 1, 2].map(i => (lo[i] + hi[i]) / 2);
  const move = (v: V3): V3 => [0, 1, 2].map(i => (v[i] - c[i]) * f) as V3;
  return {
    parts: m.parts.map(p => ({ ...p, size: p.size.map(n => n * f) as V3, position: move(p.position) })),
    pivot: move(m.pivot),
  };
}

const P = (shape: PartShape, size: V3, position: V3, color: string, moving = false): ModelPart => ({ shape, size, position, color, moving });
const C = '#64f5ed';

/** Fallback twins for when vision gave no model. Same schema, so one renderer handles both. */
export const BUILTIN_MODELS = {
  bottle: { pivot: [0, 0.47, 0], parts: [P('cylinder', [0.42, 0.76, 0.42], [0, -0.12, 0], C), P('cylinder', [0.18, 0.2, 0.18], [0, 0.36, 0], C), P('cylinder', [0.24, 0.1, 0.24], [0, 0.47, 0], '#c8fff9', true), P('box', [0.03, 0.1, 0.05], [0.12, 0.47, 0], '#ffffff', true)] },
  knob: { pivot: [0, -0.18, 0], parts: [P('cylinder', [0.76, 0.14, 0.76], [0, -0.4, 0], C), P('cylinder', [0.58, 0.3, 0.58], [0, -0.18, 0], '#c8fff9', true), P('box', [0.18, 0.03, 0.05], [0.2, -0.02, 0], '#ffffff', true)] },
  button: { pivot: [0, -0.22, 0], parts: [P('box', [0.8, 0.2, 0.8], [0, -0.4, 0], C), P('cylinder', [0.4, 0.16, 0.4], [0, -0.22, 0], '#c8fff9', true)] },
  switch: { pivot: [0, 0, 0.07], parts: [P('box', [0.55, 0.9, 0.1], [0, 0, -0.05], C), P('box', [0.1, 0.42, 0.1], [0, 0.2, 0.07], '#c8fff9', true), P('sphere', [0.2, 0.2, 0.2], [0, 0.42, 0.07], '#ffffff', true)] },
  box: { pivot: [0, 0, 0], parts: [P('box', [0.95, 0.6, 0.7], [0, 0, 0], C), P('box', [0.85, 0.45, 0.55], [0, 0, 0.05], '#c8fff9', true), P('box', [0.3, 0.06, 0.08], [0, 0.02, 0.36], '#ffffff', true)] },
} satisfies Record<string, ModelSpec>;
