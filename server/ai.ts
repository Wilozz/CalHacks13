import Anthropic from '@anthropic-ai/sdk';
import { fal } from '@fal-ai/client';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { ACTION_TOOLS, isActionType, sanitizeSpec } from '../src/ai/actionLibrary';
import { boxPrompt, encodeMesh, MESH_KEY, orient, readGlb, samYaw, simplify, type Quat } from '../src/ai/mesh';
import { sanitizeModel } from '../src/ai/modelSpec';
import { ACTION_PARSER_SYSTEM, CONTEXT_SUMMARIZER_SYSTEM, FOCUS_SYSTEM, SCENE_SYSTEM } from '../src/ai/prompts';
import type { ContextState, ParseRequest, ParseResult, SceneObject } from '../src/ai/types';

try { process.loadEnvFile('.env'); } catch { /* no .env: rely on the environment */ }

// Fast model for the latency-critical parse; stronger model for vision. Override via env.
const PARSE_MODEL = process.env.GHOST_PARSE_MODEL ?? 'claude-haiku-5-5';
const CONTEXT_MODEL = process.env.GHOST_CONTEXT_MODEL ?? 'claude-haiku-5-5';
const SCENE_MODEL = process.env.GHOST_SCENE_MODEL ?? 'claude-sonnet-5-5';
const FOCUS_MODEL = process.env.GHOST_FOCUS_MODEL ?? PARSE_MODEL;
const CARTESIA_KEY = process.env.CARTESIA_API_KEY;
const CARTESIA_VERSION = '2026-08-14';
const STT_MODEL = process.env.GHOST_STT_MODEL ?? 'ink-whisper';
const PORT = Number(process.env.GHOST_AI_PORT ?? 8790);
const MAX_BODY = 4_000_000;

if (!process.env.ANTHROPIC_API_KEY) console.warn('ANTHROPIC_API_KEY is not set: AI endpoints will return 503 and the client will use its offline fallback.');
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// Some models reject a forced tool_choice. Remember that per model and fall back to "auto" plus an instruction.
const noForcedTools = new Set<string>();

