import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { httpAiClient } from './ai/client';
import type { SceneObject } from './ai/types';

const MAX_SIDE = 768;

/** Grab one JPEG keyframe of the camera, un-mirrored, so bboxes share the raw video's coordinates. */
function captureFrame(v: HTMLVideoElement): string | null {
  if (!v.videoWidth || !v.videoHeight) return null;
  const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7).split(',')[1] ?? null;
}

/** Asks Claude (vision) what is in the camera view and what a 3D twin of each object looks like. */
export function useSceneScan(video: RefObject<HTMLVideoElement>, cameraOn: boolean) {
  const [objects, setObjects] = useState<SceneObject[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(false);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const client = useMemo(() => httpAiClient(), []);
  const busy = useRef(false);
  const prior = useRef<SceneObject[]>([]);
  prior.current = objects;

  const scan = useCallback(async () => {
    if (busy.current || !video.current) return;
    const imageBase64 = captureFrame(video.current);
    if (!imageBase64) { setError('The camera is not ready yet.'); return; }
    busy.current = true; setScanning(true); setError('');
    const started = performance.now();
    try {
      const found = await client.analyzeScene({ imageBase64, mediaType: 'image/jpeg', now: performance.now() / 1000, prior: prior.current });
      setObjects(found);
      setLastMs(performance.now() - started);
      if (!found.length) setError('Claude did not see any objects it could model. Move closer or improve the lighting.');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/503/.test(m) ? 'The AI server has no ANTHROPIC_API_KEY. Add it to .env and restart npm run ai.' : /fetch|Failed|404|ECONN|502/.test(m) ? 'Cannot reach the AI server. Run npm run ai in another terminal.' : m);
    } finally { busy.current = false; setScanning(false); }
  }, [client, video]);

  useEffect(() => {
    if (!auto || !cameraOn) return;
    const id = window.setInterval(() => void scan(), 6000);
    return () => clearInterval(id);
  }, [auto, cameraOn, scan]);
  useEffect(() => { if (!cameraOn) { setObjects([]); setError(''); } }, [cameraOn]);

  return { objects, scanning, error, auto, setAuto, scan, lastMs, clear: () => setObjects([]) };
}
