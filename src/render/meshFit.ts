import type { RawMesh } from '../ai/mesh';
import type { ModelSpec } from '../ai/types';
import { componentsOf, wholeBounds } from '../remote/components';

/** One piece of a fitted mesh: positions relative to where the piece is drawn (the body: the whole's origin; a component: its centre). */
export interface MeshPiece { positions: Float32Array; colors: Uint8Array; indices: Uint32Array }
export interface FittedMesh { body: MeshPiece; pieces: (MeshPiece | null)[] }

const MIN_PIECE_TRIS = 12;
const PIECE_MARGIN = 0.03;

/**
 * Fits a SAM 3D mesh onto the twin's model and cuts it into the same pieces: the mesh is scaled and centred on the
 * model's box (so the hands, which are hit-tested against the model, land on what you see), and each triangle inside a component's
 * box (the cap) goes to that component, the rest to the body. A component the mesh has nothing for is null, and is
 * drawn with the model's own shapes instead.
 */
export function fitToModel(m: RawMesh, model: ModelSpec): FittedMesh {
  const p = m.positions, n = p.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[3 * i + k]); hi[k] = Math.max(hi[k], p[3 * i + k]); }
  // One scale for all three axes, so the scan keeps its real proportions: as tall as the model (both come from the
  // object's box in the picture, so the cap lands on the cap), unless that makes it much wider than the model.
  const t = wholeBounds(model), size = (k: number, a: { lo: ArrayLike<number>; hi: ArrayLike<number> }) => (a.hi[k] - a.lo[k]) || 1;
  const s = Math.min(size(1, t) / size(1, { lo, hi }), (1.3 * size(0, t)) / size(0, { lo, hi }));
  const tc = [0, 1, 2].map(k => (t.lo[k] + t.hi[k]) / 2), mc = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);
  const fit = new Float32Array(p.length);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) fit[3 * i + k] = tc[k] + (p[3 * i + k] - mc[k]) * s;

  const comps = componentsOf(model);
  const owner = (x: number, y: number, z: number) => comps.findIndex(c => [x, y, z].every((v, k) => v >= c.center[k] + c.lo[k] - PIECE_MARGIN && v <= c.center[k] + c.hi[k] + PIECE_MARGIN));
  const tris: number[][] = Array.from({ length: comps.length + 1 }, () => []); // last = body
  for (let i = 0; i + 2 < m.indices.length; i += 3) {
    const [a, b, c] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
    const o = owner((fit[3 * a] + fit[3 * b] + fit[3 * c]) / 3, (fit[3 * a + 1] + fit[3 * b + 1] + fit[3 * c + 1]) / 3, (fit[3 * a + 2] + fit[3 * b + 2] + fit[3 * c + 2]) / 3);
    tris[o < 0 ? comps.length : o].push(a, b, c);
  }
  const piece = (idx: number[], origin: number[]): MeshPiece => {
    const map = new Map<number, number>(), pos: number[] = [], col: number[] = [], out = new Uint32Array(idx.length);
    idx.forEach((v, j) => {
      let w = map.get(v);
      if (w === undefined) {
        w = map.size; map.set(v, w);
        pos.push(fit[3 * v] - origin[0], fit[3 * v + 1] - origin[1], fit[3 * v + 2] - origin[2]);
        col.push(...(m.colors ? [m.colors[3 * v], m.colors[3 * v + 1], m.colors[3 * v + 2]] : [200, 200, 200]));
      }
      out[j] = w;
    });
    return { positions: Float32Array.from(pos), colors: Uint8Array.from(col), indices: out };
  };
  return {
    body: piece(tris[comps.length], [0, 0, 0]),
    pieces: comps.map((c, i) => (tris[i].length / 3 >= MIN_PIECE_TRIS ? piece(tris[i], c.center) : null)),
  };
}
