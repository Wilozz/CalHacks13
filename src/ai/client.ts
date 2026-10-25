import type { ContextState, ParseRequest, ParseResult, SceneObject, Utterance } from './types';

export interface FocusRequest { speaker: string; utterance: string; recent: { speaker: string; text: string }[]; summary: string | null; objects: { objectId: string; label: string }[]; focusId: string | null }
export interface FocusResult { objectId: string | null; confidence: number; reason: string; topic: string }
export interface VoiceToken { token: string; model: string; version: string; expiresIn: number }

export interface AiClient {
  resolveFocus(req: FocusRequest, signal?: AbortSignal): Promise<FocusResult>;
  voiceToken(signal?: AbortSignal): Promise<VoiceToken>;
  parseAction(req: ParseRequest, signal?: AbortSignal): Promise<ParseResult>;
  summarize(input: { previous: ContextState | null; turns: Utterance[]; objects: SceneObject[]; viewerLanguage: string }, signal?: AbortSignal): Promise<ContextState>;
  analyzeScene(input: { imageBase64: string; mediaType: 'image/jpeg' | 'image/png'; now: number; prior: SceneObject[] }, signal?: AbortSignal): Promise<SceneObject[]>;
  /** The call's quick check: is a lanyard in this frame, and where (normalized box)? */
  findLanyard(input: { imageBase64: string; mediaType: 'image/jpeg' | 'image/png' }, signal?: AbortSignal): Promise<{ found: boolean; bbox: [number, number, number, number] | null }>;
}

async function post<T>(base: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`AI server ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** Talks to server/ai.ts. The API key never reaches the browser. */
export function httpAiClient(base = import.meta.env.VITE_AI_URL ?? '/ai'): AiClient {
  return {
    parseAction: (req, signal) => post(base, '/parse', req, signal),
    resolveFocus: (req, signal) => post(base, '/focus', req, signal),
    voiceToken: signal => post(base, '/voice-token', {}, signal),
    summarize: (input, signal) => post(base, '/context', input, signal),
    analyzeScene: (input, signal) => post(base, '/scene', input, signal),
    findLanyard: (input, signal) => post(base, '/find', input, signal),
  };
}
