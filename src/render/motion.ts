import { twistAngleRad } from '../ai/actionLibrary';
import type { ActionSpec, ActionType, Direction } from '../ai/types';

export type Vec3 = [number, number, number];
export type TwinKind = 'bottle' | 'knob' | 'button' | 'switch' | 'box';

/** Pose of the moving part of the twin, in twin units (object ~1 unit tall), plus ghost-hand weight. */
export interface Pose { pos: Vec3; rot: Vec3; progress: number }

export const LOOP_SECONDS = 3.4;
const HOLD_IN = 0.15, HOLD_OUT = 0.85;

const DIR: Record<Direction, Vec3> = { up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], toward: [0, 0, 1], away: [0, 0, -1] };
const DEFAULT_DIR: Partial<Record<ActionType, Direction>> = { pull: 'toward', push: 'away', slide: 'right', lift: 'up', tilt: 'right' };

const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Loop phase t in [0,1) -> eased action progress: hold, act, hold. */
export function actionProgress(t: number): number {
  return ease(clamp01((((t % 1) + 1) % 1 - HOLD_IN) / (HOLD_OUT - HOLD_IN)));
}

export function directionVector(spec: ActionSpec): Vec3 {
  return DIR[spec.amount.direction ?? DEFAULT_DIR[spec.actionType] ?? 'up'];
}

/** cm -> twin units. 10 cm is about a quarter of the twin; clamped so nothing leaves the view. */
export const travelUnits = (cm = 10) => Math.min(1.1, Math.max(0.2, cm / 40));

export function poseAt(spec: ActionSpec, loopT: number, reverseThread = false): Pose {
  const p = actionProgress(loopT);
  const pos: Vec3 = [0, 0, 0];
  const rot: Vec3 = [0, 0, 0];
  const a = spec.amount;
  switch (spec.actionType) {
    case 'twist': {
      const angle = twistAngleRad(spec.rotationSense ?? 'loosen', a.turns ?? 1, reverseThread) * p;
      rot[1] = angle;
      // A loosening cap rises slightly as it turns, a tightening one sinks. Follows the signed angle.
      pos[1] = Math.sign(angle) * Math.min(0.12, Math.abs(angle) / (Math.PI * 2) * 0.05);
      break;
    }
    case 'press': {
      const n = a.repeat ?? 1;
      pos[1] = -Math.min(0.2, (a.depthCm ?? 0.5) * 0.12 + 0.05) * Math.abs(Math.sin(Math.PI * n * p));
      break;
    }
    case 'pull': case 'push': case 'slide': case 'lift': {
      const d = directionVector(spec), s = travelUnits(a.distanceCm) * p;
      pos[0] = d[0] * s; pos[1] = d[1] * s; pos[2] = d[2] * s;
      break;
    }
    case 'flip': rot[2] = -(Math.PI / 4) * (2 * p - 1) * (a.direction === 'left' ? -1 : 1); break;
    case 'tilt': rot[2] = -(a.angleDeg ?? 45) * Math.PI / 180 * p * (a.direction === 'left' ? -1 : 1); break;
  }
  return { pos, rot, progress: p };
}

/** Tier 1: choose a procedural model from the label, falling back on the action. */
export function twinKindFor(spec: ActionSpec, parentLabel = ''): TwinKind {
  const text = `${spec.targetLabel} ${parentLabel}`.toLowerCase();
  if (/bottle|cap|lid|jar|tube|瓶/.test(text)) return 'bottle';
  if (/knob|dial|valve|handle|旋钮/.test(text)) return 'knob';
  if (/button|key|switch button|reset|按/.test(text)) return 'button';
  if (/switch|lever|toggle|开关/.test(text)) return 'switch';
  return ({ twist: 'knob', press: 'button', flip: 'switch', tilt: 'bottle' } as Partial<Record<ActionType, TwinKind>>)[spec.actionType] ?? 'box';
}

/**
 * Place the floating twin beside the anchor on the side with more room. Units are frame heights.
 * The vertical margins leave space for the hand and arrows above the object and its body below.
 */
export function twinPlacement(anchor: { x: number; y: number }, aspect: number, scale = 0.2) {
  const side = anchor.x < aspect / 2 ? 1 : -1;
  const xMargin = scale * 1.6;
  const x = Math.min(aspect - xMargin, Math.max(xMargin, anchor.x + side * scale * 3));
  const y = Math.min(1 - scale * 2.4, Math.max(scale * 1.3, anchor.y));
  return { x, y, scale };
}

/** Normalized video point (origin top-left) -> scene units; x flipped when the preview is mirrored. */
export function toScene(p: { x: number; y: number }, aspect: number, mirrored: boolean) {
  return { x: (mirrored ? 1 - p.x : p.x) * aspect, y: 1 - p.y };
}
