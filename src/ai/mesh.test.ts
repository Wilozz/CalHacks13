import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_MODELS, sanitizeModel } from './modelSpec';
import { boxPrompt, decodeMesh, encodeMesh, meshKey, MESH_KEY, orient, readGlb, samYaw, simplify, type RawMesh } from './mesh';
import { capCut, dropSpecks, fitLanyard, fitToModel } from '../render/meshFit';
import { componentsOf as comps2 } from '../remote/components';
import { componentsOf } from '../remote/components';

const near = (a: number, b: number, e = 1e-5) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

/** A GLB with one triangle mesh (float positions, normalized u8 colours, u32 indices) under a node with a translation. */
function glb(positions: number[], colors: number[], indices: number[], node: Record<string, unknown> = {}): Uint8Array {
  const pos = new Float32Array(positions), col = new Uint8Array(colors), idx = new Uint32Array(indices);
  const colPad = (col.byteLength + 3) & ~3, bin = new Uint8Array(pos.byteLength + colPad + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0); bin.set(col, pos.byteLength); bin.set(new Uint8Array(idx.buffer), pos.byteLength + colPad);
  const n = positions.length / 3;
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, ...node }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2, mode: 4 }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: col.byteLength }, { buffer: 0, byteOffset: pos.byteLength + colPad, byteLength: idx.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: n, type: 'VEC3' }, { bufferView: 1, componentType: 5121, normalized: true, count: n, type: 'VEC4' }, { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' }],
  });
  const jb = new TextEncoder().encode(json.padEnd((json.length + 3) & ~3, ' '));
  const out = new Uint8Array(12 + 8 + jb.length + 8 + bin.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20);
  dv.setUint32(20 + jb.length, bin.length, true); dv.setUint32(24 + jb.length, 0x004e4942, true); out.set(bin, 28 + jb.length);
  return out;
}

test('mesh cache names are tidy and safe to use as file names', () => {
  assert.equal(meshKey('Water Bottle'), 'water-bottle'); assert.equal(meshKey('  ../../etc/passwd '), 'etc-passwd'); assert.equal(meshKey('!!!'), 'object');
  assert.ok(MESH_KEY.test(meshKey('A very long label that goes on and on and on and on')));
});

test('the SAM 3D box prompt is in pixels, padded a little, and clamped to the picture', () => {
  assert.deepEqual(boxPrompt([0.4, 0.2, 0.6, 0.8], 1000, 500), { x_min: 392, y_min: 88, x_max: 608, y_max: 412 });
  assert.deepEqual(boxPrompt([0, 0, 1, 1], 640, 480), { x_min: 0, y_min: 0, x_max: 640, y_max: 480 });
});

test('a GLB is read with its node transform and vertex colours', () => {
  const m = readGlb(glb([0, 0, 0, 1, 0, 0, 0, 1, 0], [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], [0, 1, 2], { translation: [1, 2, 3] }));
  assert.deepEqual([...m.positions], [1, 2, 3, 2, 2, 3, 1, 3, 3]);
  assert.deepEqual([...m.colors!], [255, 0, 0, 0, 255, 0, 0, 0, 255]);
  assert.deepEqual([...m.indices], [0, 1, 2]);
  assert.throws(() => readGlb(new Uint8Array(40)), /not a GLB/);
});

test('SAM 3D orientation: the real result we checked by eye faced the viewer about 30 degrees to the right', () => {
  near(samYaw([0.183318093419075, 0.18910284340381622, 0.7106502056121826, 0.6523855328559875]) * 180 / Math.PI, 30.5, 0.5);
  near(samYaw([0, 0, 0, 1]), 0);
  // turned, centred, longest side 1: the mesh's forward (+z) ends up pointing the yaw's way
  const m = orient({ positions: Float32Array.from([0, 0, 4, 0, 0, 6, 0, 1, 5]), colors: null, indices: Uint32Array.from([0, 1, 2]) }, Math.PI / 2);
  near(m.positions[3] - m.positions[0], 1); near(m.positions[5] - m.positions[2], 0); near(m.positions[1] + m.positions[4] + m.positions[7], -0.25); // y 0, 0, 1 -> centred and halved (longest side was 2)
});

test('simplify merges nearby vertices, drops collapsed triangles, and averages colours', () => {
  // two triangles, the second a sliver whose corners all land in the same few cells
  const m: RawMesh = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.001, 0.001, 0, 0.002, 0, 0]), colors: Uint8Array.from([0, 0, 0, 255, 255, 255, 0, 0, 0, 100, 100, 100, 50, 50, 50]), indices: Uint32Array.from([0, 1, 2, 0, 3, 4]) };
  const s = simplify(m, 10);
  assert.equal(s.indices.length, 3); assert.equal(s.positions.length / 3, 3);
  assert.equal(s.colors![0], 50); // vertices 0, 3 and 4 merged: (0 + 100 + 50) / 3
});

