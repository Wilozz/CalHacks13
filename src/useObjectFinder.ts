import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { HandFrame } from './coordinates';
import { DEMO_BASE } from './render/useTwinMesh';

type Box = [number, number, number, number];
/** One object the on-device detector boxed (normalized, raw camera frame), and how much it looks like the lanyard (cosine, -1..1). */
export interface FoundBox { label: string; score: number; bbox: Box; sim: number }

// How lanyard-like a box must look. Calibrated on photos: other objects score up to ~0.3 against the rendered model; a
// picture of the lanyard itself (a learned crop) scores far higher.
export const MATCH = 0.42;
// Boxes stay up this long after the last frame that had any, so a frame or two of missed detections does not make the
// box you are about to click vanish.
const EVERY_MS = 120, LINGER_MS = 1500;
const LEARNED = 'handoff.lanyardRefs', MAX_LEARNED = 4;
const learned = (): string[] => { try { const l = JSON.parse(localStorage.getItem(LEARNED) ?? '[]'); return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string').slice(-MAX_LEARNED) : []; } catch { return []; } };

/** A box around a tracked hand, grown to take in what it holds (a card hangs below the fingers, the strap runs above). */
export function heldBox(h: HandFrame): Box {
  const xs = h.landmarks.map(p => p.x), ys = h.landmarks.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), s = Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2;
  const c = (n: number) => Math.min(1, Math.max(0, n));
  return [c(cx - 1.2 * s), c(y0 - 1.0 * s), c(cx + 1.2 * s), c(y1 + 1.6 * s)];
}

/** The best box if it is lanyard-like enough, else null. */
export const bestMatch = (boxes: FoundBox[]): FoundBox | null => boxes.reduce<FoundBox | null>((b, x) => (x.sim >= MATCH && (!b || x.sim > b.sim) ? x : b), null);

/**
 * The on-device finder (public/objects.worker.js): boxes every object in the camera about 8 times a second, each with how
 * much it looks like the stored lanyard. It never brings anything up itself: the person clicks the box they want. No
 * frame leaves the device. `learn` keeps a real crop of the lanyard (one Claude confirmed) in this browser, so the next
 * time it is matched at once.
 */
export function useObjectFinder(video: RefObject<HTMLVideoElement>, on: boolean, hands: () => (HandFrame | null)[]) {
  const [boxes, setBoxes] = useState<FoundBox[]>([]);
  const worker = useRef<Worker | null>(null), ready = useRef(false), busy = useRef(false), seenAt = useRef(0);
  const cb = useRef({ on, hands }); cb.current = { on, hands };

  // Loaded with the page, not the call, so the models are ready (and cached) by the time the lanyard is held up.
  useEffect(() => {
    if (worker.current) return;
    const w = new Worker(`${import.meta.env.BASE_URL}objects.worker.js`), t0 = performance.now(); worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.type === 'ready') { ready.current = true; console.info(`[find] models ready in ${Math.round(performance.now() - t0)} ms`); return; }
      busy.current = false;
      if (data.type === 'error') { console.warn('Object finder:', data.message); return; }
      if (!cb.current.on) return;
      const found = data.boxes as FoundBox[], now = performance.now();
      if (found.length) { seenAt.current = now; setBoxes(found); console.debug(`[find] ${data.ms | 0} ms:`, found.map(b => `${b.label} ${b.sim.toFixed(2)}`).join(', ')); }
      else if (now - seenAt.current > LINGER_MS) setBoxes(b => (b.length ? [] : b));
    };
    void (async () => {
      const urls = [`${DEMO_BASE}lanyard-ref.png`, `${DEMO_BASE}lanyard-ref-card.png`, ...learned()];
      const refs = (await Promise.all(urls.map(u => fetch(u).then(r => r.blob()).then(b => createImageBitmap(b)).catch(() => null)))).filter((b): b is ImageBitmap => !!b);
      w.postMessage({ type: 'init', refs }, refs);
    })();
    return () => { w.terminate(); worker.current = null; ready.current = false; };
  }, []);

  useEffect(() => {
    if (!on) { setBoxes([]); return; }
    const id = window.setInterval(() => {
      const v = video.current, w = worker.current;
      if (!w || !ready.current || busy.current || !v || v.readyState < 2 || !v.videoWidth) return;
      busy.current = true; // at most one frame in flight; the transferred bitmap is closed by the worker
      createImageBitmap(v).then(bitmap => {
        const held = cb.current.hands().filter((h): h is HandFrame => !!h && h.landmarks.length === 21).map(heldBox);
        w.postMessage({ type: 'frame', bitmap, held }, [bitmap]);
      }, () => { busy.current = false; });
    }, EVERY_MS);
    return () => clearInterval(id);
  }, [on, video]);

  /** Keep this part of the current camera picture as a real reference picture of the lanyard. */
  const learn = useCallback((bbox: Box) => {
    const v = video.current; if (!v?.videoWidth) return;
    const [x0, y0, x1, y1] = bbox, sw = (x1 - x0) * v.videoWidth, sh = (y1 - y0) * v.videoHeight;
    if (sw < 8 || sh < 8) return;
    const k = Math.min(1, 224 / Math.max(sw, sh)), c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    c.getContext('2d')?.drawImage(v, x0 * v.videoWidth, y0 * v.videoHeight, sw, sh, 0, 0, c.width, c.height);
    try { localStorage.setItem(LEARNED, JSON.stringify([...learned(), c.toDataURL('image/jpeg', 0.8)].slice(-MAX_LEARNED))); } catch { /* storage off: still used this session */ }
    void createImageBitmap(c).then(b => worker.current?.postMessage({ type: 'ref', bitmap: b }, [b]));
  }, [video]);

  return { boxes, learn };
}
