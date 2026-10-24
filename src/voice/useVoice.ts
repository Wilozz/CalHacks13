import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiClient } from '../ai/client';
import { CartesiaListener, type ListenState } from './cartesia';
import { browserSpeechSupported, startBrowserRecognizer } from './speechFallback';

export type VoiceState = 'off' | 'asking' | 'starting' | 'listening' | 'error';
export type Engine = 'cartesia' | 'browser' | null;

const CONSENT_KEY = 'ghost.voice.consent.v1';
const readConsent = () => { try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; } };
const writeConsent = () => { try { localStorage.setItem(CONSENT_KEY, '1'); } catch { /* private mode: ask again next time */ } };

/**
 * Always-on listening. Uses Cartesia when the server can mint a token, and the browser's recognizer when it
 * cannot (no key). The first start asks for consent, because everyone on the call should know it is listening.
 */
export function useVoice(opts: { client: Pick<AiClient, 'voiceToken'>; getStream: () => Promise<{ stream: MediaStream; owned: boolean }>; onFinal: (text: string) => void }) {
  const [state, setState] = useState<VoiceState>('off');
  const [engine, setEngine] = useState<Engine>(null);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const cur = useRef(opts); cur.current = opts;
  const listener = useRef<CartesiaListener | null>(null);
  const stopBrowser = useRef<(() => void) | null>(null);
  const ownStream = useRef<MediaStream | null>(null);
  const run = useRef(0);

  const teardown = useCallback(() => {
    run.current++;
    listener.current?.stop(); listener.current = null;
    stopBrowser.current?.(); stopBrowser.current = null;
    ownStream.current?.getTracks().forEach(t => t.stop()); ownStream.current = null;
    setPartial('');
  }, []);

  const begin = useCallback(async () => {
    teardown();
    const my = ++run.current;
    setState('starting'); setError(''); setEngine(null);
    let stream: MediaStream, owned = false;
    try { ({ stream, owned } = await cur.current.getStream()); }
    catch (e) { if (my === run.current) { setState('error'); setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser settings.' : 'Could not open the microphone.'); } return; }
    if (my !== run.current) { if (owned) stream.getTracks().forEach(t => t.stop()); return; }
    ownStream.current = owned ? stream : null;

    const useBrowser = (why?: string) => {
      if (my !== run.current) return;
      listener.current?.stop(); listener.current = null;
      if (!browserSpeechSupported()) { setState('error'); setError(`${why ?? 'Speech service unavailable'}, and this browser has no built-in speech recognition. Use Chrome or add a Cartesia key.`); return; }
      stopBrowser.current = startBrowserRecognizer(setPartial, t => cur.current.onFinal(t), m => { setError(m); }, 'en-US');
      setEngine('browser'); setState('listening');
    };

    const l = new CartesiaListener({
      getToken: () => cur.current.client.voiceToken(),
      onPartial: t => { if (my === run.current) setPartial(t); },
      onUtterance: u => { if (my === run.current) cur.current.onFinal(u.text); },
      onState: (s: ListenState, detail) => {
        if (my !== run.current) return;
        if (s === 'listening') { setEngine('cartesia'); setState('listening'); setError(''); }
        else if (s === 'unavailable') useBrowser('Cartesia is not configured on the server');
        else if (s === 'error') { setError(detail ?? 'Speech service error'); setState(prev => (prev === 'listening' ? prev : 'error')); }
      },
    });
    listener.current = l;
    void l.start(stream);
  }, [teardown]);

  const start = useCallback(() => { if (readConsent()) void begin(); else setState('asking'); }, [begin]);
  const accept = useCallback(() => { writeConsent(); void begin(); }, [begin]);
  const decline = useCallback(() => setState('off'), []);
  const stop = useCallback(() => { teardown(); setState('off'); setEngine(null); }, [teardown]);
  useEffect(() => teardown, [teardown]);

  return { state, engine, partial, error, start, accept, decline, stop };
}
