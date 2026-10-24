import type { TranscriptWord, Utterance } from './types';

/** Rolling transcript fed by any speech source. Emits finalized utterances. */
export class Transcript {
  private turns: Utterance[] = [];
  private listeners = new Set<(u: Utterance) => void>();
  constructor(private readonly keep = 8) {}

  onUtterance(fn: (u: Utterance) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** words may be empty when the source only gives turn-level timing (then wordTimesExact is false). */
  finalize(text: string, start: number, end: number, words: TranscriptWord[] = []): Utterance {
    const exact = words.length > 0;
    const u: Utterance = {
      text: text.trim(), start, end, wordTimesExact: exact,
      words: exact ? words : text.trim().split(/\s+/).filter(Boolean).map((w, i, a) => {
        const span = (end - start) / Math.max(1, a.length);
        return { text: w, start: start + i * span, end: start + (i + 1) * span };
      }),
    };
    if (!u.text) return u;
    this.turns.push(u);
    if (this.turns.length > this.keep) this.turns.shift();
    this.listeners.forEach(fn => fn(u));
    return u;
  }

  recent(n = 4): Utterance[] { return this.turns.slice(-n); }
  clear() { this.turns = []; }
}

interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

/**
 * Browser speech adapter (Web Speech API): turn-level timing only, so word times are interpolated.
 * Stand-in until streaming STT (Cartesia Ink) is confirmed to return word timestamps. [VERIFY]
 */
export function startBrowserSpeech(transcript: Transcript, clock: () => number, lang = 'en-US', onError?: (m: string) => void): (() => void) | null {
  const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike });
  const SR = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang; rec.continuous = true; rec.interimResults = true;
  let stopped = false;
  let turnStart = clock();
  rec.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) { const now = clock(); transcript.finalize(r[0].transcript, turnStart, now); turnStart = now; }
    }
  };
  rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') onError?.(e.error); };
  rec.onend = () => { if (!stopped) { turnStart = clock(); try { rec.start(); } catch { /* already started */ } } };
  rec.start();
  return () => { stopped = true; rec.stop(); };
}
