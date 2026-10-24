import { useEffect, useState, type MutableRefObject } from 'react';
import { DEFAULT_PLACEMENT, type Placement } from './placement';
import type { LoopbackChannel, RemoteHandState } from './remoteHand';

interface Props {
  enabled: boolean; onEnabled: (v: boolean) => void;
  placement: Placement; onPlacement: (p: Placement) => void;
  remote: MutableRefObject<RemoteHandState>; loop: MutableRefObject<LoopbackChannel | null>;
  cameraOn: boolean;
}

const Slider = ({ label, value, min, max, step, unit = '', onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) =>
  <label className="slider"><span>{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /><b>{value}{unit}</b></label>;

/** The two things a first-time user needs: how the hand is placed, and what to do next. */
export function HandQuickControls({ placement, onPlacement, cameraOn, tracked }: { placement: Placement; onPlacement: (p: Placement) => void; cameraOn: boolean; tracked: boolean }) {
  const set = (o: Partial<Placement>) => onPlacement({ ...placement, ...o });
  const hint = !cameraOn ? 'Press Start camera, then point your index finger at something.'
    : !tracked ? 'Hold your hand up so the camera can see it.'
    : placement.mode === 'follow' ? 'The cyan hand on the screen is what your friend would see. Move your finger to point.'
    : placement.pin ? 'Move your hand. The cyan hand moves from the spot you tapped. Tap again to move the spot.'
    : 'Tap the camera view where the cyan fingertip should land.';
  return <div className="quick">
    <div className="seg" role="group" aria-label="How the hand is placed">
      <button className={placement.mode === 'follow' ? '' : 'secondary'} aria-pressed={placement.mode === 'follow'} onClick={() => set({ mode: 'follow' })}>Follow my finger</button>
      <button className={placement.mode === 'pinned' ? '' : 'secondary'} aria-pressed={placement.mode === 'pinned'} onClick={() => set({ mode: 'pinned' })}>Pin to a spot</button>
    </div>
    <p className="quick-hint" role="status">{hint}</p>
  </div>;
}

/** Tuning and network test. Collapsed by default. */
export function HandAdvanced({ enabled, onEnabled, placement, onPlacement, remote, loop }: Omit<Props, 'cameraOn'>) {
  const [sim, setSim] = useState({ latency: 0, jitter: 0, loss: 0 });
  const [stats, setStats] = useState({ msgs: 0, kbps: 0, lost: 0, reordered: 0, age: null as number | null, showing: false });
  const set = (o: Partial<Placement>) => onPlacement({ ...placement, ...o });
  useEffect(() => {
    if (loop.current) { loop.current.latencyMs = sim.latency; loop.current.jitterMs = sim.jitter; loop.current.lossPct = sim.loss; }
  }, [sim, loop]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now(), r = remote.current, rate = r.rate(now);
      setStats({ msgs: rate.msgsPerSec, kbps: Math.round(rate.kbps), lost: r.lost, reordered: r.reordered, age: r.ageMs(now) === null ? null : Math.round(r.ageMs(now)!), showing: !!r.current(now) });
    }, 500);
    return () => clearInterval(id);
  }, [remote]);

  return <div className="scene-body">
      <div className="scene-row"><label><input type="checkbox" checked={enabled} onChange={e => onEnabled(e.target.checked)} /> Show the helper hand on the camera view</label></div>
      <div className="slider-grid">
        <Slider label="Hand size" value={placement.size} min={0.15} max={0.7} step={0.01} onChange={size => set({ size })} />
        <Slider label="Reach" value={placement.reach} min={0.4} max={1} step={0.05} onChange={reach => set({ reach })} />
        {placement.mode === 'pinned' && <Slider label="Motion gain" value={placement.gain} min={0.5} max={3} step={0.1} onChange={gain => set({ gain })} />}
      </div>
      <div className="scene-row">
        <label><input type="checkbox" checked={placement.flipX} onChange={e => set({ flipX: e.target.checked })} /> Mirror like the helper's selfie view</label>
        <button className="secondary" onClick={() => onPlacement({ ...DEFAULT_PLACEMENT })}>Reset placement</button>
      </div>
      <details className="sim"><summary>Network simulation</summary>
        <div className="slider-grid">
          <Slider label="Added latency" value={sim.latency} min={0} max={600} step={10} unit=" ms" onChange={latency => setSim({ ...sim, latency })} />
          <Slider label="Jitter" value={sim.jitter} min={0} max={200} step={10} unit=" ms" onChange={jitter => setSim({ ...sim, jitter })} />
          <Slider label="Packet loss" value={sim.loss} min={0} max={90} step={5} unit=" %" onChange={loss => setSim({ ...sim, loss })} />
        </div>
      </details>
      <div className="wire-stats" aria-label="Channel statistics"><span>{stats.msgs} msg/s</span><span>{stats.kbps} kbit/s</span><span>{stats.lost} lost</span><span>{stats.reordered} reordered</span><span>{stats.age === null ? 'no data' : `${stats.age} ms since last`}</span></div>
  </div>;
}
