interface RecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
}

export const browserSpeechSupported = () => typeof window !== 'undefined' && !!((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);

/**
 * Fallback when Cartesia is not configured: the browser's own recognizer. Chrome sends this audio to Google,
 * which the consent text says. Returns a stop function, or null when the browser has none.
 */
export function startBrowserRecognizer(onPartial: (t: string) => void, onFinal: (t: string) => void, onError: (m: string) => void, lang = 'en-US'): (() => void) | null {
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec: RecognitionLike = new Ctor();
  rec.lang = lang; rec.continuous = true; rec.interimResults = true;
  let stopped = false;
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], text = r[0].transcript;
      if (r.isFinal) { onPartial(''); onFinal(text); } else interim += text;
    }
    if (interim) onPartial(interim);
  };
  rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') onError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Speech recognition error: ${e.error}`); };
  rec.onend = () => { if (!stopped) { try { rec.start(); } catch { /* already running */ } } };
  try { rec.start(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); return null; }
  return () => { stopped = true; try { rec.stop(); } catch { /* not running */ } };
}
