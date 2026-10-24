import type { ContextState, ParseRequest, ParseResult, SceneObject, Utterance } from './types';

export interface AiClient {
  parseAction(req: ParseRequest, signal?: AbortSignal): Promise<ParseResult>;
  summarize(input: { previous: ContextState | null; turns: Utterance[]; objects: SceneObject[]; viewerLanguage: string }, signal?: AbortSignal): Promise<ContextState>;
  analyzeScene(input: { imageBase64: string; mediaType: 'image/jpeg' | 'image/png'; now: number; prior: SceneObject[] }, signal?: AbortSignal): Promise<SceneObject[]>;
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
    summarize: (input, signal) => post(base, '/context', input, signal),
    analyzeScene: (input, signal) => post(base, '/scene', input, signal),
  };
}
