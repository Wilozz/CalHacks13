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

/** Anything that takes the copy's rendered frames: the hand on it (if any) and the pose it was drawn in. */
export interface FrameSink { frame(now: number, hand: HandFrame | null, pose: TwinPose): void }
type Meta = Pick<Replay, 'twin' | 'mirror' | 'posFlip' | 'placement'>;

/** Records each rendered frame of the copy: a hand whenever a new one arrives, the pose at most ~30 times a second when it changed. */
export class Recorder implements FrameSink {
  private hands: Replay['hands'] = [];
  private poses: Replay['poses'] = [];
  private lastHand: HandFrame | null | undefined = undefined;
  private lastPose = '';
  private poseAt = -Infinity;
  private t = 0;
  constructor(private readonly start: number, private readonly meta: Meta) {}
  get full() { return this.t >= MAX_REPLAY_MS || this.hands.length >= MAX_EVENTS || this.poses.length >= MAX_EVENTS; }
  frame(now: number, hand: HandFrame | null, pose: TwinPose) {
    if (this.full) return;
    this.t = Math.max(0, Math.round(now - this.start));
    if (hand !== this.lastHand) { this.lastHand = hand; this.hands.push({ t: this.t, hand }); }
    if (now - this.poseAt < 33) return;
    const s = encodePose(pose);
    if (s !== this.lastPose) { this.lastPose = s; this.poseAt = now; this.poses.push({ t: this.t, pose: decodePose(s)! }); }
  }
  /** The recording up to `end`; anything recorded after it is cut. */
  finish(end: number): Replay {
    const durationMs = Math.min(MAX_REPLAY_MS, Math.max(0, Math.round(end - this.start)));
    return { ...this.meta, durationMs, hands: this.hands.filter(x => x.t <= durationMs), poses: this.poses.filter(x => x.t <= durationMs) };
  }
}

/** When a lesson counts: it starts with a hand on the copy and ends after IDLE_END_MS without one. */
export const LESSON = { idleEndMs: 6000, tailMs: 500, minMs: 2000, minHandMs: 4000 };

/**
 * Captures lessons by itself, no record button: a hand arriving on the copy starts one, and 6 s with no hand and nothing
 * held ends it, trimmed to just after the last activity. It is kept only if something was grabbed or a hand stayed for
 * 4 s, so a hand passing through the view is not a lesson. Plain rules on purpose: certain, instant, free, and offline.
 */
export class LessonCapture implements FrameSink {
  private rec: Recorder | null = null;
  private lastActive = 0; private lastFrame = 0; private handMs = 0; private grabbed = false;
  constructor(private readonly meta: () => Meta, private readonly onLesson: (r: Replay) => void) {}
  get active() { return this.rec !== null; }
  frame(now: number, hand: HandFrame | null, pose: TwinPose) {
    const busy = hand !== null || pose.grabbing;
    if (!this.rec) {
      if (!busy) return;
      this.rec = new Recorder(now, this.meta()); this.handMs = 0; this.grabbed = false; this.lastFrame = now;
    }
    if (hand) this.handMs += now - this.lastFrame;
    if (busy) this.lastActive = now;
    this.grabbed ||= pose.grabbing;
    this.lastFrame = now;
    this.rec.frame(now, hand, pose);
    if (this.rec.full || now - this.lastActive > LESSON.idleEndMs) this.end(now);
  }
  /** Close the current lesson now (the object changed, the box closed). */
  end(now: number) {
    const rec = this.rec; if (!rec) return;
    this.rec = null;
    const r = rec.finish(Math.min(now, this.lastActive + LESSON.tailMs));
    if (r.durationMs >= LESSON.minMs && (this.grabbed || this.handMs >= LESSON.minHandMs)) this.onLesson(r);
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
