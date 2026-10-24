// Data contracts from ai-integration.md section 5 (JSON, camelCase).
export type ActionType = 'twist' | 'press' | 'pull' | 'push' | 'slide' | 'lift' | 'flip' | 'tilt';
export type Affordance = ActionType;
export type RotationSense = 'loosen' | 'tighten';
export type Direction = 'up' | 'down' | 'left' | 'right' | 'toward' | 'away';

export interface Point2d { x: number; y: number }

export interface ActionAmount {
  turns?: number;
  depthCm?: number;
  repeat?: number;
  distanceCm?: number;
  angleDeg?: number;
  direction?: Direction;
}

export interface ActionSpec {
  actionType: ActionType;
  rotationSense?: RotationSense;
  targetLabel: string;
  targetObjectId: string | null;
  targetPoint2d: Point2d | null;
  axisHint?: string;
  amount: ActionAmount;
  stepIndex: number;
  stepCount: number;
  confidence: number;
  needsConfirmation: boolean;
  caption: string;
  captionLanguage: string;
  rationale: string;
}

export interface ContextState {
  taskSummary: string;
  mentionedObjects: string[];
  currentStep: string;
  language: string;
  updatedAt: number;
}

export interface HandEvent {
  t: number; // seconds, shared clock with transcript words
  isPointing: boolean;
  fingertip2d: Point2d | null;
  wristRotationDegPerSec: number;
  landmarks: [number, number, number][];
}

export type PartShape = 'cylinder' | 'box' | 'sphere' | 'cone';
export type V3 = [number, number, number];
/** One primitive of a parametric twin. size is the full bounding extent; the object is ~1 unit tall, centered. */
export interface ModelPart { shape: PartShape; size: V3; position: V3; color: string; moving: boolean; /** short name of a moving part, such as "cap" */ name?: string }
export interface ModelSpec { parts: ModelPart[]; pivot: V3 }

export interface SceneObject {
  objectId: string;
  label: string;
  parentLabel?: string;
  bbox: [number, number, number, number]; // x0,y0,x1,y1 normalized
  maskRef?: string;
  affordances: Affordance[];
  confidence: number;
  seenAt: number;
  model?: ModelSpec; // Claude-written parametric twin of this object
  /** names of the pieces folded into this object ("cap"), so saying "the cap" finds the bottle */
  partNames?: string[];
}

export interface TranscriptWord { text: string; start: number; end: number }
export interface Utterance {
  text: string;
  words: TranscriptWord[];
  start: number;
  end: number;
  wordTimesExact: boolean; // false when only turn-level timing is known
}

export interface HandMotionSummary {
  pointingFraction: number;
  fingertip: Point2d | null;
  rotationDegPerSec: number;
  rotationSense: RotationSense | null;
}

export interface Candidate { object: SceneObject; distance: number; inside: boolean }

export interface Clarification { question: string; options: { label: string; objectId: string | null; actionType?: ActionType }[] }

export type Decision =
  | { kind: 'play'; spec: ActionSpec }
  | { kind: 'confirm'; spec: ActionSpec; alternatives: Candidate[] }
  | { kind: 'ask'; reason: string; clarification: Clarification | null; fallback: ActionSpec | null };

export interface ParseRequest {
  utterance: Utterance;
  candidates: Candidate[];
  motion: HandMotionSummary;
  context: ContextState | null;
  viewerLanguage: string;
}

// What the parser tool returns: either a spec or a clarification.
export type ParseResult =
  | { kind: 'action'; spec: ActionSpec }
  | { kind: 'clarify'; clarification: Clarification };