async function toolCall(model: string, system: string, tools: any[], content: any, maxTokens = 600) {
  const create = (forced: boolean) => anthropic!.messages.create({
    model, max_tokens: maxTokens, tools,
    system: forced ? system : `${system}\nYou must answer by calling one of the provided tools. Do not reply with plain text.`,
    tool_choice: forced ? { type: 'any' } : { type: 'auto' },
    messages: [{ role: 'user', content }],
  });
  let msg;
  try { msg = await create(!noForcedTools.has(model)); }
  catch (e: any) {
    if (e?.status !== 400 || !/tool_choice/.test(String(e?.message)) || noForcedTools.has(model)) throw e;
    noForcedTools.add(model);
    msg = await create(false);
  }
  const block = msg.content.find(b => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('model returned no tool call');
  return { name: block.name, input: block.input as Record<string, any> };
}

async function parse(req: ParseRequest): Promise<ParseResult> {
  const payload = {
    viewerLanguage: req.viewerLanguage,
    utterance: { text: req.utterance.text, wordTimesExact: req.utterance.wordTimesExact, words: req.utterance.words },
    candidates: req.candidates.map(c => ({ objectId: c.object.objectId, label: c.object.label, parentLabel: c.object.parentLabel, affordances: c.object.affordances, distanceFromFingertip: +c.distance.toFixed(3), fingertipInsideObject: c.inside })),
    handMotion: req.motion,
    context: req.context,
  };
  const { name, input } = await toolCall(PARSE_MODEL, ACTION_PARSER_SYSTEM, [...ACTION_TOOLS], JSON.stringify(payload));
  if (name === 'ask_clarification') {
    const options = (Array.isArray(input.options) ? input.options : []).slice(0, 2).map((o: any) => ({
      label: String(o?.label ?? '').slice(0, 80),
      objectId: typeof o?.objectId === 'string' ? o.objectId : null,
      ...(isActionType(o?.actionType) ? { actionType: o.actionType } : {}),
    }));
    return { kind: 'clarify', clarification: { question: String(input.question ?? '').slice(0, 200), options } };
  }
  const spec = sanitizeSpec({ ...input, targetPoint2d: req.motion.fingertip }, req.viewerLanguage);
  if (!spec) throw new Error('model returned an invalid action');
  return { kind: 'action', spec };
}

const CONTEXT_TOOL = {
  name: 'update_context', description: 'Return the updated running summary.',
  input_schema: { type: 'object', properties: {
    taskSummary: { type: 'string' }, mentionedObjects: { type: 'array', items: { type: 'string' } },
    currentStep: { type: 'string' }, language: { type: 'string', description: 'BCP-47 of the viewer' },
  }, required: ['taskSummary', 'mentionedObjects', 'currentStep', 'language'] },
};

async function context(body: { previous: ContextState | null; turns: { text: string }[]; objects: SceneObject[]; viewerLanguage: string }): Promise<ContextState> {
  const { input } = await toolCall(CONTEXT_MODEL, CONTEXT_SUMMARIZER_SYSTEM, [CONTEXT_TOOL], JSON.stringify({
    previous: body.previous, turns: body.turns.map(t => t.text), visibleObjects: body.objects.map(o => o.label), viewerLanguage: body.viewerLanguage,
  }), 400);
  return {
    taskSummary: String(input.taskSummary ?? '').slice(0, 160),
    mentionedObjects: (Array.isArray(input.mentionedObjects) ? input.mentionedObjects : []).map(String).slice(0, 12),
    currentStep: String(input.currentStep ?? '').slice(0, 120),
    language: String(input.language ?? body.viewerLanguage),
    updatedAt: Date.now() / 1000,
  };
}

const SCENE_TOOL = {
  name: 'report_scene', description: 'Report the objects visible in the frame.',
  input_schema: { type: 'object', properties: { objects: { type: 'array', items: { type: 'object', properties: {
    objectId: { type: 'string' }, label: { type: 'string' }, parentLabel: { type: 'string' },
    bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
    affordances: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' },
    model: { type: 'object', properties: {
      parts: { type: 'array', maxItems: 6, items: { type: 'object', properties: {
        shape: { type: 'string', enum: ['cylinder', 'box', 'sphere', 'cone'] },
        size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        color: { type: 'string', description: '#rrggbb' }, moving: { type: 'boolean' }, name: { type: 'string', description: 'short name of a moving part, e.g. cap' },
      }, required: ['shape', 'size', 'position', 'color', 'moving'] } },
      pivot: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    }, required: ['parts'] },
  }, required: ['objectId', 'label', 'bbox', 'affordances', 'confidence'] } } }, required: ['objects'] },
};

async function scene(body: { imageBase64: string; mediaType: 'image/jpeg' | 'image/png'; now: number; prior: SceneObject[] }): Promise<SceneObject[]> {
  if (!['image/jpeg', 'image/png'].includes(body.mediaType)) throw new Error('unsupported image type');
  const { input } = await toolCall(SCENE_MODEL, SCENE_SYSTEM, [SCENE_TOOL], [
    { type: 'image', source: { type: 'base64', media_type: body.mediaType, data: body.imageBase64 } },
    { type: 'text', text: `Prior objects: ${JSON.stringify(body.prior.map(o => ({ objectId: o.objectId, label: o.label, bbox: o.bbox })))}` },
  ], 4000);
  const clamp01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
  return (Array.isArray(input.objects) ? input.objects : []).flatMap((o: any): SceneObject[] => {
    if (typeof o?.objectId !== 'string' || !Array.isArray(o.bbox) || o.bbox.length !== 4) return [];
    const [x0, y0, x1, y1] = o.bbox.map(clamp01);
    if (x1 <= x0 || y1 <= y0) return [];
    return [{
      objectId: o.objectId.slice(0, 40), label: String(o.label ?? 'object').slice(0, 60),
      parentLabel: typeof o.parentLabel === 'string' ? o.parentLabel.slice(0, 60) : undefined,
      bbox: [x0, y0, x1, y1], affordances: (Array.isArray(o.affordances) ? o.affordances : []).filter(isActionType),
      confidence: clamp01(o.confidence), seenAt: body.now, model: sanitizeModel(o.model) ?? undefined,
    }];
  });
}

const FOCUS_TOOL = {
  name: 'resolve_referent', description: 'Say which visible object the newest utterance is about.',
  input_schema: { type: 'object', properties: {
    objectId: { type: ['string', 'null'], description: 'an id from the visible objects, or null' },
    confidence: { type: 'number' }, reason: { type: 'string' }, topic: { type: 'string' },
  }, required: ['objectId', 'confidence', 'reason', 'topic'] },
};

interface FocusBody { speaker: string; utterance: string; recent: { speaker: string; text: string }[]; summary: string | null; objects: { objectId: string; label: string }[]; focusId: string | null }

async function focus(body: FocusBody) {
  const objects = (Array.isArray(body.objects) ? body.objects : []).slice(0, 20).map(o => ({ objectId: String(o.objectId).slice(0, 40), label: String(o.label).slice(0, 60) }));
  const { input } = await toolCall(FOCUS_MODEL, FOCUS_SYSTEM, [FOCUS_TOOL], JSON.stringify({
    speaker: body.speaker, utterance: String(body.utterance ?? '').slice(0, 600),
    recent: (Array.isArray(body.recent) ? body.recent : []).slice(-12).map(t => ({ speaker: t.speaker, text: String(t.text).slice(0, 300) })),
    summary: body.summary, visibleObjects: objects, currentFocusId: body.focusId,
  }), 300);
  const id = typeof input.objectId === 'string' && objects.some(o => o.objectId === input.objectId) ? input.objectId : null;
  return { objectId: id, confidence: id ? Math.min(1, Math.max(0, Number(input.confidence) || 0)) : 0, reason: String(input.reason ?? '').slice(0, 200), topic: String(input.topic ?? '').slice(0, 120) };
}

/** Short-lived Cartesia token for the browser, so the real API key never leaves this server. */
async function voiceToken() {
  if (!CARTESIA_KEY) throw Object.assign(new Error('CARTESIA_API_KEY is not set'), { status: 503 });
  const res = await fetch('https://api.cartesia.ai/access-token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CARTESIA_KEY}`, 'Cartesia-Version': CARTESIA_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({ grants: { stt: true }, expires_in: 600 }),
  });
  if (!res.ok) throw Object.assign(new Error(`Cartesia token request failed: ${res.status}`), { status: 502 });
  const data = await res.json() as { token?: string };
  if (!data.token) throw Object.assign(new Error('Cartesia returned no token'), { status: 502 });
  return { token: data.token, model: STT_MODEL, version: CARTESIA_VERSION, expiresIn: 600 };
}

