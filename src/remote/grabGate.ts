import type { GraspKind } from './grasp';

export interface GateInput {
  now: number;            // ms
  kind: GraspKind;        // what the fingers are doing
  tip: { x: number; y: number } | null; // where the hand is; null = no hand
  hovering: boolean;      // the fingers are over something that can be grabbed
  grabbing: boolean;      // already holding something
}

export interface GateOptions {
  /** the hand must have been open this long before closing, so a fist that was already closed never grabs */
  armMs?: number;
  /** it must have been over the thing this long before closing */
  hoverMs?: number;
  /** ...and no faster than this when closing (twin units per second): a wave is far faster than a reach */
  maxSpeed?: number;
  /** after letting go, wait this long before another grab can begin */
  cooldownMs?: number;
}

/**
 * Decides whether closing your fingers is a deliberate grab. Waving a hand in front of the object opens and closes the
 * fingers, and any of that could look like a pinch or a fist, so a grab only starts when the hand
 *   1. was open just before (so a closed hand sweeping over the object grabs nothing),
 *   2. had been over the object for a moment, and
 *   3. is closing slowly, like someone reaching for it, not swinging.
 * It judges the moment of closing only. If that moment fails, nothing is grabbed until the hand opens and closes again,
 * so it can never "catch" the object later in the same closed hand. Once something is held, it stays held.
 */
export class GrabGate {
  private readonly o: Required<GateOptions>;
  private openSince: number | null = null;
  private hoverSince: number | null = null;
  private lastHover = -Infinity;
  private closureOk = false;
  private wasClosed = false;
  private cooldownUntil = 0;
  private wasGrabbing = false;
  private trail: { t: number; x: number; y: number }[] = [];
  // Tuned for one object on screen (the demo): short enough that a plain reach-and-pinch on a dim, dropping camera still
  // grabs; a fast wave (2.5+ units/s) or a fist that was already closed still does not.
  constructor(o: GateOptions = {}) { this.o = { armMs: 80, hoverMs: 50, maxSpeed: 2, cooldownMs: 150, ...o }; }

  /** Speed over about the last 150 ms, in twin units per second. */
  speed(): number {
    const t = this.trail;
    if (t.length < 2) return 0;
    const a = t[0], b = t[t.length - 1];
    return b.t > a.t ? Math.hypot(b.x - a.x, b.y - a.y) / ((b.t - a.t) / 1000) : 0;
  }

  /** The grasp to hand on: 'none' unless this closing is a deliberate grab, or something is already held. */
  filter(i: GateInput): GraspKind {
    if (!i.tip) { this.reset(); return 'none'; }
    this.trail.push({ t: i.now, x: i.tip.x, y: i.tip.y });
    while (this.trail.length > 1 && i.now - this.trail[0].t > 150) this.trail.shift();
    if (i.hovering) { this.hoverSince ??= i.now; this.lastHover = i.now; } else if (i.now - this.lastHover > 120) this.hoverSince = null;

    if (i.grabbing) { this.wasGrabbing = true; this.wasClosed = true; return i.kind; }
    if (this.wasGrabbing) { this.wasGrabbing = false; this.cooldownUntil = i.now + this.o.cooldownMs; this.closureOk = false; }

    if (i.kind === 'none') {
      this.openSince ??= i.now;
      this.wasClosed = false; this.closureOk = false;
      return 'none';
    }
    // Closed, not holding anything.
    if (!this.wasClosed) {                          // this is the moment of closing: judge it now
      this.wasClosed = true;
      const armed = this.openSince !== null && i.now - this.openSince >= this.o.armMs;
      const dwelled = this.hoverSince !== null && i.now - this.hoverSince >= this.o.hoverMs;
      this.closureOk = armed && dwelled && this.speed() <= this.o.maxSpeed && i.now >= this.cooldownUntil;
      this.openSince = null;
    }
    return this.closureOk ? i.kind : 'none';
  }

  reset() { this.openSince = null; this.hoverSince = null; this.closureOk = false; this.wasClosed = false; this.wasGrabbing = false; this.trail = []; this.lastHover = -Infinity; }
}
