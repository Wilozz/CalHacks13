export type VadEvent = 'start' | 'end' | null;

/**
 * Energy-based end-of-speech detector. It decides when to ask Cartesia to finalize and when to stop sending
 * audio (which saves transcription credits). The threshold follows the room's noise floor.
 */
export class EndpointDetector {
  speaking = false;
  floor: number;
  private speechSince = 0;
  private lastLoud = 0;
  constructor(private readonly opts = { minThreshold: 0.012, ratio: 3.5, hangMs: 700, minSpeechMs: 180 }) { this.floor = opts.minThreshold / opts.ratio; }

  get threshold() { return Math.max(this.opts.minThreshold, this.floor * this.opts.ratio); }

  push(level: number, tMs: number): VadEvent {
    const loud = level > this.threshold;
    if (!loud && !this.speaking) this.floor = this.floor * 0.97 + level * 0.03; // learn the quiet level only while quiet
    if (loud) {
      this.lastLoud = tMs;
      if (!this.speaking) { this.speaking = true; this.speechSince = tMs; return 'start'; }
      return null;
    }
    if (this.speaking && tMs - this.lastLoud >= this.opts.hangMs) {
      this.speaking = false;
      return tMs - this.speechSince - this.opts.hangMs >= this.opts.minSpeechMs ? 'end' : null; // a click is not an utterance
    }
    return null;
  }
}
