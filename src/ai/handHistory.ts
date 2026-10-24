import type { HandEvent, HandMotionSummary, Point2d, RotationSense } from './types';

type Lm = { x: number; y: number; z: number };
const dist = (a: Lm, b: Lm) => Math.hypot(a.x - b.x, a.y - b.y);

/** Index finger extended while middle, ring and pinky are curled. Landmarks are MediaPipe's 21 points. */
export function isPointingPose(lm: Lm[]): boolean {
  if (lm.length !== 21) return false;
  const wrist = lm[0];
  const extended = (tip: number, pip: number) => dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.15;
  const curled = (tip: number, pip: number) => dist(lm[tip], wrist) < dist(lm[pip], wrist) * 1.05;
  return extended(8, 6) && curled(12, 10) && curled(16, 14) && curled(20, 18);
}

/** Roll angle of the hand (wrist to middle knuckle) in degrees, image coordinates, y down. */
export function handRollDeg(lm: Lm[]): number {
  return (Math.atan2(lm[9].y - lm[0].y, lm[9].x - lm[0].x) * 180) / Math.PI;
}

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export function handEventFromLandmarks(t: number, lm: Lm[], prev: { t: number; rollDeg: number } | null): { event: HandEvent; rollDeg: number | null } {
  if (lm.length !== 21) {
    return { event: { t, isPointing: false, fingertip2d: null, wristRotationDegPerSec: 0, landmarks: [] }, rollDeg: null };
  }
  const roll = handRollDeg(lm);
  const dt = prev ? t - prev.t : 0;
  const rate = prev && dt > 0 && dt < 0.5 ? wrapDeg(roll - prev.rollDeg) / dt : 0;
  return {
    event: {
      t, isPointing: isPointingPose(lm),
      fingertip2d: { x: lm[8].x, y: lm[8].y },
      wristRotationDegPerSec: rate,
      landmarks: lm.map(p => [p.x, p.y, p.z]),
    },
    rollDeg: roll,
  };
}

/** Rolling buffer of ~2 s of timestamped hand events. Speech arrives late, so lookups are by time. */
export class HandHistory {
  private events: HandEvent[] = [];
  private prev: { t: number; rollDeg: number } | null = null;
  constructor(private readonly windowSec = 2) {}

  pushLandmarks(t: number, lm: Lm[]): HandEvent {
    const { event, rollDeg } = handEventFromLandmarks(t, lm, this.prev);
    this.prev = rollDeg === null ? null : { t, rollDeg };
    this.push(event);
    return event;
  }

  push(e: HandEvent) {
    this.events.push(e);
    const cutoff = e.t - this.windowSec;
    let i = 0;
    while (i < this.events.length && this.events[i].t < cutoff) i++;
    if (i) this.events.splice(0, i);
  }

  clear() { this.events = []; this.prev = null; }
  get size() { return this.events.length; }

  between(t0: number, t1: number): HandEvent[] { return this.events.filter(e => e.t >= t0 && e.t <= t1); }

  /** Fingertip positions while pointing in [t-spread, t+spread]; newest last. */
  fingertipsAround(t: number, spread = 0.4): { t: number; p: Point2d }[] {
    return this.between(t - spread, t + spread).flatMap(e => (e.isPointing && e.fingertip2d ? [{ t: e.t, p: e.fingertip2d }] : []));
  }

  isPointingNow(now: number, grace = 0.35): boolean {
    return this.events.some(e => e.isPointing && now - e.t <= grace);
  }

  /** Median fingertip while pointing near t (robust to jitter). */
  pointedAt(t: number, spread = 0.4): Point2d | null {
    const pts = this.fingertipsAround(t, spread).map(f => f.p);
    if (!pts.length) return null;
    const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    return { x: med(pts.map(p => p.x)), y: med(pts.map(p => p.y)) };
  }

  /**
   * Summary over a window. rotationSense is only a hint, reported when the helper clearly rolled the hand.
   * Image y points down, so a positive roll rate is clockwise on screen, which we read as "tighten".
   * The parser treats it as weak evidence; spoken verbs win, and the helper-side "reverse thread" toggle applies later.
   */
  summarize(t0: number, t1: number): HandMotionSummary {
    const evs = this.between(t0, t1);
    if (!evs.length) return { pointingFraction: 0, fingertip: null, rotationDegPerSec: 0, rotationSense: null };
    const pointing = evs.filter(e => e.isPointing).length / evs.length;
    const mid = (t0 + t1) / 2;
    const rates = evs.map(e => e.wristRotationDegPerSec);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const sense: RotationSense | null = Math.abs(mean) < 60 ? null : mean > 0 ? 'tighten' : 'loosen';
    return { pointingFraction: pointing, fingertip: this.pointedAt(mid, (t1 - t0) / 2 + 0.01), rotationDegPerSec: mean, rotationSense: sense };
  }
}
