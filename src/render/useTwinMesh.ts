import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeMesh, meshKey, type RawMesh } from '../ai/mesh';
import type { ModelSpec } from '../ai/types';
import { isLanyard, LANYARD_KEY } from '../remote/kitRig';
import type { TwinInfo } from '../remote/twinWire';
import type { ScanFrame } from '../useSceneScan';
import { fitLanyard, fitToModel, type FittedMesh } from './meshFit';

const BASE = import.meta.env.VITE_AI_URL ?? '/ai';
/** Models saved for the demo ship with the app (public/demo), so they load with no AI server and no scan. */
export const DEMO_BASE = `${import.meta.env.BASE_URL ?? '/'}demo/`;
export type MeshPhase = 'off' | 'none' | 'running' | 'ready' | 'error';
export interface TwinMesh {
  phase: MeshPhase; mesh: FittedMesh | null; startedAt: number | null; error: string;
  /** how long the cached one took to make, ms */
  ms: number | null;
  /** the one shown is the one saved for the demo */
  saved: boolean;
  /** the AI server can save models for the demo (only while developing) */
  canKeep: boolean;
  /** make one (or remake it) from the scanned picture */
  generate: (frame: ScanFrame, bbox: [number, number, number, number]) => void;
  /** save the current model into the app for the demo */
  keep: (twin: TwinInfo) => Promise<boolean>;
}

/** The cache name: every lanyard shares one, so the saved demo model is found whatever Claude calls it. */
export const meshKeyFor = (label: string) => (isLanyard(label) ? LANYARD_KEY : meshKey(label));

/**
 * The SAM 3D mesh for an object: the one saved for the demo if there is one, else the AI server's cache (or a newer
 * one made since saving). Both screens poll the cache, so a model the helper makes shows up on the other screen too;
 * nothing is made unless someone asks (generate), since that sends the picture to fal.ai.
 */
export function useTwinMesh(label: string, model: ModelSpec): TwinMesh {
  const key = meshKeyFor(label), lanyard = isLanyard(label);
  const [phase, setPhase] = useState<MeshPhase>('none');
  const [raw, setRaw] = useState<RawMesh | null>(null);
  const [saved, setSaved] = useState(false);
  const [canKeep, setCanKeep] = useState(false);
  const [info, setInfo] = useState<{ startedAt: number | null; error: string; ms: number | null }>({ startedAt: null, error: '', ms: null });
  const loaded = useRef<number | null>(null);
  const phaseRef = useRef(phase); phaseRef.current = phase;

  const loadDemo = useCallback(async (alive: () => boolean) => {
    try {
      const meta = await fetch(`${DEMO_BASE}${key}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (!meta || typeof meta.version !== 'number') return false;
      const f = await fetch(`${DEMO_BASE}${key}.ghm?v=${meta.version}`);
      const m = f.ok ? decodeMesh(await f.arrayBuffer()) : null;
      if (!m || !alive()) return false;
      loaded.current = meta.version; setRaw(m); setSaved(true); setPhase('ready');
      return true;
    } catch { return false; }
  }, [key]);

  const check = useCallback(async (alive: () => boolean) => {
    try {
      const r = await fetch(`${BASE}/mesh?key=${key}`);
      if (!alive()) return;
      if (!r.ok) { if (loaded.current === null) setPhase('off'); return; }
      const s = await r.json();
      setCanKeep(!!s.canKeep);
      // A model made after the saved one (a remake) replaces it on screen; the saved file stays until it is kept again.
      if (s.ready && (loaded.current === null || s.ready.version > loaded.current)) {
        const f = await fetch(`${BASE}/mesh/file/${key}?v=${s.ready.version}`);
        const m = f.ok ? decodeMesh(await f.arrayBuffer()) : null;
        if (!alive()) return;
        if (m) { loaded.current = s.ready.version; setRaw(m); setSaved(false); }
      }
      setInfo({ startedAt: s.startedAt, error: s.error ?? '', ms: s.ready?.ms ?? null });
      setPhase(s.running ? 'running' : s.ready || loaded.current !== null ? 'ready' : s.error ? 'error' : 'none');
    } catch { if (alive() && loaded.current === null) setPhase('off'); }
  }, [key]);

  useEffect(() => {
    let live = true, timer = 0;
    const alive = () => live;
    loaded.current = null; setRaw(null); setSaved(false); setPhase('none');
    const loop = async () => { await check(alive); if (live) timer = window.setTimeout(loop, phaseRef.current === 'running' ? 1500 : phaseRef.current === 'off' ? 15000 : 6000); };
    void loadDemo(alive).then(() => { if (live) void loop(); });
    return () => { live = false; clearTimeout(timer); };
  }, [check, loadDemo]);

  const generate = useCallback((frame: ScanFrame, bbox: [number, number, number, number]) => {
    setPhase('running'); setInfo(i => ({ ...i, startedAt: Date.now(), error: '' }));
    void fetch(`${BASE}/mesh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, label: lanyard ? 'ID badge on a lanyard' : label, ...frame, bbox, force: true }) })
      .then(async r => { if (!r.ok) { const why = `${r.status} ${(await r.text()).slice(0, 120)}`; setPhase('error'); setInfo(i => ({ ...i, error: why })); } })
      .catch(() => { setPhase('error'); setInfo(i => ({ ...i, error: 'Cannot reach the AI server' })); });
  }, [key, label, lanyard]);

  const keep = useCallback(async (twin: TwinInfo) => {
    try {
      const r = await fetch(`${BASE}/mesh/keep`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, twin }) });
      if (!r.ok) return false;
      setSaved(true);
      return true;
    } catch { return false; }
  }, [key]);

  // A scan that cannot be fitted falls back to the simple shapes; it must never take the page down.
  const mesh = useMemo(() => {
    if (!raw) return null;
    try { return lanyard ? fitLanyard(raw, model) : fitToModel(raw, model); }
    catch (e) { console.error('Could not fit the 3D model; showing the simple shapes', e); return null; }
  }, [raw, model, lanyard]);
  return { phase, mesh, ...info, saved, canKeep, generate, keep };
}
