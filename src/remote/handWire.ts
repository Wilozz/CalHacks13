import type { HandFrame, Point } from '../coordinates';

// Compact binary hand message for an unordered, unreliable WebRTC data channel (~262 bytes at 30 Hz).
//   u8 version | u8 flags | u16 seq | u32 senderMs | 21 x image (u16 x, u16 y, i16 z) | 21 x world (i16 x, y, z)
// flags: bit0 hand present, bit1 world landmarks present, bit2 right hand
export const WIRE_VERSION = 1;
const HEADER = 8;
const IMAGE_BYTES = 21 * 6;
const WORLD_BYTES = 21 * 6;
const IMG_LO = -0.5, IMG_SPAN = 2; // image x/y encoded over [-0.5, 1.5]: hands can slightly leave the frame
const Z_SPAN = 1;                  // image z is wrist-relative, roughly [-1, 1]
const WORLD_SPAN = 0.5;            // world metres, +/-0.5 m

export interface HandMessage { seq: number; senderMs: number; hand: HandFrame | null }

const q16 = (v: number, lo: number, span: number) => Math.round(Math.min(1, Math.max(0, (v - lo) / span)) * 65535);
const d16 = (n: number, lo: number, span: number) => lo + (n / 65535) * span;
const qs = (v: number, span: number) => Math.round(Math.min(1, Math.max(-1, v / span)) * 32767);
const ds = (n: number, span: number) => (n / 32767) * span;

export function encodeHand(seq: number, senderMs: number, hand: HandFrame | null): ArrayBuffer {
  const present = !!hand && hand.landmarks.length === 21;
  const world = present && hand!.worldLandmarks.length === 21;
  const size = HEADER + (present ? IMAGE_BYTES + (world ? WORLD_BYTES : 0) : 0);
  const buf = new ArrayBuffer(size), v = new DataView(buf);
  v.setUint8(0, WIRE_VERSION);
  v.setUint8(1, (present ? 1 : 0) | (world ? 2 : 0) | (present && hand!.handedness === 'Right' ? 4 : 0));
  v.setUint16(2, seq & 0xffff, true);
  v.setUint32(4, Math.floor(senderMs) >>> 0, true);
  if (!present) return buf;
  let o = HEADER;
  for (const p of hand!.landmarks) {
    v.setUint16(o, q16(p.x, IMG_LO, IMG_SPAN), true); v.setUint16(o + 2, q16(p.y, IMG_LO, IMG_SPAN), true); v.setInt16(o + 4, qs(p.z, Z_SPAN), true); o += 6;
  }
  if (world) for (const p of hand!.worldLandmarks) {
    v.setInt16(o, qs(p.x, WORLD_SPAN), true); v.setInt16(o + 2, qs(p.y, WORLD_SPAN), true); v.setInt16(o + 4, qs(p.z, WORLD_SPAN), true); o += 6;
  }
  return buf;
}

/** Returns null for anything malformed. Never trust the peer: sizes and version are checked before reading. */
export function decodeHand(buf: ArrayBuffer, receivedAt: number): HandMessage | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEADER || buf.byteLength > 1024) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== WIRE_VERSION) return null;
  const flags = v.getUint8(1), present = !!(flags & 1), world = !!(flags & 2);
  const msg = { seq: v.getUint16(2, true), senderMs: v.getUint32(4, true) };
  if (!present) return buf.byteLength === HEADER ? { ...msg, hand: null } : null;
  if (buf.byteLength !== HEADER + IMAGE_BYTES + (world ? WORLD_BYTES : 0)) return null;
  let o = HEADER;
  const landmarks: Point[] = [], worldLandmarks: Point[] = [];
  for (let i = 0; i < 21; i++, o += 6) landmarks.push({ x: d16(v.getUint16(o, true), IMG_LO, IMG_SPAN), y: d16(v.getUint16(o + 2, true), IMG_LO, IMG_SPAN), z: ds(v.getInt16(o + 4, true), Z_SPAN) });
  if (world) for (let i = 0; i < 21; i++, o += 6) worldLandmarks.push({ x: ds(v.getInt16(o, true), WORLD_SPAN), y: ds(v.getInt16(o + 2, true), WORLD_SPAN), z: ds(v.getInt16(o + 4, true), WORLD_SPAN) });
  return { ...msg, hand: { timestamp: receivedAt, landmarks, worldLandmarks, handedness: flags & 4 ? 'Right' : 'Left', inferenceMs: 0 } };
}
