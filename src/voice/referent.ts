/** Which visible object does a sentence mention? Fast local matching; Claude handles the hard cases. */

const STOP = new Set(['the', 'a', 'an', 'of', 'on', 'in', 'with', 'and', 'to', 'it', 'this', 'that', 'one', 'my', 'your']);
const COLORS = new Set(['red', 'blue', 'green', 'black', 'white', 'yellow', 'orange', 'purple', 'pink', 'grey', 'gray', 'brown', 'silver', 'gold', 'small', 'big', 'large', 'little']);

// Words people use for the same thing. The first entry is the canonical head noun.
const SYNONYMS: string[][] = [
  ['bottle', 'flask', 'canteen', 'tumbler', 'thermos', 'bottles'],
  ['phone', 'smartphone', 'iphone', 'android', 'cellphone', 'mobile', 'handset', 'phones'],
  ['box', 'carton', 'package', 'parcel', 'crate', 'boxes'],
  ['cap', 'lid', 'top', 'cover', 'caps', 'lids'],
  ['laptop', 'computer', 'notebook', 'macbook', 'pc'],
  ['cup', 'mug', 'glass', 'cups', 'mugs'],
  ['bag', 'pouch', 'packet', 'sack', 'bags'],
  ['button', 'buttons', 'key', 'switch'],
  ['knob', 'dial', 'handle', 'knobs'],
  ['remote', 'controller', 'clicker'],
  ['router', 'modem'],
  ['cable', 'cord', 'wire', 'charger', 'cables'],
  ['can', 'tin', 'cans'],
  ['pen', 'marker', 'pencil', 'pens'],
];
const CANON = new Map<string, string>();
for (const g of SYNONYMS) for (const w of g) CANON.set(w, g[0]);

export const PRONOUN_ONLY = /^(?:(?:ok|okay|yeah|yes|so|and|now|then|well|just|um|uh)[,\s]+)*(?:it|this|that|this one|that one|these|those|there|here)(?:\W|$)/i;
const REFERS_TO_CURRENT = /\b(it|this|that|this one|that one|the same one)\b/i;

export const tokenize = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
const canon = (w: string) => CANON.get(w) ?? (w.endsWith('s') && w.length > 3 ? CANON.get(w.slice(0, -1)) ?? w.slice(0, -1) : w);

export interface ObjectRef { objectId: string; label: string }
export interface Mention { objectId: string; score: number; term: string }
export interface MatchResult { mentions: Mention[]; ambiguous: boolean; refersToCurrent: boolean }

/** Words of a label that identify it (head noun last), as canonical forms. */
function labelTerms(label: string): { head: string; all: string[]; modifiers: string[] } {
  const words = tokenize(label).filter(w => !STOP.has(w)).map(canon);
  const head = words[words.length - 1] ?? '';
  return { head, all: words, modifiers: words.slice(0, -1) };
}

/**
 * Scores every object against a sentence. The head noun ("bottle" in "water bottle") counts most; naming the
 * whole label scores highest; a colour or size alone ("the red one") counts a little. Objects whose label is a
 * part of another ("bottle cap" / "bottle") both match "the cap on the bottle": the part wins when its own
 * head noun was said, because the sentence is about that part.
 */
export function matchObjects(text: string, objects: ObjectRef[]): MatchResult {
  const tokens = tokenize(text).map(canon);
  const said = new Set(tokens);
  const mentions: Mention[] = [];
  for (const o of objects) {
    const { head, all, modifiers } = labelTerms(o.label);
    if (!head) continue;
    const headHit = said.has(head);
    const modHits = modifiers.filter(m => said.has(m)).length;
    let score = 0, term = head;
    if (headHit) { score = 0.8 + 0.2 * ((modHits + 1) / all.length); term = all.filter(w => said.has(w)).join(' ') || head; }
    else if (modHits && modifiers.some(m => !COLORS.has(m))) { score = 0.35 * (modHits / modifiers.length); term = modifiers.filter(m => said.has(m)).join(' '); }
    else if (modHits) score = 0.25;
    if (score > 0) mentions.push({ objectId: o.objectId, score: +score.toFixed(3), term });
  }
  // Equal scores: the more specific label wins ("bottle cap" over "bottle" for a sentence about the cap).
  const specificity = new Map(objects.map(o => [o.objectId, labelTerms(o.label).all.length]));
  mentions.sort((a, b) => b.score - a.score || (specificity.get(b.objectId) ?? 0) - (specificity.get(a.objectId) ?? 0));
  const strong = mentions.filter(m => m.score >= 0.7);
  const ambiguous = strong.length > 1 && strong[0].score - strong[1].score < 0.15;
  return { mentions, ambiguous, refersToCurrent: !mentions.length && (PRONOUN_ONLY.test(text.trim()) || (tokens.length <= 4 && REFERS_TO_CURRENT.test(text))) };
}

