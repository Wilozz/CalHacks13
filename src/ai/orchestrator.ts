import type { AiClient } from './client';
import { gate } from './gate';
import { HandHistory } from './handHistory';
import { offlineParse } from './offlineParser';
import { decide } from './policy';
import { SceneCache } from './sceneCache';
import type { Transcript } from './transcript';
import type { ActionSpec, ContextState, Decision, ParseRequest, ParseResult, Utterance } from './types';

export interface Timing {
  sttToDecisionMs: number; // end of speech (utterance.end) to decision, on the shared clock
  parseMs: number;
  cacheAgeSec: number | null;
  usedFallback: boolean;
}

export interface Outcome { utterance: Utterance; decision: Decision; timing: Timing }

export interface OrchestratorOptions {
  client: AiClient;
  clock: () => number; // seconds, same clock as hand events and transcript
  viewerLanguage: () => string;
  parseTimeoutMs?: number;
  summaryIntervalSec?: number;
  reverseThread?: () => boolean;
  onOutcome: (o: Outcome) => void;
  onSkipped?: (u: Utterance, why: string) => void;
  onContext?: (c: ContextState) => void;
  onError?: (e: unknown) => void;
}

/** Wires transcript + hand history + scene cache -> gate -> Claude -> policy. Section 3 pipeline. */
export class Orchestrator {
  readonly hands = new HandHistory(2);
  readonly scene = new SceneCache();
  context: ContextState | null = null;
  private lastSummary = 0;
  private summarizing = false;
  private unsub: () => void;
  private pendingForce = false;

  constructor(readonly transcript: Transcript, private readonly o: OrchestratorOptions) {
    this.unsub = transcript.onUtterance(u => { void this.handle(u, this.pendingForce); this.pendingForce = false; });
  }

  dispose() { this.unsub(); this.hands.clear(); this.scene.clear(); }

  /** "Demonstrate" button: bypass the gate for the next utterance, or re-run the latest one now. */
  demonstrate() {
    const last = this.transcript.recent(1)[0];
    if (last && this.o.clock() - last.end < 5) void this.handle(last, true);
    else this.pendingForce = true;
  }

  async handle(u: Utterance, force = false): Promise<Outcome | null> {
    const g = gate(u, this.hands.isPointingNow(u.end), force);
    if (!g.pass) { this.o.onSkipped?.(u, 'gate: no pointing or no action verb/deictic'); this.maybeSummarize(); return null; }

    const t = g.keyWordTime ?? (u.start + u.end) / 2;
    const fingertip = this.hands.pointedAt(t);
    const candidates = this.scene.candidatesAt(fingertip);
    const motion = this.hands.summarize(u.start, u.end);
    if (motion.rotationSense && this.o.reverseThread?.()) motion.rotationSense = motion.rotationSense === 'loosen' ? 'tighten' : 'loosen';
    const req: ParseRequest = { utterance: u, candidates, motion: { ...motion, fingertip: fingertip ?? motion.fingertip }, context: this.context, viewerLanguage: this.o.viewerLanguage() };

    const started = performance.now();
    let result: ParseResult | null = null;
    let usedFallback = false;
    if (!candidates.length && !force) {
      // Nothing known under the fingertip: skip the model call and ask the helper to tap.
      usedFallback = true;
    } else {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.o.parseTimeoutMs ?? 4000);
      try { result = await this.o.client.parseAction(req, ctl.signal); }
      catch (e) { this.o.onError?.(e); usedFallback = true; }
      finally { clearTimeout(timer); }
    }
    result ??= offlineParse(req);
    const parseMs = performance.now() - started;

    const decision: Decision = result
      ? decide(result, candidates, u.text)
      : { kind: 'ask', reason: 'no object under pointer', clarification: null, fallback: null };
    // Fallback parses never auto-play.
    const final = usedFallback && decision.kind === 'play' ? { kind: 'confirm', spec: decision.spec, alternatives: [] } as Decision : decision;

    const outcome: Outcome = { utterance: u, decision: final, timing: { sttToDecisionMs: (this.o.clock() - u.end) * 1000, parseMs, cacheAgeSec: this.scene.ageSec(this.o.clock()), usedFallback } };
    this.o.onOutcome(outcome);
    this.maybeSummarize();
    return outcome;
  }

  /** Re-resolve a confirm/ask with the helper's tap or chosen alternative. */
  resolveWithObject(spec: ActionSpec, objectId: string): Decision {
    const obj = this.scene.get(objectId);
    if (!obj) return { kind: 'ask', reason: 'object no longer visible', clarification: null, fallback: null };
    return { kind: 'play', spec: { ...spec, targetObjectId: obj.objectId, targetLabel: obj.label, confidence: 1, needsConfirmation: false } };
  }

  /** Context summarizer: every ~25 s of chatter, never overlapping. */
  maybeSummarize(force = false) {
    const now = this.o.clock();
    if (this.summarizing || (!force && now - this.lastSummary < (this.o.summaryIntervalSec ?? 25))) return;
    const turns = this.transcript.recent(5);
    if (!turns.length) return;
    this.summarizing = true;
    this.lastSummary = now;
    this.o.client.summarize({ previous: this.context, turns, objects: this.scene.all(), viewerLanguage: this.o.viewerLanguage() })
      .then(c => { this.context = c; this.o.onContext?.(c); })
      .catch(e => this.o.onError?.(e))
      .finally(() => { this.summarizing = false; });
  }
}
