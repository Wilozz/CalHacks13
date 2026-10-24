import type { ModelPart, ModelSpec } from '../ai/types';
import type { P3 } from './placement';

/** A piece of the object you can grab on its own: the cap, a button, a lever. The rest is "the whole". */
export interface Component {
  index: number;
  name: string;
  /** indices into model.parts */
  parts: number[];
  /** where it turns about (its own centre), in the model's frame */
  center: P3;
  /** box around it, relative to its centre */
  lo: P3; hi: P3;
}

const box = (ps: ModelPart[]) => {
  const lo: P3 = [Infinity, Infinity, Infinity], hi: P3 = [-Infinity, -Infinity, -Infinity];
  for (const p of ps) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.position[i] - p.size[i] / 2); hi[i] = Math.max(hi[i], p.position[i] + p.size[i] / 2); }
  return { lo, hi };
};
const gap = (a: ModelPart, b: ModelPart) => {
  let g = 0;
  for (let i = 0; i < 3; i++) g = Math.max(g, Math.abs(a.position[i] - b.position[i]) - (a.size[i] + b.size[i]) / 2);
  return g;
};

const MAX_COMPONENTS = 4;
const JOIN_GAP = 0.03; // moving pieces closer than this belong to the same component (a cap and its grip ridge)

/**
 * Splits a model into the parts that move on their own and the whole. Moving parts that touch form one component;
 * a model where everything moves (or nothing does) has no separate components, only the whole.
 */
export function componentsOf(model: ModelSpec): Component[] {
  const moving = model.parts.map((p, i) => ({ p, i })).filter(x => x.p.moving);
  if (!moving.length || moving.length === model.parts.length) return [];
  const group = moving.map((_, k) => k);
  const find = (k: number): number => (group[k] === k ? k : (group[k] = find(group[k])));
  for (let a = 0; a < moving.length; a++) for (let b = a + 1; b < moving.length; b++) if (gap(moving[a].p, moving[b].p) <= JOIN_GAP) group[find(b)] = find(a);

  const clusters = new Map<number, typeof moving>();
  moving.forEach((m, k) => { const r = find(k); clusters.set(r, [...(clusters.get(r) ?? []), m]); });
  const vol = (c: typeof moving) => { const { lo, hi } = box(c.map(x => x.p)); return (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]); };
  return [...clusters.values()].sort((a, b) => vol(b) - vol(a)).slice(0, MAX_COMPONENTS).map((c, index) => {
    const { lo, hi } = box(c.map(x => x.p));
    const center: P3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    return {
      index, parts: c.map(x => x.i), center,
      name: c.map(x => x.p.name).find(n => !!n) ?? 'moving part',
      lo: [lo[0] - center[0], lo[1] - center[1], lo[2] - center[2]], hi: [hi[0] - center[0], hi[1] - center[1], hi[2] - center[2]],
    };
  });
}

/** Box around the entire model. */
export const wholeBounds = (model: ModelSpec) => box(model.parts);
