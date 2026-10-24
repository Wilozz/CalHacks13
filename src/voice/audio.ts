/** Linear-interpolation resampler that keeps its place between chunks, so frame size does not matter. */
export class Resampler {
  private pos = 0;          // position of the next output sample, in input-sample units, relative to the chunk start
  private last = 0;         // last input sample of the previous chunk
  private hasLast = false;
  constructor(private readonly inRate: number, private readonly outRate = 16000) {}

  process(input: Float32Array): Float32Array {
    if (!input.length) return new Float32Array(0);
    const step = this.inRate / this.outRate;
    const out: number[] = [];
    // Index -1 is the previous chunk's last sample, so interpolation is continuous across chunk edges.
    const at = (i: number) => (i < 0 ? (this.hasLast ? this.last : input[0]) : input[i]);
    while (this.pos < input.length - 1 + 1e-9 && Math.floor(this.pos) + 1 <= input.length - 1) {
      const i = Math.floor(this.pos), f = this.pos - i;
      out.push(at(i) * (1 - f) + at(i + 1) * f);
      this.pos += step;
    }
    this.pos -= input.length;
    this.last = input[input.length - 1]; this.hasLast = true;
    return Float32Array.from(out);
  }
}

export function floatToPcm16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return out;
}

export function rms(f: Float32Array): number {
  if (!f.length) return 0;
  let sum = 0;
  for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
  return Math.sqrt(sum / f.length);
}

// Forwards raw microphone samples to the main thread in ~40 ms batches.
const WORKLET = `class GhostCapture extends AudioWorkletProcessor{constructor(){super();this.buf=new Float32Array(2048);this.n=0;}process(inputs){const ch=inputs[0]&&inputs[0][0];if(!ch)return true;for(let i=0;i<ch.length;i++){this.buf[this.n++]=ch[i];if(this.n===this.buf.length){this.port.postMessage(this.buf.slice(0));this.n=0;}}return true;}}registerProcessor('ghost-capture',GhostCapture);`;

export type MicCapture = (stream: MediaStream, onFrame: (samples: Float32Array, sampleRate: number) => void) => Promise<() => void>;

/** Streams a MediaStream's audio as Float32 frames. Returns a stop function. */
export const startMicCapture: MicCapture = async (stream, onFrame) => {
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'ghost-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  node.port.onmessage = e => onFrame(e.data as Float32Array, ctx.sampleRate);
  // Browsers only run audio nodes that lead to the output, so end the chain in a muted gain: no echo, but it keeps running.
  const mute = ctx.createGain(); mute.gain.value = 0;
  source.connect(node); node.connect(mute); mute.connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  return () => { node.port.onmessage = null; try { source.disconnect(); node.disconnect(); mute.disconnect(); } catch { /* already gone */ } void ctx.close(); };
};
