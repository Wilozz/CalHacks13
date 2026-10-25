import type { ModelSpec } from '../ai/types';
import { componentsOf, type Component } from './components';
import type { GraspKind } from './grasp';
import type { P3 } from './placement';
import { qAxisAngle, qInv, qMul, qRotate, type Q } from './quat';
import { TwinMover, type MoveInput } from './twinMove';
import { rayBoxDistance, type Hold, type RigState, type Target } from './twinRig';

/** A lanyard with its card: the hero demo. The clasp (and the strap above it) is one piece, the card the other. */
export const isLanyard = (label: string) => /lanyard|badge|lobster|clasp|id card|name ?tag|lanyard card/i.test(label);
/** Every lanyard scan shares one cache name, so the model saved for the demo is found whatever Claude calls it. */
export const LANYARD_KEY = 'lanyard';

/** The lobster claw, drawn at the bottom of the clasp piece: a ring of radius `r` hanging below a short stem. */
// Drawn bigger than a real one would be next to the card: at true size it is a few pixels (see ARCHITECTURE).
export const CLAW = { r: 0.075, tube: 0.016, stem: 0.024 };
/** From the clasp's bottom to the point of the claw that goes through the card's hole. */
const CLAW_DROP = CLAW.stem + 2 * CLAW.r - 0.02;

/**
 * Where the pieces meet, in the model's frame: `hole` on the card, `hook` on the clasp (inside the claw's ring), and
 * `attach` where the claw hangs from the clasp. Clipped on, hook and hole are the same point.
 */
export interface KitProfile { hole: P3; hook: P3; attach: P3 }
export interface KitState {
  joined: boolean;
  /** how far the claw is open, 0..1 (it opens while the clasp is pinched: the thumb on the lever) */
  gate: number;
  /** the open claw is at the hole: let go to clip it on */
  near: boolean;
  /** ms since it clipped on (for the snap), or -1 */
  sinceJoin: number;
}

/** The profile from the model's own shape: the card is the body, the clasp is the one component. */
export function lanyardProfile(model: ModelSpec): KitProfile {
  const clasp = componentsOf(model)[0], mine = new Set(clasp?.parts ?? []);
  const card = model.parts.filter((_, i) => !mine.has(i));
  const top = Math.max(...card.map(p => p.position[1] + p.size[1] / 2)), bottom = Math.min(...card.map(p => p.position[1] - p.size[1] / 2));
  const front = Math.max(...card.map(p => p.position[2] + p.size[2] / 2));
  const cx = card.reduce((s, p) => s + p.position[0], 0) / Math.max(1, card.length);
  const attach: P3 = clasp ? [clasp.center[0], clasp.center[1] + clasp.lo[1], clasp.center[2]] : [cx, top + 0.1, 0];
  return { attach, hook: [attach[0], attach[1] - CLAW_DROP, attach[2]], hole: [cx, top - Math.min(0.08, (top - bottom) * 0.12), front] };
}

const ASSIST = 0.13;        // the open claw this close to the hole lines itself up
const PULL_APART = 0.2;     // with the claw open, the card pulled this far off it comes away
const GRAVITY = 9, DAMPING = 1.6, MAX_SWING = 1.3;
const GATE_RATE = 9;        // the claw opens or closes in about a ninth of a second
const REACH: Record<GraspKind, number> = { none: 0.12, pinch: 0.12, grip: 0.05 };
const CARD_MARGIN = 0.12;
const SLIP_OFF = 0.12;       // lifting the open claw this far lets the card slip off it
/** Where the clasp goes to start apart: up and to the side of the card. */
export const START_APART: P3 = [0.22, 0.2, 0];
/** The clasp's offset when its claw is through the card's hole: how the two are scanned, and how the demo starts. */
export const seatOffset = (p: KitProfile): P3 => [p.hole[0] - p.hook[0], p.hole[1] - p.hook[1], p.hole[2] - p.hook[2]];

const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const IDLE: Hold = { target: null, hover: null, grabbing: false, kind: 'none', anchor: null };

