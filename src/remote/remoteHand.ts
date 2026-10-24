import type { HandFrame } from '../coordinates';
import { decodeHand, encodeHand } from './handWire';

/** Anything that can carry hand frames to the other caller. */
export interface HandChannel {
  /** null means "no hand in view": the peer hides the overlay immediately instead of waiting to go stale. */
  send(hand: HandFrame | null, slot?: 0 | 1): void;
  onMessage(cb: (buf: ArrayBuffer) => void): void;
  close(): void;
}

const newer = (a: number, b: number) => { const d = (a - b + 65536) % 65536; return d > 0 && d < 32768; };

/** Receiver side: ignores out-of-order packets, reports staleness, counts loss. */
export class RemoteHandState {
  private frames: [HandFrame | null, HandFrame | null] = [null, null]; // one per hand: slot 0 and slot 1
  private lastSeq: number | null = null;
  private receivedAts: [number, number] = [0, 0];
  private receivedAt = 0;
  private bytes = 0;
  private window: { t: number; bytes: number }[] = [];
  received = 0; reordered = 0; lost = 0; malformed = 0;

  constructor(readonly staleMs = 350) {}

  accept(buf: ArrayBuffer, now: number): boolean {
    const msg = decodeHand(buf, now);
    if (!msg) { this.malformed++; return false; }
    if (this.lastSeq !== null) {
      if (!newer(msg.seq, this.lastSeq)) { this.reordered++; return false; }
      this.lost += (msg.seq - this.lastSeq - 1 + 65536) % 65536;
    }
    this.lastSeq = msg.seq;
    this.frames[msg.slot] = msg.hand; this.receivedAts[msg.slot] = now; this.receivedAt = now; this.received++;
    this.bytes += buf.byteLength;
    this.window.push({ t: now, bytes: buf.byteLength });
    while (this.window.length && now - this.window[0].t > 1000) this.window.shift();
    return true;
  }

  /** The latest hand in a slot (0 = the sender's first hand, 1 = the second), or null if none, cleared by the sender, or older than staleMs. */
  current(now: number, slot: 0 | 1 = 0): HandFrame | null {
    const f = this.frames[slot];
    return f && now - this.receivedAts[slot] <= this.staleMs ? f : null;
  }
  ageMs(now: number) { return this.received ? now - this.receivedAt : null; }
  /** Messages and bytes in the last second. */
  rate(now: number) {
    const w = this.window.filter(x => now - x.t <= 1000);
    return { msgsPerSec: w.length, kbps: (w.reduce((a, x) => a + x.bytes, 0) * 8) / 1000 };
  }
  reset() { this.frames = [null, null]; this.lastSeq = null; this.window = []; }
}

/**
 * Solo demo: the local hand goes through the real encoder and decoder, with optional added latency,
 * jitter and loss, so the overlay is exercised exactly as it would be by a remote helper.
 */
export class LoopbackChannel implements HandChannel {
  latencyMs = 0; jitterMs = 0; lossPct = 0;
  private seq = 0;
  private cb: ((buf: ArrayBuffer) => void) | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(private readonly rand: () => number = Math.random, private readonly now: () => number = () => performance.now()) {}
  onMessage(cb: (buf: ArrayBuffer) => void) { this.cb = cb; }
  send(hand: HandFrame | null, slot: 0 | 1 = 0) {
    const buf = encodeHand(this.seq++ & 0xffff, this.now(), hand, slot);
    if (this.rand() * 100 < this.lossPct) return;
    const delay = this.latencyMs + this.rand() * this.jitterMs;
    if (delay <= 0) { this.cb?.(buf); return; }
    const t = setTimeout(() => { this.timers.delete(t); this.cb?.(buf); }, delay);
    this.timers.add(t);
  }
  close() { this.timers.forEach(clearTimeout); this.timers.clear(); this.cb = null; }
}

/** Real transport: pass a data channel created with createHandDataChannel on one side, received via ondatachannel on the other. */
export class RtcHandChannel implements HandChannel {
  private seq = 0;
  constructor(private readonly dc: RTCDataChannel, private readonly now: () => number = () => performance.now()) { dc.binaryType = 'arraybuffer'; }
  onMessage(cb: (buf: ArrayBuffer) => void) { this.dc.onmessage = e => { if (e.data instanceof ArrayBuffer) cb(e.data); }; }
  send(hand: HandFrame | null, slot: 0 | 1 = 0) {
    // Drop rather than queue: a late hand is worse than a missing one.
    if (this.dc.readyState !== 'open' || this.dc.bufferedAmount > 16_384) return;
    this.dc.send(encodeHand(this.seq++ & 0xffff, this.now(), hand, slot));
  }
  close() { this.dc.onmessage = null; }
}
export const createHandDataChannel = (pc: RTCPeerConnection) => pc.createDataChannel('hand', { ordered: false, maxRetransmits: 0 });
