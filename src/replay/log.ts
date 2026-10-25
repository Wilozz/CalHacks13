import type { HandFrame } from '../coordinates';
import { sanitizeModel } from '../ai/modelSpec';
import type { ModelSpec } from '../ai/types';
import { decodeHand, encodeHand } from '../remote/handWire';
import { decodePose, decodeTwin, encodePose, encodeTwin, type TwinInfo, type TwinPose } from '../remote/twinWire';

/** Where the object was on the recorder's raw camera image: u, v (origin top-left), h its height as a fraction of the image height, q its rotation (three.js camera axes). */
export interface ObjPose { u: number; v: number; h: number; q: [number, number, number, number] }

/**
 * A lesson: from the moment an object was thrown to you until you threw it back. Your tracked hands (all 21 points each)
 * and where the object was, both on your raw camera image, so they line up; times in ms from the start. Never video.
 */
export interface Replay {
  label: string; model: ModelSpec; aspect: number; durationMs: number;
  hands: { t: number; hands: HandFrame[] }[];
  poses: { t: number; pose: ObjPose | null }[];
  /** A lesson from the call: the 3D copy that was handed over (the lanyard) and its pose as the catcher moved it, clip state included. */
  twin?: TwinInfo;
  twinPoses: { t: number; pose: TwinPose }[];
}

export const MAX_REPLAY_MS = 5 * 60_000;
// 5 min of two hands at 30 Hz is ~6 MB of base64 at worst; one hand, the usual case, is half that.
export const MAX_REPLAY_BYTES = 8_000_000;
const MAX_EVENTS = 20_000, MAX_HANDS = 2;

