import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeMesh, meshKey, type RawMesh } from '../ai/mesh';
import type { ModelSpec } from '../ai/types';
import type { ScanFrame } from '../useSceneScan';
import { fitToModel, type FittedMesh } from './meshFit';

const BASE = import.meta.env.VITE_AI_URL ?? '/ai';
export type MeshPhase = 'off' | 'none' | 'running' | 'ready' | 'error';
export interface TwinMesh {
  phase: MeshPhase; mesh: FittedMesh | null; startedAt: number | null; error: string;
  /** how long the cached one took to make, ms */
  ms: number | null;
  /** make one (or remake it) from the scanned picture */
  generate: (frame: ScanFrame, bbox: [number, number, number, number]) => void;
}

/**
 * The SAM 3D mesh for an object, from the AI server's cache. Both screens poll the cache, so a model the helper makes
 * shows up on the other screen too; nothing is made unless someone asks (generate), since that sends the picture to fal.ai.
 */
export function useTwinMesh(label: string, model: ModelSpec): TwinMesh {
  const key = meshKey(label);
  const [phase, setPhase] = useState<MeshPhase>('none');
  const [raw, setRaw] = useState<RawMesh | null>(null);
  const [info, setInfo] = useState<{ startedAt: number | null; error: string; ms: number | null }>({ startedAt: null, error: '', ms: null });
  const loaded = useRef<number | null>(null);
  const phaseRef = useRef(phase); phaseRef.current = phase;

  const check = useCallback(async (alive: () => boolean) => {
    try {
      const r = await fetch(`${BASE}/mesh?key=${key}`);
      if (!alive()) return;
      if (!r.ok) { setPhase('off'); return; }
      const s = await r.json();
      if (s.ready && s.ready.version !== loaded.current) {
        const f = await fetch(`${BASE}/mesh/file/${key}?v=${s.ready.version}`);
        const m = f.ok ? decodeMesh(await f.arrayBuffer()) : null;
        if (!alive()) return;
        if (m) { loaded.current = s.ready.version; setRaw(m); }
      }
      setInfo({ startedAt: s.startedAt, error: s.error ?? '', ms: s.ready?.ms ?? null });
      setPhase(s.running ? 'running' : s.ready ? 'ready' : s.error ? 'error' : 'none');
    } catch { if (alive()) setPhase('off'); }
  }, [key]);

  useEffect(() => {
    let live = true, timer = 0;
    const alive = () => live;
    loaded.current = null; setRaw(null); setPhase('none');
    const loop = async () => { await check(alive); if (live) timer = window.setTimeout(loop, phaseRef.current === 'running' ? 1500 : phaseRef.current === 'off' ? 15000 : 6000); };
    void loop();
    return () => { live = false; clearTimeout(timer); };
  }, [check]);

  const generate = useCallback((frame: ScanFrame, bbox: [number, number, number, number]) => {
    setPhase('running'); setInfo(i => ({ ...i, startedAt: Date.now(), error: '' }));
    void fetch(`${BASE}/mesh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, label, ...frame, bbox, force: true }) })
      .then(async r => { if (!r.ok) { const why = `${r.status} ${(await r.text()).slice(0, 120)}`; setPhase('error'); setInfo(i => ({ ...i, error: why })); } })
      .catch(() => { setPhase('error'); setInfo(i => ({ ...i, error: 'Cannot reach the AI server' })); });
  }, [key, label]);

  const mesh = useMemo(() => (raw ? fitToModel(raw, model) : null), [raw, model]);
  return { phase, mesh, ...info, generate };
}
