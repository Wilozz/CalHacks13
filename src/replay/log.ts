import type { HandFrame } from '../coordinates';
import { decodeHand, encodeHand } from '../remote/handWire';
import type { Placement } from '../remote/placement';
import { decodePose, decodeTwin, encodePose, encodeTwin, type TwinInfo, type TwinPose } from '../remote/twinWire';

/**
 * A tutorial: what the 3D copy showed, never video. The hand frames and object poses that drove the copy, with times
 * in ms from the start, so the same scene can be played back from them. Stored as JSON; hands in the call's wire format.
 */
export interface Replay {
  twin: TwinInfo; mirror: boolean; posFlip: boolean; placement: Placement; durationMs: number;
  hands: { t: number; hand: HandFrame | null }[];
  poses: { t: number; pose: TwinPose }[];
}

export const MAX_REPLAY_MS = 5 * 60_000;
// 5 min of hands at 30 Hz is ~3.2 MB of base64; poses add ~1.5 MB at most.
export const MAX_REPLAY_BYTES = 6_000_000;
const MAX_EVENTS = 20_000;

/** Records each rendered frame of the copy: a hand whenever a new one arrives, the pose at most ~30 times a second when it changed. */
export class Recorder {
  private hands: Replay['hands'] = [];
  private poses: Replay['poses'] = [];
  private lastHand: HandFrame | null | undefined = undefined;
  private lastPose = '';
  private poseAt = -Infinity;
  private t = 0;
  constructor(private readonly start: number, private readonly meta: Pick<Replay, 'twin' | 'mirror' | 'posFlip' | 'placement'>) {}
  get full() { return this.t >= MAX_REPLAY_MS || this.hands.length >= MAX_EVENTS || this.poses.length >= MAX_EVENTS; }
  frame(now: number, hand: HandFrame | null, pose: TwinPose) {
    if (this.full) return;
    this.t = Math.max(0, Math.round(now - this.start));
    if (hand !== this.lastHand) { this.lastHand = hand; this.hands.push({ t: this.t, hand }); }
    if (now - this.poseAt < 33) return;
    const s = encodePose(pose);
    if (s !== this.lastPose) { this.lastPose = s; this.poseAt = now; this.poses.push({ t: this.t, pose: decodePose(s)! }); }
  }
  finish(now: number): Replay {
    return { ...this.meta, durationMs: Math.min(MAX_REPLAY_MS, Math.max(this.t, Math.round(now - this.start))), hands: this.hands, poses: this.poses };
  }
}

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;

export const encodeReplay = (r: Replay): string => JSON.stringify({
  v: 1, twin: JSON.parse(encodeTwin(r.twin)), mirror: r.mirror, posFlip: r.posFlip, placement: r.placement, durationMs: r.durationMs,
  h: r.hands.map((x, i) => [x.t, b64(encodeHand(i & 0xffff, x.t, x.hand))]),
  p: r.poses.map(x => [x.t, encodePose(x.pose)]),
});

const clamp = (n: unknown, lo: number, hi: number, d: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
function placementOf(p: any): Placement {
  const pin = p?.pin && typeof p.pin === 'object' ? { x: clamp(p.pin.x, 0, 1, 0.5), y: clamp(p.pin.y, 0, 1, 0.5) } : null;
  return { mode: p?.mode === 'pinned' ? 'pinned' : 'follow', size: clamp(p?.size, 0.05, 2, 0.38), reach: clamp(p?.reach, 0.1, 2, 1), flipX: p?.flipX !== false,
    pin, gain: clamp(p?.gain, 0.1, 5, 1), depth: clamp(p?.depth, 0, 3, 1) };
}

/** null = not a valid replay. Every field is checked and clamped with the same decoders the call uses; never trusts the file. */
export function decodeReplay(text: string): Replay | null {
  if (typeof text !== 'string' || text.length > MAX_REPLAY_BYTES) return null;
  let m: any;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || m.v !== 1 || !Array.isArray(m.h) || !Array.isArray(m.p) || m.h.length > MAX_EVENTS || m.p.length > MAX_EVENTS) return null;
  const twin = decodeTwin(JSON.stringify({ ...m.twin, type: 'twin' }));
  const durationMs = Number(m.durationMs);
  if (!twin || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_REPLAY_MS) return null;
  const time = (t: unknown) => typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= durationMs;
  const hands: Replay['hands'] = [], poses: Replay['poses'] = [];
  for (const e of m.h) {
    if (!Array.isArray(e) || !time(e[0]) || typeof e[1] !== 'string' || e[1].length > 2000) return null;
    let msg; try { msg = decodeHand(unb64(e[1]), 0); } catch { return null; }
    if (!msg) return null;
    hands.push({ t: e[0], hand: msg.hand });
  }
  for (const e of m.p) {
    const pose = Array.isArray(e) && time(e[0]) ? decodePose(e[1]) : null;
    if (!pose) return null;
    poses.push({ t: e[0], pose });
  }
  hands.sort((a, b) => a.t - b.t); poses.sort((a, b) => a.t - b.t);
  return { twin, mirror: m.mirror === true, posFlip: m.posFlip === true, placement: placementOf(m.placement), durationMs, hands, poses };
}

/** Index of the last event at or before t, or -1. Events are sorted by t. */
export function indexAt(events: { t: number }[], t: number): number {
  let lo = 0, hi = events.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (events[mid].t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}
