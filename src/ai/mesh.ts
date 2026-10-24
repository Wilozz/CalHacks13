// SAM 3D meshes: the cache name, the box prompt, reading fal's GLB, shrinking it, and a compact format for the browser.
// Pure functions, shared by server/ai.ts (which makes and caches meshes) and the 3D box (which shows them).

export type Quat = [number, number, number, number]; // x, y, z, w
/** An indexed triangle mesh. colors: rgb per vertex, or null. */
export interface RawMesh { positions: Float32Array; colors: Uint8Array | null; indices: Uint32Array }

/** Cache name for an object: "Water Bottle" -> "water-bottle". */
export const meshKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'object';
export const MESH_KEY = /^[a-z0-9-]{1,40}$/;

/** SAM 3D box prompt, in pixels, around a normalized bbox: padded so the object's edges (a cap) are not cut off. */
export function boxPrompt(b: [number, number, number, number], width: number, height: number, pad = 0.04) {
  const px = (b[2] - b[0]) * pad, py = (b[3] - b[1]) * pad, c = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v * max)));
  return { x_min: c(b[0] - px, width), y_min: c(b[1] - py, height), x_max: c(b[2] + px, width), y_max: c(b[3] + py, height) };
}

/**
 * SAM 3D's mesh comes upright (glTF, y up) with a pose placing it in the photo's camera frame. The twin keeps it
 * upright and only turns it about the vertical, so the side the camera saw faces the viewer. Worked out on a real
 * result: in our view frame (x right, y up, z toward the viewer) the mesh's forward (+z) lands on the pose rotation's
 * z column, and its up on the x column.
 */
export function samYaw(q: Quat): number {
  const [x, y, z, w] = q, fx = 2 * (x * z + y * w), fz = 1 - 2 * (x * x + y * y);
  return Math.hypot(fx, fz) < 1e-6 ? 0 : Math.atan2(fx, fz);
}

/** Turned by `yaw` about the vertical, centred, longest side 1. */
export function orient(m: RawMesh, yaw: number): RawMesh {
  const p = m.positions, n = p.length / 3, c = Math.cos(yaw), s = Math.sin(yaw), out = new Float32Array(p.length);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
    out[3 * i] = x * c + z * s; out[3 * i + 1] = y; out[3 * i + 2] = -x * s + z * c;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], out[3 * i + k]); hi[k] = Math.max(hi[k], out[3 * i + k]); }
  }
  const f = 1 / (Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1), mid = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[3 * i + k] = (out[3 * i + k] - mid[k]) * f;
  return { positions: out, colors: m.colors, indices: m.indices };
}

// ---- GLB ----
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
type M4 = number[];
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul4 = (a: M4, b: M4): M4 => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const trs = (n: any): M4 => {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix.map(Number);
  const [tx, ty, tz] = n.translation ?? [0, 0, 0], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
};

