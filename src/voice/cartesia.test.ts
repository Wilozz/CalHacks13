import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CartesiaListener, parseServerMessage, UtteranceAssembler, type HeardUtterance, type ListenState, type SocketLike } from './cartesia';

const tr = (text: string, is_final: boolean, words?: any[]) => JSON.stringify({ type: 'transcript', is_final, text, request_id: 'r', words });

test('server messages are parsed, and junk is ignored', () => {
  const m = parseServerMessage(tr(' hello', true, [{ word: 'hello', start: 0.1, end: 0.4 }, { word: 7 }]))!;
  assert.equal(m.kind, 'transcript');
  if (m.kind === 'transcript') { assert.equal(m.isFinal, true); assert.equal(m.text, ' hello'); assert.deepEqual(m.words, [{ text: 'hello', start: 0.1, end: 0.4 }]); }
  assert.equal(parseServerMessage(JSON.stringify({ type: 'flush_done', request_id: 'r' }))!.kind, 'flush_done');
  assert.equal(parseServerMessage(JSON.stringify({ type: 'error', status_code: 401, message: 'bad token' }))!.kind, 'error');
  for (const junk of ['nope', '{}', JSON.stringify({ type: 'mystery' }), JSON.stringify({ type: 'transcript' }), 42, null, 'x'.repeat(200_000)]) assert.equal(parseServerMessage(junk), null);
});

test('deltas are concatenated untouched; interim text shows live but is not kept once final arrives', () => {
  const a = new UtteranceAssembler();
  const add = (text: string, isFinal: boolean, words: any[] = []) => a.add({ kind: 'transcript', isFinal, text, words, duration: null });
  add('so the cap', false); assert.equal(a.partial, 'so the cap');
  add('so the cap on', false); assert.equal(a.partial, 'so the cap on');
  add('so the cap on the', true, [{ text: 'cap', start: 0.2, end: 0.4 }]);
  add(' bottle is', false); assert.equal(a.partial, 'so the cap on the bottle is');
  add(' bottle is stuck', true, [{ text: 'stuck', start: 0.9, end: 1.3 }]);
  const u = a.flush()!;
  assert.equal(u.text, 'so the cap on the bottle is stuck');
  assert.equal(u.words.length, 2); assert.equal(u.start, 0.2); assert.equal(u.end, 1.3);
  assert.equal(a.flush(), null); assert.equal(a.partial, '');
});

test('if only an interim guess exists when speech ends, it is still used', () => {
  const a = new UtteranceAssembler();
  a.add({ kind: 'transcript', isFinal: false, text: 'move it left', words: [], duration: null });
  assert.equal(a.flush()!.text, 'move it left');
});

// ---- the listener, against a fake socket and a fake microphone ----
class FakeSocket implements SocketLike {
  readyState = 0; binaryType = ''; sent: (string | ArrayBuffer)[] = [];
  onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
  send(d: any) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({}); }
  reply(s: string) { this.onmessage?.({ data: s }); }
}

function harness() {
  let t = 0; const states: ListenState[] = []; const heard: HeardUtterance[] = []; const partials: string[] = []; let feed: (f: Float32Array, rate: number) => void = () => {};
  let sock!: FakeSocket; let url = '';
  const l = new CartesiaListener({
    getToken: async () => ({ token: 'tok123', model: 'ink-whisper', version: '2026-08-14', expiresIn: 600 }),
    onPartial: p => partials.push(p), onUtterance: u => heard.push(u), onState: s => states.push(s),
    socket: u => { url = u; sock = new FakeSocket(); return sock; },
    capture: async (_s, onFrame) => { feed = onFrame; return () => {}; },
    now: () => t,
  });
  const frame = (amp: number) => Float32Array.from({ length: 2048 }, (_, i) => amp * Math.sin(i / 3));
  const run = (ms: number, amp: number) => { for (let n = 0; n < ms / 128; n++) { t += 128; feed(frame(amp), 16000); } }; // 2048 samples @16k = 128 ms
  return { l, states, heard, partials, run, sock: () => sock, url: () => url, advance: (ms: number) => { t += ms; } };
}

test('connects with a token (never the API key), streams speech, finalizes at the end, and emits the utterance', async () => {
  const h = harness();
  await h.l.start({} as MediaStream);
  const u = new URL(h.url());
  assert.equal(u.origin + u.pathname, 'wss://api.cartesia.ai/stt/websocket');
  assert.equal(u.searchParams.get('access_token'), 'tok123');
  assert.equal(u.searchParams.get('encoding'), 'pcm_s16le'); assert.equal(u.searchParams.get('sample_rate'), '16000'); assert.equal(u.searchParams.get('cartesia_version'), '2026-08-14');
  const s = h.sock(); s.open();
  assert.ok(h.states.includes('listening'));

  h.run(1200, 0.003);                       // quiet: nothing but keepalive silence goes out
  const quiet = s.sent.filter(x => typeof x !== 'string').length;
  h.run(1500, 0.2);                         // talking
  const binaries = s.sent.filter(x => typeof x !== 'string') as ArrayBuffer[];
  assert.ok(binaries.length - quiet >= 10, 'audio is streamed while speaking');
  assert.ok(binaries.every(b => b.byteLength === 3200), '100 ms of 16-bit audio per frame');
  h.run(1500, 0.003);                       // silence: end of speech
  assert.ok(s.sent.includes('finalize'));

  s.reply(tr('the cap is stuck', true, [{ word: 'cap', start: 0.2, end: 0.4 }]));
  assert.equal(h.heard.length, 0);          // not until the service confirms
  s.reply(JSON.stringify({ type: 'flush_done', request_id: 'r' }));
  assert.equal(h.heard.length, 1); assert.equal(h.heard[0].text, 'the cap is stuck');
  assert.equal(h.partials.at(-1), '');
  h.l.stop();
});

test('little audio is sent during silence (cost), and the start of a sentence is not clipped', async () => {
  const h = harness(); await h.l.start({} as MediaStream); h.sock().open();
  h.run(10_000, 0.003);
  const silent = h.sock().sent.filter(x => typeof x !== 'string').length;
  assert.ok(silent <= 4, `only keepalive chunks while quiet, got ${silent}`);
  const before = h.sock().sent.length; h.run(400, 0.25);
  assert.ok(h.sock().sent.length - before >= 5, 'pre-roll plus live audio');
  h.l.stop();
});

test('unavailable token endpoint is reported as unavailable (so the app can fall back); other failures are errors', async () => {
  const states: [string, string?][] = [];
  const mk = (err: string) => new CartesiaListener({ getToken: async () => { throw new Error(err); }, onPartial() {}, onUtterance() {}, onState: (s, d) => states.push([s, d]), capture: async () => () => {}, socket: () => new FakeSocket() });
  const a = mk('AI server /voice-token failed: 503 CARTESIA_API_KEY is not set'), b = mk('network down');
  await a.start({} as MediaStream); await b.start({} as MediaStream); a.stop(); b.stop();
  assert.ok(states.some(([s]) => s === 'unavailable')); assert.ok(states.some(([s]) => s === 'error'));
});

test('stopping closes the socket politely and ignores late messages', async () => {
  const h = harness(); await h.l.start({} as MediaStream); const s = h.sock(); s.open();
  h.l.stop();
  assert.ok(s.sent.includes('close')); assert.equal(s.readyState, 3);
  s.reply(tr('late', true)); s.reply(JSON.stringify({ type: 'flush_done' }));
  assert.equal(h.heard.length, 0); assert.equal(h.states.at(-1), 'stopped');
});