// ---- SAM 3D meshes (fal.ai), cached on disk by object name so a good one is never made twice ----
const FAL_KEY = process.env.FAL_KEY;
if (FAL_KEY) fal.config({ credentials: FAL_KEY });
const SAM3D = 'fal-ai/sam-3/3d-objects';
const MESH_DIR = process.env.GHOST_MESH_CACHE ?? '.cache/meshes';
const MAX_GLB = 60_000_000;
interface MeshMeta { key: string; label: string; version: number; ms: number; triangles: number; sourceTriangles: number }
const meshJobs = new Map<string, { startedAt: number; error?: string }>();
const metaOf = (key: string): MeshMeta | null => { try { return JSON.parse(readFileSync(join(MESH_DIR, `${key}.json`), 'utf8')); } catch { return null; } };
const writeAtomic = (file: string, data: string | Uint8Array) => { writeFileSync(`${file}.tmp`, data); renameSync(`${file}.tmp`, file); };

/** What the cache has for an object, and whether one is being made. */
function meshStatus(key: string) {
  if (!FAL_KEY) throw Object.assign(new Error('FAL_KEY is not set'), { status: 503 });
  if (!MESH_KEY.test(key)) throw Object.assign(new Error('bad key'), { status: 400 });
  const job = meshJobs.get(key), meta = metaOf(key);
  return { key, running: !!job && !job.error, startedAt: job?.startedAt ?? null, error: job?.error ?? null, ready: meta };
}

interface MeshBody { key: string; label: string; imageBase64: string; mediaType: 'image/jpeg' | 'image/png'; width: number; height: number; bbox: [number, number, number, number]; force?: boolean }