test('the compact mesh format round-trips and rejects anything malformed', () => {
  const m: RawMesh = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), colors: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), indices: Uint32Array.from([0, 1, 2, 1, 3, 2]) };
  const enc = encodeMesh(m), back = decodeMesh(enc.slice().buffer)!;
  assert.deepEqual([...back.positions], [...m.positions]); assert.deepEqual([...back.colors!], [...m.colors!]); assert.deepEqual([...back.indices], [...m.indices]);
  assert.equal(decodeMesh(enc.slice(0, enc.length - 4).buffer), null, 'truncated');
  const bad = enc.slice(); new DataView(bad.buffer).setUint32(bad.length - 4, 99, true);
  assert.equal(decodeMesh(bad.buffer), null, 'an index past the last vertex');
  const nan = enc.slice(); new DataView(nan.buffer).setFloat32(12, NaN, true);
  assert.equal(decodeMesh(nan.buffer), null, 'not a number');
});

test('a mesh is fitted to the model and cut into the same pieces: the cap part of the scan becomes the twistable cap', () => {
  const bottle = sanitizeModel(BUILTIN_MODELS.bottle)!, cap = componentsOf(bottle)[0];
  // a column of small triangles from the bottom of the scan to the top, in the scan's own (different) units
  const pos: number[] = [], idx: number[] = [];
  for (let k = 0; k <= 200; k++) { const y = 10 + k * 0.1; pos.push(-1, y, 0, 1, y, 0, 0, y + 0.2, 0.5); idx.push(3 * k, 3 * k + 1, 3 * k + 2); }
  const fit = fitToModel({ positions: Float32Array.from(pos), colors: null, indices: Uint32Array.from(idx) }, bottle);
  const piece = fit.pieces[0]!;
  assert.ok(piece, 'the top of the scan is the cap');
  const ys = Array.from({ length: piece.positions.length / 3 }, (_, i) => piece.positions[3 * i + 1] + cap.center[1]);
  assert.ok(ys.every(y => y >= cap.center[1] + cap.lo[1] - 0.05), 'only the top of the scan');
  assert.ok(fit.body.indices.length / 3 > 150, 'the rest is the body');
  const by = Array.from({ length: fit.body.positions.length / 3 }, (_, i) => fit.body.positions[3 * i + 1]);
  near(Math.min(...by), -0.5, 0.03); // stretched onto the model's box
});

test('the scan\'s own shape becomes the model the hands use: the body in slices, the cap as one box where the cap is', () => {
  const bottle = sanitizeModel(BUILTIN_MODELS.bottle)!;
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  for (let k = 0; k <= 200; k++) { const y = 10 + k * 0.1, w = y > 28 ? 0.5 : 1; pos.push(-w, y, 0, w, y, 0, 0, y + 0.2, 0.5); idx.push(3 * k, 3 * k + 1, 3 * k + 2); col.push(...(y > 28 ? [20, 20, 20, 20, 20, 20, 20, 20, 20] : [230, 230, 230, 230, 230, 230, 230, 230, 230])); }
  const fit = fitToModel({ positions: Float32Array.from(pos), colors: Uint8Array.from(col), indices: Uint32Array.from(idx) }, bottle);
  const cap = fit.model.parts.filter(p => p.moving), body = fit.model.parts.filter(p => !p.moving);
  assert.equal(cap.length, 1); assert.equal(cap[0].name, 'cap');
  assert.ok(body.length >= 4, 'the body in slices');
  const capBottom = cap[0].position[1] - cap[0].size[1] / 2, top = Math.max(...fit.model.parts.map(p => p.position[1] + p.size[1] / 2));
  // the dark, narrow top of the scan starts 28/30.2 of the way up
  near(top - capBottom, (30.2 - 28) / 20.2, 0.03);
  assert.ok(cap[0].size[0] < body[0].size[0], 'the cap box is as narrow as the cap, not as wide as the body');
  assert.equal(componentsOf(fit.model)[0].name, 'cap');
});