export interface FocusDecision {
  objectId: string | null;
  /** point = fingertip dwelling on it; voice = just said; both = said and pointed; memory = still remembered; none */
  source: 'point' | 'voice' | 'both' | 'memory' | 'none';
  confidence: number;
  pointedId: string | null;
  spokenId: string | null;
}

export interface TrackerOptions { dwellMs?: number; pointGraceMs?: number; minHoldMs?: number; voiceWinsMs?: number }

/**
 * Combines what is said with where the hand points to choose the object to show.
 *  - Saying an object's name focuses it right away, and it stays focused with no time limit, until you point at something.
 *  - Pointing (a steady fingertip on an object for ~0.45 s) focuses that object; saying a different object's name
 *    AFTER you started pointing takes over, because the newest deliberate signal wins.
 *  - Said and pointed at the same object is the most confident case.
 *  - When the hand moves away the last focus stays; nothing flickers back to something said earlier.
 */
export class FocusTracker {
  private spoken: { id: string; strength: number; at: number } | null = null;
  private cand: { id: string; since: number } | null = null;
  private active: { id: string; since: number; lastSeen: number } | null = null;
  private held: string | null = null;
  private current: { id: string | null; since: number } = { id: null, since: -Infinity };
  private readonly o: Required<TrackerOptions>;
  constructor(o: TrackerOptions = {}) { this.o = { dwellMs: 450, pointGraceMs: 1500, minHoldMs: 500, voiceWinsMs: 6000, ...o }; }

  /** The sentence named an object. */
  mention(id: string, strength: number, now: number) { this.spoken = { id, strength: Math.min(1, Math.max(0, strength)), at: now }; }

  /** Feed the object currently under the fingertip (or null) every few tenths of a second. */
  point(id: string | null, now: number) {
    if (id === null) { this.cand = null; return; }
    if (this.cand?.id !== id) this.cand = { id, since: now };
    if (this.active?.id === id) { this.active.lastSeen = now; return; }
    if (now - this.cand.since >= this.o.dwellMs) {
      this.active = { id, since: this.cand.since, lastSeen: now };
      // Pointing at something deliberately settles what was said earlier.
      if (this.spoken && this.spoken.id !== id && this.spoken.at < this.cand.since) this.spoken = null;
    }
  }

  reset() { this.spoken = null; this.cand = null; this.active = null; this.held = null; this.current = { id: null, since: -Infinity }; }

  resolve(visibleIds: string[], now: number): FocusDecision {
    const ok = (id: string | null | undefined): id is string => !!id && visibleIds.includes(id);
    if (this.active && now - this.active.lastSeen > this.o.pointGraceMs) this.active = null;
    const pointedId = ok(this.active?.id) ? this.active!.id : null;
    const spokenId = ok(this.spoken?.id) ? this.spoken!.id : null;

    let id: string | null = null, source: FocusDecision['source'] = 'none', confidence = 0;
    if (pointedId && spokenId) {
      if (pointedId === spokenId) { id = pointedId; source = 'both'; confidence = Math.min(1, 0.75 + 0.25 * this.spoken!.strength); }
      else if (this.spoken!.at > this.active!.since) { id = spokenId; source = 'voice'; confidence = this.spoken!.strength * 0.8; }
      else { id = pointedId; source = 'point'; confidence = 0.8; }
    } else if (pointedId) { id = pointedId; source = 'point'; confidence = 0.85; }
    else if (spokenId) { id = spokenId; source = 'voice'; confidence = this.spoken!.strength * 0.9; }
    else if (ok(this.held)) { id = this.held; source = 'memory'; confidence = 0.5; }

    // Do not flip between objects faster than a person could mean it.
    if (id !== this.current.id) {
      const stable = now - this.current.since >= this.o.minHoldMs || !ok(this.current.id);
      if (stable) this.current = { id, since: now }; else { id = this.current.id; source = 'memory'; }
    }
    if (id) this.held = id;
    return { objectId: id, source, confidence: +confidence.toFixed(3), pointedId, spokenId };
  }
}
