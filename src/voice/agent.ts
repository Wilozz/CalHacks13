import type { AiClient } from '../ai/client';
import type { ContextState, SceneObject, Utterance } from '../ai/types';
import { FocusTracker, matchObjects, type FocusDecision } from './referent';

export type Speaker = 'me' | 'friend';
export interface Heard { id: number; speaker: Speaker; text: string; at: number }

export interface AgentOptions {
  client: Pick<AiClient, 'resolveFocus' | 'summarize'>;
  now: () => number;
  getObjects: () => SceneObject[];
  onFocus: (d: FocusDecision) => void;
  onTopic?: (topic: string) => void;
  onHeard?: (h: Heard) => void;
  onError?: (e: unknown) => void;
  viewerLanguage?: () => string;
  summaryEveryMs?: number;
  askClaudeTimeoutMs?: number;
}

const STRONG = 0.7, WEAK = 0.3;

/**
 * The listening agent. It hears the whole conversation (both people), keeps it as context, and works out which
 * object is being discussed from the words plus where a hand is pointing. Matching names locally gives an
 * instant answer; Claude is asked only when the words are ambiguous or do not name anything we know,
 * which is when context ("the one with the screen", "it") matters.
 */
export class VoiceAgent {
  readonly tracker = new FocusTracker();
  readonly log: Heard[] = [];
  summary: ContextState | null = null;
  topic = '';
  last: FocusDecision = { objectId: null, source: 'none', confidence: 0, pointedId: null, spokenId: null };
  private nextId = 1;
  private lastSummaryAt = 0;
  private summarizing = false;
  private askSeq = 0;
  private appliedSeq = 0;
  private disposed = false;
  constructor(private readonly o: AgentOptions) {}

  dispose() { this.disposed = true; }

  /** A finished sentence from either person. */
  hear(speaker: Speaker, text: string, at = this.o.now()): Heard | null {
    const clean = text.trim();
    if (!clean || this.disposed) return null;
    const h: Heard = { id: this.nextId++, speaker, text: clean, at };
    this.log.push(h); if (this.log.length > 60) this.log.shift();
    this.o.onHeard?.(h);

    const objects = this.o.getObjects();
    if (objects.length) {
      const m = matchObjects(clean, objects);
      const best = m.mentions[0];
      if (best && best.score >= STRONG) this.tracker.mention(best.objectId, m.ambiguous ? 0.55 : Math.min(0.95, best.score), at);
      else if (best && best.score >= WEAK) this.tracker.mention(best.objectId, 0.35, at);
      const wordCount = clean.split(/\s+/).length;
      const needsHelp = m.ambiguous || (!best || best.score < STRONG) && !m.refersToCurrent && wordCount >= 3;
      if (needsHelp) void this.askClaude(h, objects);
    }
    this.maybeSummarize();
    return h;
  }

  /** The object under the pointing fingertip, or null. Call a few times a second. */
  point(id: string | null) { this.tracker.point(id, this.o.now()); }

  /** Re-evaluate; tells the app when the focus changes. */
  tick(): FocusDecision {
    const d = this.tracker.resolve(this.o.getObjects().map(o => o.objectId), this.o.now());
    const changed = d.objectId !== this.last.objectId || d.source !== this.last.source;
    this.last = d;
    if (changed && !this.disposed) this.o.onFocus(d);
    return d;
  }

  private async askClaude(h: Heard, objects: SceneObject[]) {
    const seq = ++this.askSeq;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.askClaudeTimeoutMs ?? 4000);
    try {
      const r = await this.o.client.resolveFocus({
        speaker: h.speaker, utterance: h.text,
        recent: this.log.slice(-9, -1).map(t => ({ speaker: t.speaker, text: t.text })),
        summary: this.summary?.taskSummary ?? null,
        objects: objects.map(o => ({ objectId: o.objectId, label: o.label })),
        focusId: this.last.objectId,
      }, ctl.signal);
      if (this.disposed) return;
      if (r.topic) this.setTopic(r.topic);
      // A slow answer to an old sentence must not override a newer one.
      if (r.objectId && r.confidence >= 0.5 && seq >= this.appliedSeq) { this.appliedSeq = seq; this.tracker.mention(r.objectId, r.confidence, this.o.now()); }
    } catch (e) { this.o.onError?.(e); }
    finally { clearTimeout(timer); }
  }

  private setTopic(t: string) { if (t && t !== this.topic) { this.topic = t; this.o.onTopic?.(t); } }

  private maybeSummarize() {
    const now = this.o.now();
    if (this.summarizing || now - this.lastSummaryAt < (this.o.summaryEveryMs ?? 25_000) || this.log.length < 2) return;
    this.summarizing = true; this.lastSummaryAt = now;
    const turns = this.log.slice(-8).map(t => ({ text: `${t.speaker === 'me' ? 'Me' : 'Friend'}: ${t.text}` })) as unknown as Utterance[];
    this.o.client.summarize({ previous: this.summary, turns, objects: this.o.getObjects(), viewerLanguage: this.o.viewerLanguage?.() ?? 'en' })
      .then(c => { if (this.disposed) return; this.summary = c; this.setTopic(c.taskSummary); })
      .catch(e => this.o.onError?.(e))
      .finally(() => { this.summarizing = false; });
  }
}