test('the cap is cut where the scan changes colour or width, near Claude\'s guess; with no change, at the guess', () => {
  const pos: number[] = [], col: number[] = [];
  for (let k = 0; k <= 100; k++) { const y = -0.5 + k * 0.01; for (const a of [0, 1, 2, 3]) { pos.push(0.2 * Math.cos(a * 1.57), y, 0.2 * Math.sin(a * 1.57)); col.push(...(y > 0.38 ? [10, 10, 10] : [240, 240, 240])); } }
  const P = Float32Array.from(pos), used = new Uint8Array(P.length / 3).fill(1);
  near(capCut(P, Uint8Array.from(col), used, 0.44, 0.5), 0.38, 0.015);       // Claude guessed 6% too high: the colour edge wins
  near(capCut(P, Uint8Array.from(col), used, 0.32, 0.5), 0.38, 0.015);       // or too low
  near(capCut(P, null, used, 0.41, 0.5), 0.41, 1e-9);                         // no colour, no width change: Claude's guess stands
});

test('specks around a scan are dropped', () => {
  const m: RawMesh = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 5, 5, 5, 5.1, 5, 5, 5, 5.1, 5]), colors: null, indices: Uint32Array.from([...Array.from({ length: 30 }, () => [0, 1, 2, 1, 3, 2]).flat(), 4, 5, 6]) };
  const kept = dropSpecks(m);
  assert.equal(kept.length, 60 * 3, 'the lone far triangle is gone');
});

test('a lanyard scanned clipped together is cut into the card (the wide part) and the clasp with its strap (the narrow part above)', () => {
  const lanyard = sanitizeModel(BUILTIN_MODELS.lanyard)!;
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  const quad = (x0: number, x1: number, y0: number, y1: number, z: number, c: number[]) => {
    const b = pos.length / 3; pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); for (let i = 0; i < 4; i++) col.push(...c);
  };
  // a card 4 wide and 6 tall, then a strap 0.5 wide going up 4 more: in scan units, centred anywhere
  for (let y = 0; y < 6; y += 0.1) for (let x = 0; x < 4; x += 0.5) quad(10 + x, 10.5 + x, 20 + y, 20.1 + y, 5, [240, 240, 240]);
  for (let y = 6; y < 10; y += 0.1) quad(11.75, 12.25, 20 + y, 20.1 + y, 5, [40, 80, 200]);
  const fit = fitLanyard({ positions: Float32Array.from(pos), colors: Uint8Array.from(col), indices: Uint32Array.from(idx) }, lanyard);
  assert.ok(fit.kit, 'it has the clip points');
  const card = fit.model.parts.find(p => !p.moving)!, clasp = comps2(fit.model)[0];
  assert.equal(clasp.name, 'clasp');
  // the card is the bottom 6/10 of the height, the clasp the narrow rest
  const cardTop = card.position[1] + card.size[1] / 2, h = 1.0;
  near(cardTop - (-0.5), 0.6 * h, 0.04);
  assert.ok(clasp.hi[0] - clasp.lo[0] < card.size[0] / 3, 'the clasp is narrow');
  assert.ok(fit.kit!.hole[1] < cardTop && fit.kit!.hole[1] > cardTop - 0.15, 'the hole is just under the top of the card');
  assert.ok(fit.kit!.hook[1] < fit.kit!.attach[1], 'the claw hangs below the clasp');
  assert.ok(fit.pieces[0] && fit.body.indices.length > 0);
});

test('a card scanned lying flat (as SAM 3D returns one) is stood up, clip on top, and fitted without falling over its own rounding', () => {
  const lanyard = sanitizeModel(BUILTIN_MODELS.lanyard)!;
  const pos: number[] = [], idx: number[] = [];
  const quad = (x0: number, x1: number, z0: number, z1: number) => { const b = pos.length / 3; pos.push(x0, 0.013, z0, x1, 0.013, z0, x1, -0.0131, z1, x0, 0.0131, z1); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  // flat in x-z: a card 0.63 wide and 0.9 long, and a narrow clip at its +z end; odd decimals, as in a real scan
  for (let z = -0.4537; z < 0.4463; z += 0.0213) for (let x = -0.3141; x < 0.3159; x += 0.0517) quad(x, x + 0.0517, z, z + 0.0213);
  for (let z = 0.4463; z < 0.5; z += 0.0041) quad(-0.06, 0.06, z, z + 0.0041);
  const fit = fitLanyard({ positions: Float32Array.from(pos), colors: null, indices: Uint32Array.from(idx) }, lanyard);
  const card = fit.model.parts.find(p => !p.moving)!, clasp = comps2(fit.model)[0];
  assert.ok(card.size[1] > 0.8 && card.size[2] < 0.08, `the card stands, facing the viewer (h ${card.size[1].toFixed(2)}, d ${card.size[2].toFixed(2)})`);
  assert.ok(clasp.center[1] > card.position[1] + card.size[1] / 2 - 0.02, 'the clip is on top');
  assert.ok(fit.kit!.hole[1] > card.position[1] + card.size[1] / 2 - 0.1, 'the hole is just under the top edge');
});
