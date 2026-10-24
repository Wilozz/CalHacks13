import { VERB_ACTIONS } from './actionLibrary';
import type { ActionType, RotationSense, TranscriptWord, Utterance } from './types';

const DEICTIC = /\b(this|that|these|those|here|there|now|it)\b|这个|那个|这里|那里|现在|它/i;

export interface GateResult { pass: boolean; verb: ActionType | null; sense: RotationSense | null; deictic: boolean; keyWordTime: number | null }

/**
 * Fusion gate: run the parser only when A is pointing AND the utterance has an action verb or deictic.
 * Prevents random animations from chatter and saves cost. The manual button bypasses it (force = true).
 */
export function gate(u: Utterance, pointing: boolean, force = false): GateResult {
  let verb: ActionType | null = null;
  let sense: RotationSense | null = null;
  for (const v of VERB_ACTIONS) {
    if (v.pattern.test(u.text)) { verb = v.action; sense = v.sense ?? null; break; }
  }
  const deictic = DEICTIC.test(u.text);
  return { pass: force || (pointing && (verb !== null || deictic)), verb, sense, deictic, keyWordTime: keyWordTime(u) };
}

/** Time of the action verb (else deictic) word, so the pointed object is looked up then, not at end of speech. */
export function keyWordTime(u: Utterance): number | null {
  if (!u.wordTimesExact) return u.words.length ? (u.start + u.end) / 2 : null;
  const hit = (re: RegExp) => u.words.find((w: TranscriptWord) => re.test(w.text));
  const verbWord = VERB_ACTIONS.map(v => hit(v.pattern)).find(Boolean);
  const w = verbWord ?? hit(DEICTIC);
  return w ? (w.start + w.end) / 2 : (u.start + u.end) / 2;
}