/** Records a lesson. hands: undefined means unchanged since the last call; [] means none in view. */
export class Recorder {
  private hands: Replay['hands'] = [];
  private poses: Replay['poses'] = [];
  private lastHandsEmpty = false;
  private twinPoses: Replay['twinPoses'] = [];
  private lastPose = '';
  private lastTwin = '';
  private t = 0;
  constructor(private readonly start: number, private readonly meta: Pick<Replay, 'label' | 'model' | 'aspect' | 'twin'>) {}
  get full() { return this.t >= MAX_REPLAY_MS || this.hands.length >= MAX_EVENTS || this.poses.length >= MAX_EVENTS || this.twinPoses.length >= MAX_EVENTS; }
  frame(now: number, hands: HandFrame[] | undefined, pose: ObjPose | null, twinPose?: TwinPose | null) {
    if (this.full) return;
    this.t = Math.max(0, Math.round(now - this.start));
    if (hands && !(hands.length === 0 && this.lastHandsEmpty)) { this.hands.push({ t: this.t, hands: hands.slice(0, MAX_HANDS) }); this.lastHandsEmpty = hands.length === 0; }
    const key = JSON.stringify(pose && poseWire(pose));
    if (key !== this.lastPose) { this.lastPose = key; this.poses.push({ t: this.t, pose: pose && poseOf(poseWire(pose)) }); }
    const tw = twinPose ? encodePose(twinPose) : '';
    if (tw && tw !== this.lastTwin) { this.lastTwin = tw; this.twinPoses.push({ t: this.t, pose: decodePose(tw)! }); }
  }
  finish(end: number): Replay {
    const durationMs = Math.min(MAX_REPLAY_MS, Math.max(0, Math.round(end - this.start)));
    return { ...this.meta, durationMs, hands: this.hands.filter(x => x.t <= durationMs), poses: this.poses.filter(x => x.t <= durationMs), twinPoses: this.twinPoses.filter(x => x.t <= durationMs) };
  }
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const poseWire = (p: ObjPose) => [p.u, p.v, p.h, ...p.q].map(r4);
const num = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
function poseOf(a: unknown): ObjPose | null {
  if (!Array.isArray(a) || a.length !== 7) return null;
  const [u, v, h] = [num(a[0], -3, 3), num(a[1], -3, 3), num(a[2], 0, 3)], q = a.slice(3).map(x => num(x, -1, 1));
  if (u === null || v === null || h === null || q.some(x => x === null)) return null;
  const n = Math.hypot(...(q as number[]));
  return { u, v, h, q: (n > 1e-6 ? q.map(x => x! / n) : [0, 0, 0, 1]) as ObjPose['q'] };
}

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;

export const encodeReplay = (r: Replay): string => JSON.stringify({
  v: 3, label: r.label, model: r.model, aspect: r.aspect, durationMs: r.durationMs,
  h: r.hands.map((x, i) => [x.t, x.hands.map(f => b64(encodeHand(i & 0xffff, x.t, f)))]),
  p: r.poses.map(x => [x.t, x.pose && poseWire(x.pose)]),
  ...(r.twin ? { tw: { ...JSON.parse(encodeTwin(r.twin)), type: undefined }, tp: r.twinPoses.map(x => [x.t, encodePose(x.pose)]) } : {}),
});

/** null = not a valid replay. Every field is checked and clamped: the model like a Claude scan, hands with the call's own decoder. */
export function decodeReplay(text: string): Replay | null {
  if (typeof text !== 'string' || text.length > MAX_REPLAY_BYTES) return null;
  let m: any;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || (m.v !== 2 && m.v !== 3) || !Array.isArray(m.h) || !Array.isArray(m.p) || m.h.length > MAX_EVENTS || m.p.length > MAX_EVENTS) return null;
  const model = sanitizeModel(m.model), aspect = num(m.aspect, 0.3, 4), durationMs = typeof m.durationMs === 'number' && m.durationMs >= 0 && m.durationMs <= MAX_REPLAY_MS ? m.durationMs : null;
  if (!model || aspect === null || durationMs === null || typeof m.label !== 'string') return null;
  const time = (t: unknown) => typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= durationMs;
  const hands: Replay['hands'] = [], poses: Replay['poses'] = [];
  for (const e of m.h) {
    if (!Array.isArray(e) || !time(e[0]) || !Array.isArray(e[1]) || e[1].length > MAX_HANDS) return null;
    const frames: HandFrame[] = [];
    for (const s of e[1]) {
      if (typeof s !== 'string' || s.length > 2000) return null;
      let msg; try { msg = decodeHand(unb64(s), 0); } catch { return null; }
      if (!msg?.hand) return null;
      frames.push(msg.hand);
    }
    hands.push({ t: e[0], hands: frames });
  }
  for (const e of m.p) {
    if (!Array.isArray(e) || !time(e[0])) return null;
    const pose = e[1] === null ? null : poseOf(e[1]);
    if (e[1] !== null && !pose) return null;
    poses.push({ t: e[0], pose });
  }
  let twin: TwinInfo | undefined; const twinPoses: Replay['twinPoses'] = [];
  if (m.tw !== undefined) {
    const t = m.tw && typeof m.tw === 'object' ? decodeTwin(JSON.stringify({ ...m.tw, type: 'twin' })) : null;
    if (!t || !Array.isArray(m.tp) || m.tp.length > MAX_EVENTS) return null;
    twin = t;
    for (const e of m.tp) {
      const pose = Array.isArray(e) && time(e[0]) && typeof e[1] === 'string' ? decodePose(e[1]) : null;
      if (!pose) return null;
      twinPoses.push({ t: e[0], pose });
    }
  }
  hands.sort((a, b) => a.t - b.t); poses.sort((a, b) => a.t - b.t); twinPoses.sort((a, b) => a.t - b.t);
  return { label: m.label.slice(0, 60) || 'Object', model, aspect, durationMs, hands, poses, ...(twin ? { twin } : {}), twinPoses };
}

/** Index of the last event at or before t, or -1. Events are sorted by t. */
export function indexAt(events: { t: number }[], t: number): number {
  let lo = 0, hi = events.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (events[mid].t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}