/**
 * The lanyard: two pieces that clip together. Target 'whole' is the card, target 0 the clasp.
 *  - Pinching the clasp opens its claw (as if the thumb pulled the lever); a grip holds it shut.
 *  - Bring the open claw to the card's hole: inside ASSIST it lines itself up and the hole lights. Let go: it clips on.
 *  - Clipped on, the card hangs from the claw and swings when the clasp moves (a damped pendulum driven by how the
 *    clasp accelerates). Holding the card instead moves both as one.
 *  - To take it off: open the claw (pinch the clasp) and lift it, and the card slips off; or, with the claw open, pull
 *    the card away with the other hand. A grip keeps the claw shut, so gripping and lifting carries the card.
 *  - It starts clipped together, as it was scanned (or apart, for practising the clip-on).
 * Poses come out as the twin box expects them: the card is the root, the clasp a component relative to it.
 */
export class KitRig {
  readonly components: Component[];
  kit: KitState = { joined: false, gate: 0, near: false, sinceJoin: -1 };
  private readonly card: TwinMover;
  private readonly clasp: TwinMover;
  private readonly cardBox: { lo: P3; hi: P3 };
  private active: [Target | null, Target | null] = [null, null];
  private theta = 0; private omega = 0; private lastHook: P3 | null = null; private lastVx = 0; private last = -1;
  private joinedAt = -1; private wasNearOpen = false;
  /** where the hook was when the clasp was taken while clipped on (lifting the open claw from there slips the card off) */
  private heldFrom: P3 | null = null;
  /** just taken off: the claw must first move clear of the hole before it can line up again, or it would clip straight back on */
  private armed = true;
  /** the clasp's pose on the card while the card is the one being moved */
  private rel: { off: P3; rot: Q } | null = null;

