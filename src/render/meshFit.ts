import type { RawMesh } from '../ai/mesh';
import type { ModelPart, ModelSpec } from '../ai/types';
import { componentsOf, wholeBounds, type Component } from '../remote/components';
import { THREADED } from '../remote/twinRig';

/** One piece of a fitted mesh: positions relative to where the piece is drawn (the body: the whole's origin; a component: its centre). */
export interface MeshPiece { positions: Float32Array; colors: Uint8Array; indices: Uint32Array }
/**
 * A scanned mesh ready for the box. `model` is the mesh's own shape as boxes (the body in horizontal slices, each piece
 * as one box): the hands are hit-tested against it, so they land on what you see, not on Claude's rougher shapes.
 */
export interface FittedMesh { model: ModelSpec; body: MeshPiece; pieces: (MeshPiece | null)[] }

const MIN_PIECE_TRIS = 12;
const PIECE_MARGIN = 0.03;
const BODY_SLICES = 8;
type P3 = [number, number, number];

/** Drops the specks a scan picks up around an object (bits of background): connected pieces under 2% of the triangles. */
export function dropSpecks(m: RawMesh, share = 0.02): Uint32Array {
  const n = m.positions.length / 3, up = new Int32Array(n).map((_, i) => i);
  const find = (a: number): number => { while (up[a] !== a) { up[a] = up[up[a]]; a = up[a]; } return a; };
  for (let t = 0; t + 2 < m.indices.length; t += 3) { const a = find(m.indices[t]); up[find(m.indices[t + 1])] = a; up[find(m.indices[t + 2])] = a; }
  const count = new Map<number, number>();
  for (let t = 0; t + 2 < m.indices.length; t += 3) { const r = find(m.indices[t]); count.set(r, (count.get(r) ?? 0) + 1); }
  const keep = Math.max(20, (share * m.indices.length) / 3), out: number[] = [];
  for (let t = 0; t + 2 < m.indices.length; t += 3) if ((count.get(find(m.indices[t])) ?? 0) >= keep) out.push(m.indices[t], m.indices[t + 1], m.indices[t + 2]);
  return out.length ? Uint32Array.from(out) : m.indices;
}

/**
 * Where a screwed-on piece at the top (a cap) meets the body: the height, near where Claude put the cap's lower edge,
 * at which the colour or the width of the scan changes the most. A black cap on a clear bottle is a colour change; a
 * cap wider than the neck is a width change. With neither, Claude's edge is kept.
 */
export function capCut(pos: Float32Array, col: Uint8Array | null, used: Uint8Array, prior: number, top: number): number {
  const step = 0.01, win = 0.05, from = prior - 0.14, to = Math.min(top - 0.02, prior + 0.1);
  const n = pos.length / 3;
  let ax = 0, az = 0, k = 0;
  for (let i = 0; i < n; i++) if (used[i] && pos[3 * i + 1] > from) { ax += pos[3 * i]; az += pos[3 * i + 2]; k++; }
  if (k < 20) return prior;
  ax /= k; az /= k;
  // Colour and width of the band just above and just below a height.
  const band = (lo: number, hi: number) => {
    let c = 0, r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < n; i++) {
      const y = pos[3 * i + 1];
      if (!used[i] || y < lo || y >= hi) continue;
      c++; w = Math.max(w, Math.hypot(pos[3 * i] - ax, pos[3 * i + 2] - az));
      if (col) { r += col[3 * i]; g += col[3 * i + 1]; b += col[3 * i + 2]; }
    }
    return c ? { c, w, rgb: [r / c, g / c, b / c] } : null;
  };
  const score = (y: number, w: number) => {
    const above = band(y, y + w), below = band(y - w, y);
    if (!above || !below || above.c < 8 || below.c < 8) return -Infinity;
    const colour = col ? Math.hypot(above.rgb[0] - below.rgb[0], above.rgb[1] - below.rgb[1], above.rgb[2] - below.rgb[2]) / 120 : 0;
    const width = Math.abs(above.w - below.w) / Math.max(above.w, below.w, 1e-6);
    return colour + 0.8 * width - 3 * Math.abs(y - prior);
  };
  let best = prior, bestScore = 0.25; // a change must be clear to beat Claude's guess
  for (let y = from; y <= to; y += step) { const sc = score(y, win); if (sc > bestScore) { bestScore = sc; best = y; } }
  if (best === prior) return prior;
  // Then finer, with narrow bands, so the cut lands on the edge itself: a cut a step too low leaves a ring of the
  // bottle on the cap, a step too high a ring of the cap on the bottle.
  let fine = best, fineScore = -Infinity;
  for (let y = best - step; y <= best + step; y += step / 5) { const sc = score(y, step * 2); if (sc > fineScore) { fineScore = sc; fine = y; } }
  return fineScore > -Infinity ? fine : best;
}

/**
 * Fits a SAM 3D mesh onto the twin and cuts it into the same pieces as Claude's model: one scale for all three axes
 * (the scan keeps its real proportions), as tall as the model and centred on it. A cap at the top is cut where the scan
 * itself changes (capCut); other pieces take the triangles inside their box. Then the mesh's own shape becomes the
 * model the hands use.
 */
