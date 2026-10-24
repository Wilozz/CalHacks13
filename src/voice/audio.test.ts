import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floatToPcm16, Resampler, rms } from './audio';
import { EndpointDetector } from './vad';

const sine = (hz: number, rate: number, secs: number, amp = 0.5) => Float32Array.from({ length: Math.round(rate * secs) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const zeroCrossings = (f: Float32Array) => { let n = 0; for (let i = 1; i < f.length; i++) if (f[i - 1] < 0 && f[i] >= 0) n++; return n; };

test('48 kHz becomes 16 kHz with the pitch preserved', () => {
  const out = new Resampler(48000).process(sine(440, 48000, 1));
  assert.ok(Math.abs(out.length - 16000) <= 2);
  assert.ok(Math.abs(zeroCrossings(out) - 440) <= 2);
  assert.ok(Math.abs(rms(out) - 0.5 / Math.SQRT2) < 0.02);
});

test('chunk size does not change the result (state is kept between chunks)', () => {
  const input = sine(300, 44100, 0.5);
  const whole = new Resampler(44100).process(input);
  const r = new Resampler(44100); const parts: number[] = [];
  for (let i = 0; i < input.length; i += 733) parts.push(...r.process(input.subarray(i, i + 733)));
  assert.ok(Math.abs(parts.length - whole.length) <= 1);
  for (let i = 0; i < Math.min(parts.length, whole.length) - 2; i++) assert.ok(Math.abs(parts[i] - whole[i]) < 1e-3, `sample ${i}`);
});

test('16 kHz input passes through unchanged and PCM conversion clips', () => {
  const x = sine(200, 16000, 0.1);
  const y = new Resampler(16000).process(x);
  assert.ok(Math.abs(y.length - x.length) <= 1);
  const pcm = floatToPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
  assert.deepEqual(Array.from(pcm), [0, 32767, -32768, 32767, -32768, 16383]);
});

test('speech then silence ends after the hang time; clicks and quiet noise are ignored', () => {
  const v = new EndpointDetector();
  const events: string[] = [];
  const run = (level: number, from: number, to: number) => { for (let t = from; t < to; t += 40) { const e = v.push(level, t); if (e) events.push(`${e}@${t}`); } };
  run(0.003, 0, 400);          // room noise
  run(0.1, 400, 1600);         // speech
  run(0.003, 1600, 3000);      // silence
  assert.equal(events[0], 'start@400');
  assert.ok(events[1].startsWith('end@') && Number(events[1].slice(4)) >= 1560 + 700, events.join()); // last loud frame is at 1560
  const click = new EndpointDetector(); const ev: string[] = [];
  for (let t = 0; t < 2000; t += 40) { const e = click.push(t === 400 ? 0.2 : 0.003, t); if (e) ev.push(e); }
  assert.deepEqual(ev, ['start']); // a single loud frame starts, but is too short to be an utterance
});

test('a noisy room raises the threshold so the noise itself is not speech', () => {
  const v = new EndpointDetector(); let started = 0;
  for (let t = 0; t < 5000; t += 40) if (v.push(0.02 + (t % 80 ? 0.004 : 0), t) === 'start') started++;
  assert.ok(started <= 1);
  assert.ok(v.threshold >= 0.012);
});
