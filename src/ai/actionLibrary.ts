import type { ActionAmount, ActionSpec, ActionType, Affordance, Direction, RotationSense } from './types';

export const ACTION_TYPES: readonly ActionType[] = ['twist', 'press', 'pull', 'push', 'slide', 'lift', 'flip', 'tilt'];
export const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right', 'toward', 'away'];

// Which amount keys each action accepts, with sane clamps. The AI parametrizes; it never invents.
const LIMITS: Record<ActionType, Partial<Record<keyof ActionAmount, [number, number]>>> = {
  twist: { turns: [0.1, 10] },
  press: { depthCm: [0.1, 5], repeat: [1, 5] },
  pull: { distanceCm: [0.5, 60] },
  push: { distanceCm: [0.5, 60] },
  slide: { distanceCm: [0.5, 60] },
  lift: { distanceCm: [0.5, 60] },
  flip: {},
  tilt: { angleDeg: [5, 180] },
};
const DIRECTIONAL: ActionType[] = ['pull', 'push', 'slide', 'tilt'];
const DEFAULTS: Record<ActionType, ActionAmount> = {
  twist: { turns: 1 }, press: { depthCm: 0.5, repeat: 1 }, pull: { distanceCm: 10 }, push: { distanceCm: 10 },
  slide: { distanceCm: 10 }, lift: { distanceCm: 10 }, flip: {}, tilt: { angleDeg: 45 },
};

// Verbs (English + Mandarin) that map to a default action. Used by the offline fallback parser and the gate.
export const VERB_ACTIONS: { pattern: RegExp; action: ActionType; sense?: RotationSense }[] = [
  { pattern: /\b(unscrew|open|loosen|undo)\b|拧开|打开|旋开|松开/i, action: 'twist', sense: 'loosen' },
  { pattern: /\b(screw|close|tighten|twist|turn|rotate)\b|拧紧|关上|旋紧|拧|转/i, action: 'twist', sense: 'tighten' },
  { pattern: /\b(press|push the button|click|tap|hit)\b|按|点击/i, action: 'press' },
  { pattern: /\b(pull|drag out|unplug)\b|拉|拔/i, action: 'pull' },
  { pattern: /\b(push|shove)\b|推/i, action: 'push' },
  { pattern: /\b(slide|move|shift)\b|滑|移动/i, action: 'slide' },
  { pattern: /\b(lift|pick up|raise|take off|remove)\b|抬|拿起|取下/i, action: 'lift' },
  { pattern: /\b(flip|switch|toggle)\b|拨|翻/i, action: 'flip' },
  { pattern: /\b(tilt|lean|angle|pour)\b|倾斜|倒/i, action: 'tilt' },
];

export const isActionType = (v: unknown): v is ActionType => typeof v === 'string' && (ACTION_TYPES as readonly string[]).includes(v);

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));

export function sanitizeAmount(action: ActionType, raw: unknown): ActionAmount {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: ActionAmount = { ...DEFAULTS[action] };
  for (const [key, range] of Object.entries(LIMITS[action]) as [keyof ActionAmount, [number, number]][]) {
    const n = src[key];
    if (typeof n === 'number' && Number.isFinite(n)) (out as Record<string, number>)[key] = clamp(n, range);
  }
  if (DIRECTIONAL.includes(action) && typeof src.direction === 'string' && (DIRECTIONS as readonly string[]).includes(src.direction)) {
    out.direction = src.direction as Direction;
  }
  return out;
}

/** Returns a validated spec, or null if the model output is unusable. Clamps ranges, fills defaults. */
export function sanitizeSpec(raw: unknown, fallbackLanguage = 'en'): ActionSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isActionType(r.actionType)) return null;
  const actionType = r.actionType;
  const conf = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const pt = r.targetPoint2d as Record<string, unknown> | null | undefined;
  const point = pt && typeof pt.x === 'number' && typeof pt.y === 'number'
    ? { x: Math.min(1, Math.max(0, pt.x)), y: Math.min(1, Math.max(0, pt.y)) } : null;
  const stepCount = Math.max(1, Math.round(Number(r.stepCount) || 1));
  return {
    actionType,
    rotationSense: actionType === 'twist' ? (r.rotationSense === 'tighten' ? 'tighten' : 'loosen') : undefined,
    targetLabel: typeof r.targetLabel === 'string' ? r.targetLabel.slice(0, 80) : 'object',
    targetObjectId: typeof r.targetObjectId === 'string' ? r.targetObjectId : null,
    targetPoint2d: point,
    axisHint: typeof r.axisHint === 'string' ? r.axisHint.slice(0, 20) : undefined,
    amount: sanitizeAmount(actionType, r.amount),
    stepIndex: Math.min(stepCount, Math.max(1, Math.round(Number(r.stepIndex) || 1))),
    stepCount,
    confidence: conf,
    needsConfirmation: r.needsConfirmation === true || conf < 0.85,
    caption: typeof r.caption === 'string' ? r.caption.slice(0, 200) : '',
    captionLanguage: typeof r.captionLanguage === 'string' ? r.captionLanguage : fallbackLanguage,
    rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 300) : '',
  };
}

/**
 * Renderer-side conversion. Standard thread rule: loosen = counterclockwise viewed from above.
 * Returns a signed angle in radians about the axis, positive = counterclockwise viewed from above.
 */
export function twistAngleRad(sense: RotationSense, turns: number, reverseThread = false): number {
  const loosen = (sense === 'loosen') !== reverseThread;
  return (loosen ? 1 : -1) * turns * Math.PI * 2;
}

export function actionIsValidFor(action: ActionType, affordances: readonly Affordance[]): boolean {
  return affordances.includes(action);
}

/** JSON-schema tools handed to Claude. Constrains output to the fixed action library. */
export const ACTION_TOOLS = [
  {
    name: 'demonstrate_action',
    description: 'Choose one action from the fixed library and parametrize it for the pointed object.',
    input_schema: {
      type: 'object',
      properties: {
        actionType: { type: 'string', enum: [...ACTION_TYPES] },
        rotationSense: { type: 'string', enum: ['loosen', 'tighten'], description: 'twist only' },
        targetObjectId: { type: 'string', description: 'objectId from the candidate list' },
        targetLabel: { type: 'string' },
        axisHint: { type: 'string' },
        amount: {
          type: 'object',
          properties: {
            turns: { type: 'number' }, depthCm: { type: 'number' }, repeat: { type: 'number' },
            distanceCm: { type: 'number' }, angleDeg: { type: 'number' }, direction: { type: 'string', enum: [...DIRECTIONS] },
          },
        },
        stepIndex: { type: 'integer' },
        stepCount: { type: 'integer' },
        confidence: { type: 'number', description: '0..1' },
        caption: { type: 'string', description: "In the viewer's language" },
        rationale: { type: 'string' },
      },
      required: ['actionType', 'targetObjectId', 'targetLabel', 'confidence', 'caption', 'rationale'],
    },
  },
  {
    name: 'ask_clarification',
    description: 'Use when the action is invalid for the object or the target is unclear. Offer exactly 2 options.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'array', minItems: 2, maxItems: 2,
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, objectId: { type: 'string' }, actionType: { type: 'string', enum: [...ACTION_TYPES] } },
            required: ['label'],
          },
        },
      },
      required: ['question', 'options'],
    },
  },
] as const;
