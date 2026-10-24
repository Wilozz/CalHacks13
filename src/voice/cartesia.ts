import type { VoiceToken } from '../ai/client';
import { floatToPcm16, Resampler, rms, startMicCapture, type MicCapture } from './audio';
import { EndpointDetector } from './vad';

export interface SttWord { text: string; start: number; end: number }
export interface HeardUtterance { text: string; words: SttWord[]; start: number; end: number }

export type ServerMessage =
  | { kind: 'transcript'; isFinal: boolean; text: string; words: SttWord[]; duration: number | null }
  | { kind: 'flush_done' } | { kind: 'done' }
  | { kind: 'error'; status: number; message: string };

/** Parses a Cartesia STT server message. Anything unrecognized or malformed is ignored, never thrown. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string' || raw.length > 100_000) return null;
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  if (m.type === 'transcript' && typeof m.text === 'string') {
    const words: SttWord[] = (Array.isArray(m.words) ? m.words : []).flatMap((w: any) =>
      typeof w?.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end) ? [{ text: w.word, start: Number(w.start), end: Number(w.end) }] : []);
    return { kind: 'transcript', isFinal: m.is_final === true, text: m.text, words, duration: Number.isFinite(m.duration) ? Number(m.duration) : null };
  }
  if (m.type === 'flush_done') return { kind: 'flush_done' };
  if (m.type === 'done') return { kind: 'done' };
  if (m.type === 'error') return { kind: 'error', status: Number(m.status_code) || 0, message: String(m.message ?? m.title ?? 'Speech service error').slice(0, 200) };
  return null;
}

/**
 * Cartesia sends text as deltas: the transcript is the concatenation of the chunks marked final, with
 * whitespace untouched. A non-final chunk is the live guess for what is still being said.
 */
export class UtteranceAssembler {
  private finals = '';
  private interim = '';
  private words: SttWord[] = [];
  private lastWordEnd = 0;

  add(m: Extract<ServerMessage, { kind: 'transcript' }>) {
    if (m.isFinal) { this.finals += m.text; this.interim = ''; this.words.push(...m.words); if (m.words.length) this.lastWordEnd = m.words[m.words.length - 1].end; }
    else this.interim = m.text;
  }
  /** What to show while the person is still talking. */
  get partial() { return (this.finals + this.interim).trim(); }
  get hasFinal() { return this.finals.trim().length > 0; }

  flush(): HeardUtterance | null {
    const text = (this.finals + (this.finals ? '' : this.interim)).trim();
    const words = this.words, end = this.lastWordEnd;
    this.finals = ''; this.interim = ''; this.words = []; this.lastWordEnd = 0;
    if (!text) return null;
    return { text, words, start: words[0]?.start ?? 0, end: end || (words[0]?.start ?? 0) };
  }
}

export type ListenState = 'connecting' | 'listening' | 'unavailable' | 'error' | 'stopped';

export interface SocketLike {
  readyState: number; binaryType: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void; close(): void;
  onopen: ((e: any) => void) | null; onmessage: ((e: { data: any }) => void) | null; onclose: ((e: any) => void) | null; onerror: ((e: any) => void) | null;
}

export interface ListenerOptions {
  getToken: () => Promise<VoiceToken>;
  onPartial: (text: string) => void;
  onUtterance: (u: HeardUtterance) => void;
  onState: (state: ListenState, detail?: string) => void;
  language?: string;
  socket?: (url: string) => SocketLike;
  capture?: MicCapture;
  now?: () => number;
}

const OPEN = 1;
const CHUNK = 1600;          // 100 ms at 16 kHz
const PREROLL_MS = 300;      // audio kept from just before speech starts, so first words are not clipped
const KEEPALIVE_MS = 4000;
const FLUSH_TIMEOUT_MS = 1500;
const IDLE_FLUSH_MS = 2500;

/**
 * Streams the microphone to Cartesia's speech-to-text WebSocket and turns the replies into utterances.
 * Audio is only sent around speech (a detector gates it), which keeps transcription cost down; a tiny
 * silent chunk keeps the connection alive in between. The API key never reaches the browser: a short-lived
 * token comes from our server.
 */
export class CartesiaListener {
  private socket: SocketLike | null = null;
  private stopCapture: (() => void) | null = null;
  private stopped = true;
  private assembler = new UtteranceAssembler();
  private vad = new EndpointDetector();
  private resampler: Resampler | null = null;
  private pending: number[] = [];
  private preroll: Int16Array[] = [];
  private streaming = false;
  private lastSent = 0;
  private lastChunkAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setInterval> | undefined;
  private retry = 0;
  private stream: MediaStream | null = null;
  private generation = 0;
  private readonly now: () => number;
  constructor(private readonly o: ListenerOptions) { this.now = o.now ?? (() => performance.now()); }