/** Starts making a mesh (unless the cache has one and it was not asked to remake it). Returns at once; poll the status. */
async function startMesh(b: MeshBody) {
  const status = meshStatus(String(b?.key));
  if (status.running || (status.ready && !b.force)) return status;
  if (!['image/jpeg', 'image/png'].includes(b.mediaType) || typeof b.imageBase64 !== 'string') throw Object.assign(new Error('bad image'), { status: 400 });
  const w = Math.round(Number(b.width)), h = Math.round(Number(b.height));
  const box = Array.isArray(b.bbox) && b.bbox.length === 4 ? b.bbox.map(n => Math.min(1, Math.max(0, Number(n) || 0))) as MeshBody['bbox'] : null;
  if (!(w > 16 && h > 16 && w <= 4096 && h <= 4096) || !box || !(box[2] > box[0] && box[3] > box[1])) throw Object.assign(new Error('bad size or box'), { status: 400 });
  const key = status.key, label = String(b.label ?? key).slice(0, 60), startedAt = Date.now();
  meshJobs.set(key, { startedAt });
  void (async () => {
    try {
      const image_url = await fal.storage.upload(new Blob([Buffer.from(b.imageBase64, 'base64')], { type: b.mediaType }));
      const { data } = await fal.subscribe(SAM3D, { input: { image_url, prompt: label, box_prompts: [boxPrompt(box, w, h)], seed: 42 } }) as { data: any };
      const url = data?.model_glb?.url;
      if (typeof url !== 'string') throw new Error('SAM 3D returned no mesh');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`mesh download failed: ${res.status}`);
      const glb = new Uint8Array(await res.arrayBuffer());
      if (glb.byteLength > MAX_GLB) throw new Error('mesh too large');
      const raw = readGlb(glb), rot = data?.metadata?.[0]?.rotation?.[0];
      const mesh = orient(simplify(raw, 120), Array.isArray(rot) && rot.length === 4 ? samYaw(rot.map(Number) as Quat) : 0);
      mkdirSync(MESH_DIR, { recursive: true });
      writeAtomic(join(MESH_DIR, `${key}.glb`), glb);
      writeAtomic(join(MESH_DIR, `${key}.ghm`), encodeMesh(mesh));
      const meta: MeshMeta = { key, label, version: Date.now(), ms: Date.now() - startedAt, triangles: mesh.indices.length / 3, sourceTriangles: raw.indices.length / 3 };
      writeAtomic(join(MESH_DIR, `${key}.json`), JSON.stringify(meta));
      meshJobs.delete(key);
      console.log(`SAM 3D: ${key} in ${(meta.ms / 1000).toFixed(1)}s, ${meta.sourceTriangles} -> ${meta.triangles} triangles`);
    } catch (e: any) {
      const msg = String(e?.body?.detail ?? e?.message ?? e).slice(0, 200);
      console.error('SAM 3D', key, msg);
      meshJobs.set(key, { startedAt, error: msg });
    }
  })();
  return meshStatus(key);
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

const routes: Record<string, (b: any) => Promise<unknown>> = { '/parse': parse, '/context': context, '/scene': scene, '/focus': focus, '/voice-token': voiceToken, '/mesh': startMesh };
const NEEDS_CLAUDE = new Set(['/parse', '/context', '/scene', '/focus']);

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const [path, query = ''] = (req.url ?? '').replace(/^\/ai/, '').split('?');
  const handler = routes[path];
  if (req.method === 'GET' && path === '/health') return send(200, { ok: true, ai: !!anthropic, voice: !!CARTESIA_KEY, mesh: !!FAL_KEY });
  if (req.method === 'GET' && path === '/mesh') {
    try { return send(200, meshStatus(new URLSearchParams(query).get('key') ?? '')); } catch (e: any) { return send(e.status ?? 500, { error: e.message }); }
  }
  const file = req.method === 'GET' && /^\/mesh\/file\/([a-z0-9-]{1,40})$/.exec(path);
  if (file) {
    try { const body = readFileSync(join(MESH_DIR, `${file[1]}.ghm`)); res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-cache' }); return res.end(body); }
    catch { return send(404, { error: 'no mesh' }); }
  }
  if (req.method !== 'POST' || !handler) return send(404, { error: 'not found' });
  if (!anthropic && NEEDS_CLAUDE.has(path)) return send(503, { error: 'ANTHROPIC_API_KEY is not set' });
  try { send(200, await handler(await readJson(req))); }
  catch (e: any) { console.error(path, e?.message ?? e); send(e?.status && (e.status < 500 || e.status === 503) ? e.status : 502, { error: String(e?.message ?? e).slice(0, 200) }); }
}).listen(PORT, '127.0.0.1', () => console.log(`GHOST AI server on http://127.0.0.1:${PORT}`));
