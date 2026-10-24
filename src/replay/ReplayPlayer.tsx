import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { encodeHand } from '../remote/handWire';
import { RemoteHandState } from '../remote/remoteHand';
import { REST_POSE, type TwinPose } from '../remote/twinWire';
import { IDLE_STATUS, TwinScene, type BoxStatus } from '../render/TwinBox';
import { useTwinMesh } from '../render/useTwinMesh';
import { indexAt, type Replay } from './log';

interface Clock { t: number; playing: boolean; speed: number }
const SPEEDS = [0.5, 1, 2];
const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function Orbit() {
  const { camera, gl } = useThree();
  useEffect(() => { const c = new OrbitControls(camera, gl.domElement); c.enablePan = false; c.minDistance = 1.5; c.maxDistance = 8; c.update(); return () => c.dispose(); }, [camera, gl]);
  return null;
}

/** Moves the playhead and feeds the scene the recorded hands and pose for that moment. */
function Playhead({ replay, clock, hand, pose }: { replay: Replay; clock: MutableRefObject<Clock>; hand: MutableRefObject<RemoteHandState>; pose: MutableRefObject<TwinPose> }) {
  const fed = useRef({ index: [-2, -2], seq: 0 });
  const bySlot = useMemo(() => [replay.hands.filter(h => !h.slot), replay.hands.filter(h => h.slot === 1)], [replay]);
  useFrame((_, dt) => {
    const c = clock.current;
    if (c.playing) { c.t += dt * 1000 * c.speed; if (c.t >= replay.durationMs) { c.t = replay.durationMs; c.playing = false; } }
    pose.current = replay.poses[indexAt(replay.poses, c.t)]?.pose ?? REST_POSE;
    const f = fed.current, now = performance.now();
    ([0, 1] as const).forEach(slot => {
      const i = indexAt(bySlot[slot], c.t);
      if (i === f.index[slot]) return;
      f.index[slot] = i;
      hand.current.accept(encodeHand(f.seq++ & 0xffff, now, i < 0 ? null : bySlot[slot][i].hand, slot), now);
    });
  });
  return null;
}

/** The recorded 3D scene: the object and the hand that moved it, from any angle, as often as you like. No video. */
export function ReplayPlayer({ replay }: { replay: Replay }) {
  // Never stale: a recorded "no hand" event is what hides it, so a paused hand stays put.
  const hand = useRef(new RemoteHandState(Infinity));
  const pose = useRef<TwinPose>(REST_POSE);
  const placement = useRef(replay.placement);
  const status = useRef<BoxStatus>(IDLE_STATUS);
  const sam = useTwinMesh(replay.twin.label, replay.twin.model); // the SAM 3D model, if one was made for this object
  const clock = useRef<Clock>({ t: 0, playing: true, speed: 1 });
  const [ui, setUi] = useState<Clock>(clock.current);
  useEffect(() => { clock.current = { t: 0, playing: true, speed: clock.current.speed }; placement.current = replay.placement; hand.current.reset(); }, [replay]);
  useEffect(() => {
    const id = window.setInterval(() => setUi(prev => { const c = clock.current; return Math.abs(prev.t - c.t) < 50 && prev.playing === c.playing && prev.speed === c.speed ? prev : { ...c }; }), 100);
    return () => clearInterval(id);
  }, []);
  const set = (patch: Partial<Clock>) => { Object.assign(clock.current, patch); setUi({ ...clock.current }); };
  const toggle = () => set(clock.current.playing ? { playing: false } : { playing: true, t: clock.current.t >= replay.durationMs ? 0 : clock.current.t });
  return <div className="replay-player">
    <div className={`replay-stage ${replay.mirror ? 'mirror' : ''}`}>
      <Canvas dpr={[1, 2]} camera={{ position: [0.5, 0.4, 3.4], fov: 40 }} gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
        <Orbit />
        <ambientLight intensity={1.2} />
        <directionalLight position={[2, 3, 4]} intensity={2} />
        <Playhead replay={replay} clock={clock} hand={hand} pose={pose} />
        <TwinScene key={replay.twin.objectId} mirror={replay.mirror} twin={replay.twin} hand={hand} placement={placement} posFlip={replay.posFlip} drive="remote" remotePose={pose} onPose={() => {}} status={status} resetToken={0} mesh={sam.mesh} />
      </Canvas>
      <span className="replay-hint">Drag to look around</span>
    </div>
    <div className="replay-controls">
      <button className="round small" aria-label={ui.playing ? 'Pause' : 'Play'} onClick={toggle}>{ui.playing ? '❚❚' : '▶'}</button>
      <input type="range" aria-label="Position" min={0} max={replay.durationMs} step={10} value={Math.round(ui.t)} onChange={e => set({ t: Number(e.target.value) })} />
      <span className="replay-time">{fmt(ui.t)} / {fmt(replay.durationMs)}</span>
      <div className="replay-speeds" role="group" aria-label="Speed">{SPEEDS.map(s => <button key={s} aria-pressed={ui.speed === s} onClick={() => set({ speed: s })}>{s}×</button>)}</div>
    </div>
  </div>;
}