/** Triangles of every mesh in a GLB (glTF binary), node transforms applied, vertex colours kept. Throws on anything else. */
export function readGlb(buf: Uint8Array): RawMesh {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB has no JSON chunk');
  const j = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  const binAt = 20 + jsonLen + 8;
  const read = (k: number): { n: number; size: number; get: (i: number, c: number) => number } => {
    const a = j.accessors[k], bv = j.bufferViews[a.bufferView], size = COMPONENTS[a.type];
    const bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType as number];
    if (!size || !bytes) throw new Error('unsupported accessor');
    const stride = bv.byteStride || size * bytes, base = binAt + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (base + stride * (a.count - 1) + size * bytes > buf.byteLength) throw new Error('accessor out of range');
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType as number] ?? 1 : 1;
    const at = (o: number) => a.componentType === 5126 ? dv.getFloat32(o, true) : a.componentType === 5125 ? dv.getUint32(o, true) : a.componentType === 5123 ? dv.getUint16(o, true)
      : a.componentType === 5122 ? dv.getInt16(o, true) : a.componentType === 5121 ? dv.getUint8(o) : dv.getInt8(o);
    return { n: a.count, size, get: (i, c) => at(base + i * stride + c * bytes) / norm };
  };
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  let anyColor = false;
  const visit = (ni: number, parent: M4) => {
    const node = j.nodes[ni], m = mul4(parent, trs(node));
    for (const prim of node.mesh !== undefined ? j.meshes[node.mesh].primitives : []) {
      if ((prim.mode ?? 4) !== 4 || prim.attributes?.POSITION === undefined) continue;
      const P = read(prim.attributes.POSITION), C = prim.attributes.COLOR_0 !== undefined ? read(prim.attributes.COLOR_0) : null, start = pos.length / 3;
      for (let i = 0; i < P.n; i++) {
        const x = P.get(i, 0), y = P.get(i, 1), z = P.get(i, 2);
        pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        if (C) { anyColor = true; col.push(...[0, 1, 2].map(c => Math.round(Math.min(1, Math.max(0, C.get(i, c))) * 255))); } else col.push(200, 200, 200);
      }
      if (prim.indices !== undefined) { const X = read(prim.indices); for (let i = 0; i < X.n; i++) idx.push(start + X.get(i, 0)); }
      else for (let i = 0; i < P.n; i++) idx.push(start + i);
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  for (const ni of j.scenes?.[j.scene ?? 0]?.nodes ?? j.nodes.map((_: unknown, i: number) => i)) visit(ni, I4);
  if (!idx.length) throw new Error('GLB has no triangles');
  return { positions: Float32Array.from(pos), colors: anyColor ? Uint8Array.from(col) : null, indices: Uint32Array.from(idx.slice(0, idx.length - (idx.length % 3))) };
}

/**
 * Vertex clustering: snaps vertices to a grid `cells` wide along the longest side and merges those sharing a cell.
 * A scan's half a million triangles become a few tens of thousands with the same shape and colours.
 */
export function simplify(m: RawMesh, cells = 120): RawMesh {
  const p = m.positions, n = p.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[3 * i + k]); hi[k] = Math.max(hi[k], p[3 * i + k]); }
  const size = (Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1) / cells, K = cells + 2;
  const cellOf = new Map<number, number>(), remap = new Uint32Array(n), sum: number[] = [], csum: number[] = [], count: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = Math.floor((p[3 * i] - lo[0]) / size) + K * (Math.floor((p[3 * i + 1] - lo[1]) / size) + K * Math.floor((p[3 * i + 2] - lo[2]) / size));
    let c = cellOf.get(key);
    if (c === undefined) { c = count.length; cellOf.set(key, c); sum.push(0, 0, 0); csum.push(0, 0, 0); count.push(0); }
    remap[i] = c; count[c]++;
    for (let k = 0; k < 3; k++) { sum[3 * c + k] += p[3 * i + k]; if (m.colors) csum[3 * c + k] += m.colors[3 * i + k]; }
  }
  const out: number[] = [], seen = new Set<string>();
  for (let t = 0; t + 2 < m.indices.length; t += 3) {
    const a = remap[m.indices[t]], b = remap[m.indices[t + 1]], c = remap[m.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    const k = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(k)) continue;
    seen.add(k); out.push(a, b, c);
  }
  const positions = new Float32Array(sum.length), colors = m.colors ? new Uint8Array(csum.length) : null;
  for (let c = 0; c < count.length; c++) for (let k = 0; k < 3; k++) { positions[3 * c + k] = sum[3 * c + k] / count[c]; if (colors) colors[3 * c + k] = Math.round(csum[3 * c + k] / count[c]); }
  return { positions, colors, indices: Uint32Array.from(out) };
}

// ---- compact format: "GHM1", vertex count, triangle count, positions (f32), colours (rgb u8, padded to 4), indices (u32) ----
export const MAX_MESH_VERTS = 400_000, MAX_MESH_TRIS = 800_000;
const MAGIC = 0x314d4847; // "GHM1"
const pad4 = (n: number) => (n + 3) & ~3;

export function encodeMesh(m: RawMesh): Uint8Array {
  const nv = m.positions.length / 3, nt = m.indices.length / 3, colorBytes = pad4(nv * 3);
  const out = new Uint8Array(12 + nv * 12 + colorBytes + nt * 12), dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, nv, true); dv.setUint32(8, nt, true);
  out.set(new Uint8Array(m.positions.buffer, m.positions.byteOffset, nv * 12), 12);
  out.set(m.colors ?? new Uint8Array(nv * 3).fill(200), 12 + nv * 12);
  out.set(new Uint8Array(m.indices.buffer, m.indices.byteOffset, nt * 12), 12 + nv * 12 + colorBytes);
  return out;
}

/** null if it is not a well-formed mesh within the limits. Never trusts the bytes. */
export function decodeMesh(buf: ArrayBuffer): RawMesh | null {
  if (buf.byteLength < 12) return null;
  const dv = new DataView(buf), nv = dv.getUint32(4, true), nt = dv.getUint32(8, true);
  if (dv.getUint32(0, true) !== MAGIC || nv < 3 || nt < 1 || nv > MAX_MESH_VERTS || nt > MAX_MESH_TRIS) return null;
  const colorBytes = pad4(nv * 3);
  if (buf.byteLength !== 12 + nv * 12 + colorBytes + nt * 12) return null;
  const positions = new Float32Array(buf.slice(12, 12 + nv * 12)), indices = new Uint32Array(buf.slice(12 + nv * 12 + colorBytes));
  if (!positions.every(Number.isFinite) || !indices.every(i => i < nv)) return null;
  return { positions, colors: new Uint8Array(buf.slice(12 + nv * 12, 12 + nv * 12 + nv * 3)), indices };
}