  async start(stream: MediaStream) {
    this.stop();
    this.stopped = false; this.stream = stream;
    const gen = ++this.generation;
    this.o.onState('connecting');
    try {
      this.stopCapture = await (this.o.capture ?? startMicCapture)(stream, (f, rate) => this.onFrame(f, rate));
      if (gen !== this.generation) { this.stopCapture?.(); return; }
      await this.connect(gen);
    } catch (e) { if (gen === this.generation) this.o.onState('error', e instanceof Error ? e.message : String(e)); }
  }

  stop() {
    this.stopped = true; this.generation++;
    clearTimeout(this.flushTimer); clearInterval(this.idleTimer); this.idleTimer = undefined;
    this.stopCapture?.(); this.stopCapture = null;
    const s = this.socket; this.socket = null;
    if (s) { s.onclose = s.onerror = s.onmessage = s.onopen = null; try { if (s.readyState === OPEN) { s.send('close'); } s.close(); } catch { /* already closed */ } }
    this.assembler = new UtteranceAssembler(); this.pending = []; this.preroll = []; this.streaming = false; this.resampler = null; this.vad = new EndpointDetector();
    this.o.onState('stopped');
  }

  private async connect(gen: number) {
    let t: VoiceToken;
    try { t = await this.o.getToken(); }
    catch (e) {
      if (gen !== this.generation) return;
      const msg = e instanceof Error ? e.message : String(e);
      this.o.onState(/503|not set|not configured/i.test(msg) ? 'unavailable' : 'error', msg);
      return;
    }
    if (gen !== this.generation) return;
    const q = new URLSearchParams({ model: t.model, encoding: 'pcm_s16le', sample_rate: '16000', cartesia_version: t.version, language: this.o.language ?? 'en', access_token: t.token });
    const url = `wss://api.cartesia.ai/stt/websocket?${q}`;
    const s = this.o.socket ? this.o.socket(url) : (new WebSocket(url) as unknown as SocketLike);
    s.binaryType = 'arraybuffer';
    this.socket = s;
    s.onopen = () => { this.retry = 0; this.o.onState('listening'); };
    s.onmessage = e => this.onMessage(e.data);
    s.onerror = () => { /* onclose follows */ };
    s.onclose = () => {
      if (this.stopped || gen !== this.generation) return;
      this.socket = null;
      const delay = Math.min(10_000, 1000 * 2 ** this.retry++);
      this.o.onState('connecting', 'reconnecting');
      setTimeout(() => { if (!this.stopped && gen === this.generation) void this.connect(gen); }, delay);
    };
  }

  private onFrame(samples: Float32Array, rate: number) {
    const t = this.now();
    const ev = this.vad.push(rms(samples), t);
    this.resampler ??= new Resampler(rate);
    const pcm = floatToPcm16(this.resampler.process(samples));
    for (const v of pcm) this.pending.push(v);
    while (this.pending.length >= CHUNK) {
      const chunk = Int16Array.from(this.pending.splice(0, CHUNK));
      this.onChunk(chunk, t, ev);
    }
    if (ev === 'end') this.finalize();
  }

  private onChunk(chunk: Int16Array, t: number, ev: 'start' | 'end' | null) {
    const s = this.socket;
    const speaking = this.vad.speaking || ev === 'end';
    if (!speaking && !this.streaming) {
      // Not talking: remember a little audio, and send a silent chunk now and then so the socket stays open.
      this.preroll.push(chunk); while (this.preroll.length > PREROLL_MS / 100) this.preroll.shift();
      if (s?.readyState === OPEN && t - this.lastSent > KEEPALIVE_MS) { s.send(new Int16Array(CHUNK).buffer); this.lastSent = t; }
      return;
    }
    if (!this.streaming) { this.streaming = true; this.flushPreroll(); }
    if (s?.readyState === OPEN) { s.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)); this.lastSent = t; }
    if (!this.vad.speaking) this.streaming = false;
  }

  private flushPreroll() {
    const s = this.socket;
    for (const c of this.preroll) if (s?.readyState === OPEN) s.send(c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength));
    this.preroll = [];
  }

  private finalize() {
    const s = this.socket;
    if (s?.readyState === OPEN) s.send('finalize');
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.emit(), FLUSH_TIMEOUT_MS); // in case flush_done never comes
  }

  private onMessage(raw: unknown) {
    const m = parseServerMessage(raw);
    if (!m) return;
    if (m.kind === 'transcript') {
      this.assembler.add(m); this.lastChunkAt = this.now(); this.o.onPartial(this.assembler.partial);
      this.idleTimer ??= setInterval(() => this.idleCheck(), 500); // only while there is something to flush
    }
    else if (m.kind === 'flush_done') { clearTimeout(this.flushTimer); this.emit(); }
    else if (m.kind === 'error') this.o.onState('error', m.message);
  }

  private emit() {
    const u = this.assembler.flush();
    this.o.onPartial('');
    if (u) this.o.onUtterance(u);
  }

  /** If the service finalized on its own and we never saw a clean end of speech, do not hold the words forever. */
  private idleCheck() {
    if (this.assembler.hasFinal && !this.vad.speaking && this.now() - this.lastChunkAt > IDLE_FLUSH_MS) this.emit();
  }
}