  constructor(model: ModelSpec, readonly profile: KitProfile, private readonly clock: () => number = () => performance.now(), private readonly start: 'joined' | 'apart' = 'joined') {
    this.components = componentsOf(model);
    const c = this.components[0];
    if (!c) throw new Error('a lanyard needs its clasp as a moving part');
    const lo: P3 = [Infinity, Infinity, Infinity], hi: P3 = [-Infinity, -Infinity, -Infinity];
    model.parts.forEach((p, i) => { if (c.parts.includes(i)) return; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.position[k] - p.size[k] / 2); hi[k] = Math.max(hi[k], p.position[k] + p.size[k] / 2); } });
    this.cardBox = { lo, hi };
    // The rig decides what each hand takes, so the movers take hold wherever they are told to.
    this.card = new TwinMover(this.cardBox, [0.8, 0.8, 0.6], Infinity);
    this.clasp = new TwinMover({ lo: c.lo, hi: [c.hi[0], c.hi[1], c.hi[2]] }, [1.2, 1.2, 0.8], Infinity, c.center);
    this.reset();
  }

  loosened(): (number | null)[] { return this.components.map(() => null); }

  reset() {
    this.active = [null, null]; this.card.reset(); this.clasp.reset();
    const joined = this.start === 'joined';
    this.clasp.offset = joined ? seatOffset(this.profile) : [...START_APART];
    this.kit = { joined, gate: 0, near: false, sinceJoin: -1 };
    this.theta = 0; this.omega = 0; this.lastHook = null; this.lastVx = 0; this.joinedAt = -1; this.wasNearOpen = false; this.rel = null; this.heldFrom = null; this.armed = true;
  }

  private claspCentre(): P3 { return add(this.components[0].center, this.clasp.offset); }
  /** World position of a point given in the model's frame on the clasp (the hook) or on the card (the hole). */
  private onClasp(p: P3): P3 { return add(this.claspCentre(), qRotate(this.clasp.rotation, sub(p, this.components[0].center))); }
  private onCard(p: P3): P3 { return add(this.card.offset, qRotate(this.card.rotation, p)); }
  hookAt(): P3 { return this.onClasp(this.profile.hook); }
  holeAt(): P3 { return this.onCard(this.profile.hole); }

  /** What a hand closing here takes, along the line of sight through the fingertip. The clasp is small, so it is tested first. */
  private pick(tip: P3, slot: 0 | 1, kind: GraspKind): Target | null {
    const other = this.active[1 - slot], d: P3 = [0, 0, 1], c = this.components[0];
    if (other !== 0) {
      const inv = qInv(this.clasp.rotation);
      // The claw hangs below the clasp's box: it counts as the clasp too.
      const lo: P3 = [c.lo[0], Math.min(c.lo[1], this.profile.hook[1] - c.center[1] - CLAW.r), c.lo[2]];
      if (rayBoxDistance(qRotate(inv, sub(tip, this.claspCentre())), qRotate(inv, d), lo, c.hi) <= REACH[kind]) return 0;
    }
    if (other === 'whole') return null;
    const inv = qInv(this.card.rotation);
    return rayBoxDistance(qRotate(inv, sub(tip, this.card.offset)), qRotate(inv, d), this.cardBox.lo, this.cardBox.hi, CARD_MARGIN) <= CARD_MARGIN ? 'whole' : null;
  }
  hoverAt(tip: P3, slot: 0 | 1 = 0, kind: GraspKind = 'none'): Target | null { return this.pick(tip, slot, kind); }

  /** The card hangs from the hook: a damped pendulum about the hole, pushed by the hook's sideways acceleration. */
  private hang(dt: number) {
    const hook = this.hookAt();
    const vx = dt > 0 && this.lastHook ? (hook[0] - this.lastHook[0]) / dt : 0;
    const ax = dt > 0 ? Math.max(-40, Math.min(40, (vx - this.lastVx) / dt)) : 0;
    this.lastVx = vx; this.lastHook = hook;
    const h = this.profile.hole, mid: P3 = [(this.cardBox.lo[0] + this.cardBox.hi[0]) / 2, (this.cardBox.lo[1] + this.cardBox.hi[1]) / 2, h[2]];
    const L = Math.max(0.1, Math.hypot(h[0] - mid[0], h[1] - mid[1]));
    this.omega += (-(GRAVITY / L) * Math.sin(this.theta) - DAMPING * this.omega - (ax / L) * Math.cos(this.theta)) * dt;
    this.theta = Math.max(-MAX_SWING, Math.min(MAX_SWING, this.theta + this.omega * dt));
    this.card.rotation = qAxisAngle([0, 0, 1], this.theta);
    this.card.offset = sub(hook, qRotate(this.card.rotation, h));
  }

  /** Clip on: the hook is put exactly in the hole, and the card gets a small swing, so you see it is on. */
  private join(now: number) {
    const shift = sub(this.holeAt(), this.hookAt());
    this.clasp.offset = add(this.clasp.offset, shift);
    this.clasp.release(); // a hand still on it (closed to a grip) carries on from here, not from before the snap
    this.kit.joined = true; this.joinedAt = now;
    this.theta = 0; this.omega = 1.6; this.lastHook = null; this.lastVx = 0; this.rel = null;
  }

  step(inputs: [MoveInput | null, MoveInput | null]): RigState {
    const now = this.clock(), dt = this.last < 0 ? 1 / 60 : Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const anchors: [P3 | null, P3 | null] = [null, null];
    ([0, 1] as const).forEach(s => { const i = inputs[s]; if (!i || i.kind === 'none') this.active[s] = null; });
    ([0, 1] as const).forEach(s => { const i = inputs[s]; if (i && i.kind !== 'none' && this.active[s] === null) this.active[s] = this.pick(i.tip, s, i.kind); });
    const cs = ([0, 1] as const).find(s => this.active[s] === 0), ws = ([0, 1] as const).find(s => this.active[s] === 'whole');
    const ci = cs === undefined ? null : inputs[cs], wi = ws === undefined ? null : inputs[ws];
    const open = ci?.kind === 'pinch';
    this.kit.gate += Math.max(-GATE_RATE * dt, Math.min(GATE_RATE * dt, (open ? 1 : 0) - this.kit.gate));

    if (!ci) this.heldFrom = null;
    if (this.kit.joined) {
      if (ci) {
        this.heldFrom ??= this.hookAt();
        anchors[cs!] = this.clasp.update(ci).anchor; this.rel = null;
        const hook = this.hookAt(), lifted = Math.hypot(hook[0] - this.heldFrom[0], hook[1] - this.heldFrom[1]);
        if (wi && open && Math.hypot(wi.tip[0] - this.holeAt()[0], wi.tip[1] - this.holeAt()[1]) > PULL_APART) {
          this.kit.joined = false; this.armed = false;       // pulled off the open claw
          anchors[ws!] = this.card.update(wi).anchor;
        } else if (!wi && open) {
          // The claw is open: the card does not ride up with it. Lifted clear, the card has slipped off where it hung.
          this.card.update(null); this.lastHook = null;
          if (lifted > SLIP_OFF) { this.kit.joined = false; this.armed = false; }
        } else { this.card.update(null); this.hang(dt); }
      } else if (wi) {
        // Holding the card: the clasp rides along exactly where it is on it.
        const R = this.card.rotation, c = this.components[0].center;
        this.rel ??= { off: qRotate(qInv(R), sub(this.claspCentre(), this.card.offset)), rot: qMul(qInv(R), this.clasp.rotation) };
        anchors[ws!] = this.card.update(wi).anchor; this.clasp.update(null);
        this.clasp.offset = sub(add(this.card.offset, qRotate(this.card.rotation, this.rel.off)), c);
        this.clasp.rotation = qMul(this.card.rotation, this.rel.rot);
        this.lastHook = null; this.theta = 0; this.omega = 0;
      } else {
        this.clasp.update(null); this.card.update(null); this.rel = null; this.hang(dt);
      }
      this.kit.near = false; this.wasNearOpen = false;
    } else {
      if (cs !== undefined) anchors[cs] = this.clasp.update(ci).anchor; else this.clasp.update(null);
      if (ws !== undefined) anchors[ws] = this.card.update(wi).anchor; else this.card.update(null);
      const gap = sub(this.holeAt(), this.hookAt()), dist = Math.hypot(gap[0], gap[1]);
      if (dist > ASSIST * 1.5) this.armed = true;
      this.kit.near = open && this.armed && dist < ASSIST;
      if (this.kit.near) {
        // Line it up: the claw is drawn halfway to the hole (the hand only has to get close).
        const pull: P3 = [gap[0] * 0.5, gap[1] * 0.5, gap[2] * 0.5];
        this.clasp.offset = add(this.clasp.offset, pull);
        if (cs !== undefined && anchors[cs]) anchors[cs] = add(anchors[cs]!, pull);
      }
      // Letting go of the open claw at the hole clips it on.
      if (this.wasNearOpen && !open) this.join(now);
      this.wasNearOpen = this.kit.near;
    }
    this.kit.sinceJoin = this.kit.joined && this.joinedAt >= 0 ? now - this.joinedAt : -1;

    // The card is the root; the clasp is a component, relative to it.
    const R = this.card.rotation, inv = qInv(R), c = this.components[0].center;
    const rel = sub(qRotate(inv, sub(this.claspCentre(), this.card.offset)), c);
    const holds = ([0, 1] as const).map(s => {
      const i = inputs[s], t = this.active[s];
      if (!i) return IDLE;
      return { target: t, hover: t === null ? this.pick(i.tip, s, i.kind) : null, grabbing: t !== null, kind: t !== null ? i.kind : 'none', anchor: anchors[s] } as Hold;
    }) as [Hold, Hold];
    return {
      root: { offset: [...this.card.offset], rotation: R },
      parts: [{ offset: rel, rotation: qMul(inv, this.clasp.rotation) }],
      holds, target: holds[0].target, hover: holds[0].hover, grabbing: holds[0].grabbing, kind: holds[0].kind, anchor: holds[0].anchor,
    };
  }

  update(input: MoveInput | null): RigState { return this.step([input, null]); }
}

