import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { HandFrame } from '../coordinates';

export type TrackerPhase = 'idle' | 'loading' | 'running' | 'error';
/** aspect: the camera frame's width / height, to line the hand up with the video on screen. */
export interface TrackedHand { frame: HandFrame | null; at: number; aspect: number }

/**
 * Front camera + the MediaPipe worker, for the throwing prototype. Same rules as App: at most one frame in
 * flight (drop, never queue) and every bitmap is closed. Kept separate from App's tracker so the two screens
 * can change independently.
 */
export function useTracker(video: RefObject<HTMLVideoElement | null>) {
  const [phase, setPhase] = useState<TrackerPhase>('idle');
  const [error, setError] = useState('');
  const hand = useRef<TrackedHand>({ frame: null, at: 0, aspect: 4 / 3 });
  const dispose = useRef<() => void>(() => {});

  const stop = useCallback(() => { dispose.current(); dispose.current = () => {}; setPhase('idle'); }, []);

  const start = useCallback(async () => {
    dispose.current();
    let cancelled = false, raf = 0, busy = false, lastTime = -1, timeout = 0, canvasCapture = false;
    let stream: MediaStream | undefined, worker: Worker | undefined;
    const capture = document.createElement('canvas');
    const end = () => {
      cancelled = true; cancelAnimationFrame(raf); clearTimeout(timeout); worker?.terminate();
      stream?.getTracks().forEach(t => t.stop());
      if (video.current) video.current.srcObject = null;
      hand.current = { frame: null, at: 0, aspect: 4 / 3 };
    };
    dispose.current = end;
    const fail = (e: unknown) => {
      if (cancelled) return;
      end(); setPhase('error');
      const name = e instanceof Error ? e.name : '';
      setError(name === 'NotAllowedError' ? 'Camera access was denied. Allow it in site settings and retry.' : name === 'NotReadableError' ? 'The camera is in use by another app.' : `Hand tracking could not start. ${e instanceof Error ? e.message : String(e)}`);
    };
    setPhase('loading'); setError('');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Open GHOST on localhost or trusted HTTPS to use the camera.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      const v = video.current;
      if (!v) throw new Error('Video element is missing.');
      v.srcObject = stream; await v.play();
      if (cancelled) return;
      const snapshot = async () => {
        if (!canvasCapture) { try { return await createImageBitmap(v); } catch { canvasCapture = true; } } // Safari fallback
        const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        capture.width = Math.max(1, Math.round(v.videoWidth * scale)); capture.height = Math.max(1, Math.round(v.videoHeight * scale));
        capture.getContext('2d')!.drawImage(v, 0, 0, capture.width, capture.height);
        return createImageBitmap(capture);
      };
      const tick = () => {
        if (cancelled) return;
        raf = requestAnimationFrame(tick);
        if (document.hidden || busy || v.readyState < 2 || v.currentTime === lastTime) return;
        busy = true; lastTime = v.currentTime;
        snapshot().then(bitmap => {
          if (cancelled) { bitmap.close(); return; }
          worker!.postMessage({ type: 'frame', bitmap, timestamp: performance.now(), aspect: bitmap.width / bitmap.height }, [bitmap]);
        }).catch(fail);
      };
      worker = new Worker(`${import.meta.env.BASE_URL}tracking.worker.js`);
      worker.onerror = () => fail(new Error('The tracking worker failed to load.'));
      worker.onmessage = ({ data }) => {
        if (cancelled) return;
        if (data.type === 'error') fail(new Error(data.message));
        else if (data.type === 'ready') { clearTimeout(timeout); setPhase('running'); raf = requestAnimationFrame(tick); }
        else if (data.type === 'result') { busy = false; if (!document.hidden) hand.current = { frame: data.frame, at: performance.now(), aspect: data.aspect }; }
      };
      timeout = window.setTimeout(() => fail(new Error('Model loading timed out. Check the network.')), 45_000);
      worker.postMessage({ type: 'init' });
    } catch (e) { fail(e); }
  }, [video]);

  useEffect(() => {
    const leave = () => stop();
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); dispose.current(); };
  }, [stop]);

  return { phase, error, hand, start, stop };
}
