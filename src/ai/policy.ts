import { actionIsValidFor } from './actionLibrary';
import type { ActionSpec, Candidate, Decision, ParseResult, SceneObject } from './types';

// Starting guesses from the spec; tune on the evaluation set.
export const PLAY_AT = 0.85;
export const CONFIRM_AT = 0.6;
const CONFLICT_CAP = 0.8; // spoken/chosen target differs from pointed object: never auto-play

const norm = (s: string) => s.toLowerCase().trim();
export const labelSpoken = (label: string, text: string) => {
  const l = norm(label);
  return !!l && (norm(text).includes(l) || l.split(/\s+/).some(w => w.length >= 3 && norm(text).includes(w)));
};

/**
 * Section 6 decision table. The model proposes; this function enforces the rules so a confident
 * but wrong answer cannot skip the helper's confirmation.
 */
export function decide(result: ParseResult, candidates: Candidate[], utterance: string): Decision {
  if (result.kind === 'clarify') return { kind: 'ask', reason: 'clarification', clarification: result.clarification, fallback: null };

  const spec: ActionSpec = { ...result.spec };
  const pointed = candidates[0] ?? null;
  const chosen = candidates.find(c => c.object.objectId === spec.targetObjectId) ?? null;

  if (!pointed) {
    // Nothing under the fingertip: helper must tap the object.
    return { kind: 'ask', reason: 'no object under pointer', clarification: null, fallback: { ...spec, confidence: Math.min(spec.confidence, CONFIRM_AT - 0.01), needsConfirmation: true } };
  }

  if (!chosen) {
    // Prefer the pointed object over a conflicting target, with lower confidence.
    spec.targetObjectId = pointed.object.objectId;
    spec.targetLabel = pointed.object.label;
    spec.confidence = Math.min(spec.confidence, CONFLICT_CAP);
  }

  const target = candidates.find(c => c.object.objectId === spec.targetObjectId)!.object;
  if (!actionIsValidFor(spec.actionType, target.affordances)) {
    const alt = target.affordances[0];
    return {
      kind: 'ask', reason: `${spec.actionType} is not valid for ${target.label}`, fallback: null,
      clarification: {
        question: `Do you mean to ${alt ?? 'interact with'} the ${target.label}?`,
        options: [
          ...(alt ? [{ label: `${alt} the ${target.label}`, objectId: target.objectId, actionType: alt }] : []),
          { label: 'Pick another object', objectId: null },
        ].slice(0, 2),
      },
    };
  }

  // Ambiguous: another, unrelated candidate is about as close and the helper did not name the target.
  // A part nested inside its parent (cap in bottle) is not ambiguous: the most specific object wins.
  const second = candidates.find(c => c !== candidates[0] && !nested(candidates[0].object, c.object));
  if (second && !labelSpoken(target.label, utterance)) {
    const a = candidates[0];
    if (!a.inside || (second.inside === a.inside && Math.abs(a.distance - second.distance) < 0.02)) spec.confidence = Math.min(spec.confidence, CONFLICT_CAP);
  }

  spec.targetPoint2d ??= center(target.bbox);
  spec.needsConfirmation = spec.confidence < PLAY_AT;
  if (spec.confidence >= PLAY_AT) return { kind: 'play', spec };
  if (spec.confidence >= CONFIRM_AT) return { kind: 'confirm', spec, alternatives: candidates.filter(c => c.object.objectId !== target.objectId) };
  return { kind: 'ask', reason: 'low confidence', clarification: null, fallback: spec };
}

const center = (b: [number, number, number, number]) => ({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 });

const nested = (a: SceneObject, b: SceneObject) => contains(a, b) || contains(b, a);
const contains = (o: SceneObject, i: SceneObject) => o.bbox[0] <= i.bbox[0] && o.bbox[1] <= i.bbox[1] && o.bbox[2] >= i.bbox[2] && o.bbox[3] >= i.bbox[3];
