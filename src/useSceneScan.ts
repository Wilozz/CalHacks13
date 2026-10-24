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
/** 16x12 grayscale thumbnail: cheap to compare, so we only pay for a vision call when the view actually changed. */
export function frameSignature(v: HTMLVideoElement): Uint8Array | null {
  if (!v.videoWidth || !v.videoHeight || v.readyState < 2) return null;
  const c = document.createElement('canvas'); c.width = 16; c.height = 12;
  const ctx = c.getContext('2d', { willReadFrequently: true }); if (!ctx) return null;
  ctx.drawImage(v, 0, 0, 16, 12);
  const d = ctx.getImageData(0, 0, 16, 12).data, out = new Uint8Array(192);
  for (let i = 0; i < 192; i++) out[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0;
  return out;
}
/** Mean absolute difference, 0..1. */
export function signatureDistance(a: Uint8Array, b: Uint8Array): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
}

export function useSceneScan(video: RefObject<HTMLVideoElement>, cameraOn: boolean, opts?: { getSource?: () => HTMLVideoElement | null; beforeScan?: (source: HTMLVideoElement | null) => void; watch?: boolean }) {
  const [objects, setObjects] = useState<SceneObject[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(false);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const client = useMemo(() => httpAiClient(), []);
  const busy = useRef(false);
  const o = useRef(opts); o.current = opts;
  const lastSig = useRef<Uint8Array | null>(null);
  const lastScanAt = useRef(0);
  const prior = useRef<SceneObject[]>([]);
  prior.current = objects;

  /** Scans `source` (e.g. the friend's video) or, by default, the tracking camera. */
  const scan = useCallback(async (source?: HTMLVideoElement | null) => {
    const v = source ?? video.current;
    if (busy.current || !v) return;
    const imageBase64 = captureFrame(v);
    o.current?.beforeScan?.(v);
    if (!imageBase64) { setError('The camera is not ready yet.'); return; }
    busy.current = true; setScanning(true); setError(''); lastScanAt.current = performance.now(); lastSig.current = frameSignature(v);
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

  // While watching (voice is listening, or auto-scan is on), look again when the view changes: new object, moved camera.
  useEffect(() => {
    const watching = auto || opts?.watch;
    if (!watching) return;
    const id = window.setInterval(() => {
      const src = o.current?.getSource?.() ?? video.current;
      if (!src || busy.current) return;
      const sig = frameSignature(src); if (!sig) return;
      const since = performance.now() - lastScanAt.current;
      const changed = !lastSig.current || signatureDistance(sig, lastSig.current) > 0.07;
      if ((changed && since > 8000) || (!lastSig.current && since > 2000)) void scan(src);
    }, 2000);
    return () => clearInterval(id);
  }, [auto, opts?.watch, scan, video]);
  useEffect(() => { if (!cameraOn) { setObjects([]); setError(''); } }, [cameraOn]);

  return { objects, scanning, error, auto, setAuto, scan, lastMs, clear: () => setObjects([]) };
}
