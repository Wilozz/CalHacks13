import { wholeBounds } from '../remote/components';
import type { ModelPart, SceneObject, V3 } from './types';
import { tokenize } from '../voice/referent';

const STOP = new Set(['a', 'the', 'of', 'with', 'and', 'small', 'big', 'large', 'little']);
const words = (label: string) => tokenize(label).filter(w => !STOP.has(w)).map(w => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w));
const area = (b: SceneObject['bbox']) => (b[2] - b[0]) * (b[3] - b[1]);
const contains = (b: SceneObject['bbox'], x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** "bottle cap" and "bottle" share a word; so do "red button" and "button box". Colours and sizes do not count. */
const related = (child: SceneObject, parent: SceneObject) => {
  if (child.parentLabel && words(child.parentLabel).some(w => words(parent.label).includes(w))) return true;
  const a = words(child.label), b = words(parent.label);
  return a.some(w => b.includes(w));
};

// The part's name is its head noun: "bottle cap" -> cap, "lid on the book" -> lid (stop at the preposition).
const PREPOSITIONS = new Set(['on', 'in', 'of', 'with', 'for', 'at', 'from', 'to']);
/** Fraction of box `a` that lies inside box `b` (both as centre + size). */
const insideFrac = (a: ModelPart, b: { c: V3; s: V3 }) => {
  let inter = 1, vol = 1;
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(a.position[i] - a.size[i] / 2, b.c[i] - b.s[i] / 2), hi = Math.min(a.position[i] + a.size[i] / 2, b.c[i] + b.s[i] / 2);
    inter *= Math.max(0, hi - lo); vol *= a.size[i];
  }
  return vol > 0 ? inter / vol : 0;
};

const headWord = (label: string) => {
  const toks = tokenize(label).filter(w => !STOP.has(w));
  const cut = toks.findIndex(w => PREPOSITIONS.has(w));
  const head = (cut > 0 ? toks.slice(0, cut) : toks).at(-1) ?? 'part';
  return head.endsWith('s') && head.length > 3 ? head.slice(0, -1) : head;
};

/**
 * Vision lists a bottle and its cap as two objects. For interaction they are one object with a movable piece, so
 * a small object inside a larger, related one is folded into it as a named moving part: the cap you can twist off,
 * the button you can press. The folded object disappears from the list; the parent remembers its name.
 */
export function foldParts(objects: SceneObject[]): SceneObject[] {
  const byId = new Map(objects.map(o => [o.objectId, { ...o, model: o.model ? { ...o.model, parts: [...o.model.parts] } : undefined }]));
  const folded = new Set<string>();
  const children = [...objects].sort((a, b) => area(a.bbox) - area(b.bbox));
  for (const c of children) {
    const cx = (c.bbox[0] + c.bbox[2]) / 2, cy = (c.bbox[1] + c.bbox[3]) / 2;
    const parent = children.filter(p => p.objectId !== c.objectId && !folded.has(p.objectId) && byId.get(p.objectId)?.model
      && contains(p.bbox, cx, cy) && area(c.bbox) < 0.5 * area(p.bbox) && related(c, p))
      .sort((a, b) => area(a.bbox) - area(b.bbox))[0];
    if (!parent) continue;
    const P = byId.get(parent.objectId)!, model = P.model!;
    const { lo, hi } = wholeBounds(model);
    const pw = parent.bbox[2] - parent.bbox[0], ph = parent.bbox[3] - parent.bbox[1];
    const cw = c.bbox[2] - c.bbox[0], ch = c.bbox[3] - c.bbox[1];
    // Where the piece sits on the parent, in the parent model's own units.
    const center: V3 = [lo[0] + ((cx - parent.bbox[0]) / pw) * (hi[0] - lo[0]), hi[1] - ((cy - parent.bbox[1]) / ph) * (hi[1] - lo[1]), (lo[2] + hi[2]) / 2];
    const sx = Math.max(0.04, (cw / pw) * (hi[0] - lo[0])), sy = Math.max(0.04, (ch / ph) * (hi[1] - lo[1]));
    const name = headWord(c.label);
    const src = byId.get(c.objectId)!.model;
    let pieces: ModelPart[];
    if (src?.parts.length) {
      const cb = wholeBounds(src);
      const cc = [0, 1, 2].map(i => (cb.lo[i] + cb.hi[i]) / 2);
      const fx = sx / Math.max(1e-6, cb.hi[0] - cb.lo[0]), fy = sy / Math.max(1e-6, cb.hi[1] - cb.lo[1]), fz = fx;
      pieces = src.parts.map(p => ({
        ...p, moving: true, name,
        size: [p.size[0] * fx, p.size[1] * fy, p.size[2] * fz] as V3,
        position: [center[0] + (p.position[0] - cc[0]) * fx, center[1] + (p.position[1] - cc[1]) * fy, center[2] + (p.position[2] - cc[2]) * fz] as V3,
      }));
    } else pieces = [{ shape: 'cylinder', size: [sx, sy, sx], position: center, color: '#c8fff9', moving: true, name }];
    // Vision often draws the cap into the body as well as listing it separately. Where the cap goes, take out any fixed
    // piece of the body that is mostly inside the cap's area (it is the cap, drawn twice), or lifting the cap would leave
    // a second one sitting on the bottle. And if the body already has a movable piece there, do not add another.
    const capArea = { c: center, s: [sx * 1.25, sy * 1.25, sx * 1.25] as V3 };
    const dupMoving = model.parts.find(p => p.moving && insideFrac(p, capArea) >= 0.5);
    if (dupMoving) {
      model.parts = model.parts.map(p => (p.moving && insideFrac(p, capArea) >= 0.5 && !p.name ? { ...p, name } : p));
    } else {
      model.parts = [...model.parts.filter(p => p.moving || insideFrac(p, capArea) < 0.5), ...pieces];
    }
    P.partNames = [...new Set([...(P.partNames ?? []), name])];
    P.affordances = [...new Set([...P.affordances, ...c.affordances])];
    folded.add(c.objectId);
  }
  return objects.filter(o => !folded.has(o.objectId)).map(o => byId.get(o.objectId)!);
}