export function fitToModel(m: RawMesh, model: ModelSpec): FittedMesh {
  const p = m.positions, n = p.length / 3, indices = dropSpecks(m);
  const used = new Uint8Array(n);
  indices.forEach(i => { used[i] = 1; });
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) if (used[i]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[3 * i + k]); hi[k] = Math.max(hi[k], p[3 * i + k]); }
  const t = wholeBounds(model), size = (k: number, a: { lo: ArrayLike<number>; hi: ArrayLike<number> }) => (a.hi[k] - a.lo[k]) || 1;
  const s = Math.min(size(1, t) / size(1, { lo, hi }), (1.3 * size(0, t)) / size(0, { lo, hi }));
  const tc = [0, 1, 2].map(k => (t.lo[k] + t.hi[k]) / 2), mc = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);
  const fit = new Float32Array(p.length);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) fit[3 * i + k] = tc[k] + (p[3 * i + k] - mc[k]) * s;
  const top = tc[1] + (hi[1] - mc[1]) * s;

  // Which triangles belong to which of Claude's pieces.
  const comps = componentsOf(model);
  const cuts = comps.map(c => THREADED.test(c.name) && c.center[1] + c.hi[1] >= top - 0.12 ? capCut(fit, m.colors, used, c.center[1] + c.lo[1], top) : null);
  const inBox = (c: Component, x: number, y: number, z: number) => [x, y, z].every((v, k) => v >= c.center[k] + c.lo[k] - PIECE_MARGIN && v <= c.center[k] + c.hi[k] + PIECE_MARGIN);
  const tris: number[][] = Array.from({ length: comps.length + 1 }, () => []); // last = body
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    const x = (fit[3 * a] + fit[3 * b] + fit[3 * c]) / 3, y = (fit[3 * a + 1] + fit[3 * b + 1] + fit[3 * c + 1]) / 3, z = (fit[3 * a + 2] + fit[3 * b + 2] + fit[3 * c + 2]) / 3;
    const o = comps.findIndex((cp, ci) => (cuts[ci] !== null ? y > cuts[ci]! : inBox(cp, x, y, z)));
    tris[o < 0 ? comps.length : o].push(a, b, c);
  }

  // The mesh's own shape, as boxes: the body in horizontal slices (so a narrow neck is narrow), each piece as one box.
  const boundsOf = (idx: number[]) => {
    const l: P3 = [Infinity, Infinity, Infinity], h: P3 = [-Infinity, -Infinity, -Infinity];
    idx.forEach(v => { for (let k = 0; k < 3; k++) { l[k] = Math.min(l[k], fit[3 * v + k]); h[k] = Math.max(h[k], fit[3 * v + k]); } });
    return { l, h };
  };
  const box = (l: P3, h: P3, moving: boolean, name?: string): ModelPart => ({ shape: 'box', moving, ...(name ? { name } : {}), color: moving ? '#c8fff9' : '#8a96a3',
    size: [0, 1, 2].map(k => Math.max(0.02, h[k] - l[k])) as P3, position: [0, 1, 2].map(k => (l[k] + h[k]) / 2) as P3 });
  const body = tris[comps.length], parts: ModelPart[] = [];
  const { l: bl, h: bh } = boundsOf(body), sliceH = (bh[1] - bl[1]) / BODY_SLICES;
  for (let k = 0; k < BODY_SLICES; k++) {
    const y0 = bl[1] + k * sliceH, y1 = y0 + sliceH, idx: number[] = [];
    for (let i = 0; i + 2 < body.length; i += 3) {
      const y = (fit[3 * body[i] + 1] + fit[3 * body[i + 1] + 1] + fit[3 * body[i + 2] + 1]) / 3;
      if (y >= y0 && (y < y1 || k === BODY_SLICES - 1)) idx.push(body[i], body[i + 1], body[i + 2]);
    }
    if (idx.length) { const { l, h } = boundsOf(idx); parts.push(box([l[0], Math.max(l[1], y0), l[2]], [h[0], Math.min(h[1], y1), h[2]], false)); }
  }
  // A piece the scan has (almost) nothing for keeps Claude's shapes.
  const source: number[] = [];
  comps.forEach((c, ci) => {
    // A cut piece's box covers only what is above the cut (triangles across the edge reach a little below it).
    if (tris[ci].length / 3 >= MIN_PIECE_TRIS) { const { l, h } = boundsOf(cuts[ci] === null ? tris[ci] : tris[ci].filter(v => fit[3 * v + 1] >= cuts[ci]! - 0.005)); parts.push(box(l, h, true, c.name)); source.push(ci); }
    else c.parts.forEach(i => { parts.push({ ...model.parts[i], moving: true, name: c.name }); source.push(-1); });
  });
  const fitted: ModelSpec = { parts: parts.length ? parts : model.parts, pivot: model.pivot };
  const firstMoving = parts.findIndex(x => x.moving);

  const piece = (idx: number[], origin: number[]): MeshPiece => {
    const map = new Map<number, number>(), pos: number[] = [], colr: number[] = [], out = new Uint32Array(idx.length);
    idx.forEach((v, j) => {
      let w = map.get(v);
      if (w === undefined) {
        w = map.size; map.set(v, w);
        pos.push(fit[3 * v] - origin[0], fit[3 * v + 1] - origin[1], fit[3 * v + 2] - origin[2]);
        colr.push(...(m.colors ? [m.colors[3 * v], m.colors[3 * v + 1], m.colors[3 * v + 2]] : [200, 200, 200]));
      }
      out[j] = w;
    });
    return { positions: Float32Array.from(pos), colors: Uint8Array.from(colr), indices: out };
  };
  // The new model's components, in its own order: each is drawn from the scan triangles of the piece it came from.
  const pieces = componentsOf(fitted).map(dc => {
    const src = source[dc.parts[0] - firstMoving];
    return src !== undefined && src >= 0 ? piece(tris[src], dc.center) : null;
  });
  return { model: fitted, body: piece(body, [0, 0, 0]), pieces };
}
