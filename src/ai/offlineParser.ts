import { sanitizeSpec } from './actionLibrary';
import type { ParseRequest, ParseResult } from './types';
import { gate } from './gate';

/**
 * Local fallback when Claude is slow or unreachable. Verb table plus the pointed object, capped at
 * "confirm" confidence so the helper always checks it. Drives the Tier 0 ghost animation.
 */
export function offlineParse(req: ParseRequest): ParseResult | null {
  const g = gate(req.utterance, true, true);
  const target = req.candidates[0]?.object;
  if (!target) return null;
  const action = g.verb ?? target.affordances[0];
  if (!action) return null;
  const sense = g.sense ?? req.motion.rotationSense ?? 'loosen';
  const spec = sanitizeSpec({
    actionType: action, rotationSense: sense, targetObjectId: target.objectId, targetLabel: target.label,
    targetPoint2d: req.motion.fingertip, confidence: g.verb ? 0.72 : 0.62,
    caption: `${action} the ${target.label}`, captionLanguage: req.viewerLanguage,
    rationale: 'Offline fallback: verb table and pointed object',
  }, req.viewerLanguage);
  return spec ? { kind: 'action', spec } : null;
}
