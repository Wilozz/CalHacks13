import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BONES } from '../coordinates';
import { PartMesh } from '../render/DemoScene';
import { IDLE_STATUS, TwinScene, type BoxStatus, type HandSource } from '../render/TwinBox';
import { useTwinMesh } from '../render/useTwinMesh';
import { DEFAULT_PLACEMENT } from '../remote/placement';
import { REST_POSE, type TwinInfo, type TwinPose } from '../remote/twinWire';
import { indexAt, type Replay } from './log';

interface Clock { t: number; playing: boolean; speed: number }
const SPEEDS = [0.5, 1, 2];
const W = 3; // the camera image is W world units tall; the object and hands are placed on it as they were recorded
const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function Orbit() {
  const { camera, gl } = useThree();
  useEffect(() => { const c = new OrbitControls(camera, gl.domElement); c.enablePan = false; c.minDistance = 2; c.maxDistance = 12; c.update(); return () => c.dispose(); }, [camera, gl]);
  return null;
}

/** One tracked hand as a 3D skeleton: the 21 recorded points, depth included. */
function Skeleton({ points, which }: { points: MutableRefObject<THREE.Vector3[][]>; which: number }) {
  const group = useRef<THREE.Group>(null!);
  const joints = useRef<(THREE.Mesh | null)[]>([]), bones = useRef<(THREE.Mesh | null)[]>([]);
  const tmp = useMemo(() => ({ d: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);
  useFrame(() => {
    const p = points.current[which];
    group.current.visible = !!p;
    if (!p) return;
    p.forEach((v, i) => joints.current[i]?.position.copy(v));
    BONES.forEach(([a, b], n) => {
      const m = bones.current[n]; if (!m) return;
      tmp.d.copy(p[b]).sub(p[a]);
      m.position.copy(p[a]).addScaledVector(tmp.d, 0.5); m.scale.set(1, tmp.d.length(), 1); m.quaternion.setFromUnitVectors(tmp.up, tmp.d.normalize());
    });
  });
  return <group ref={group} visible={false}>
    {Array.from({ length: 21 }, (_, i) => <mesh key={i} ref={el => { joints.current[i] = el; }}><sphereGeometry args={[[4, 8, 12, 16, 20].includes(i) ? 0.045 : 0.035, 12, 12]} /><meshBasicMaterial color="#9ffcf5" /></mesh>)}
    {BONES.map((_, i) => <mesh key={i} ref={el => { bones.current[i] = el; }}><cylinderGeometry args={[0.018, 0.018, 1, 8]} /><meshBasicMaterial color="#22d3e6" /></mesh>)}
  </group>;
}

/** Moves the playhead and puts the object and hands where they were at that moment. */
function Scene({ replay, clock }: { replay: Replay; clock: MutableRefObject<Clock> }) {
  const object = useRef<THREE.Group>(null!);
  const points = useRef<THREE.Vector3[][]>([]);
  const a = replay.aspect;
  const frame = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(a * W, W)), [a]);
  useFrame((_, dt) => {
    const c = clock.current;
    if (c.playing) { c.t += dt * 1000 * c.speed; if (c.t >= replay.durationMs) { c.t = replay.durationMs; c.playing = false; } }
    const p = replay.poses[indexAt(replay.poses, c.t)]?.pose ?? null;
    object.current.visible = !!p;
    if (p) { object.current.position.set((p.u - 0.5) * a * W, (0.5 - p.v) * W, 0); object.current.scale.setScalar(Math.max(0.01, p.h * W)); object.current.quaternion.set(...p.q); }
    // MediaPipe: x, y on the image, z depth in image-width units (negative is toward the camera).
    const hands = replay.hands[indexAt(replay.hands, c.t)]?.hands ?? [];
    points.current = hands.map(h => h.landmarks.map(l => new THREE.Vector3((l.x - 0.5) * a * W, (0.5 - l.y) * W, -l.z * a * W)));
  });
  return <>
    <lineSegments geometry={frame}><lineBasicMaterial color="#ffffff" transparent opacity={0.18} /></lineSegments>
    <group ref={object}>{replay.model.parts.map((part, i) => <PartMesh key={i} part={part} solid />)}</group>
    <Skeleton points={points} which={0} /><Skeleton points={points} which={1} />
  </>;
}

/**
 * A lesson from the call: the same 3D copy as the live box (the lanyard, its claw and strap), driven by the recorded pose,
 * with both people's recorded hands on it.
 */
function TwinReplay({ replay, twin, clock }: { replay: Replay; twin: TwinInfo; clock: MutableRefObject<Clock> }) {
  const pose = useRef<TwinPose>(REST_POSE), status = useRef<BoxStatus>(IDLE_STATUS), placement = useRef(DEFAULT_PLACEMENT);
  const hands = useRef<HandSource>({ current: (_now, slot) => replay.hands[indexAt(replay.hands, clock.current.t)]?.hands[slot] ?? null });
  const peer = useRef<HandSource>({ current: (_now, slot) => { const p = replay.peerHands ?? []; return p[indexAt(p, clock.current.t)]?.hands[slot] ?? null; } });
  const sam = useTwinMesh(twin.label, twin.model);
  useFrame((_, dt) => {
    const c = clock.current;
    if (c.playing) { c.t += dt * 1000 * c.speed; if (c.t >= replay.durationMs) { c.t = replay.durationMs; c.playing = false; } }
    pose.current = replay.twinPoses[indexAt(replay.twinPoses, c.t)]?.pose ?? REST_POSE;
  });
  return <TwinScene mirror={false} twin={twin} hand={hands} placement={placement} posFlip={DEFAULT_PLACEMENT.flipX} drive="remote" remotePose={pose} onPose={() => {}} status={status} resetToken={0} mesh={sam.mesh} peer={peer} />;
}

/** A recorded lesson: the object and the hands that handled it, from any angle, as often as you like. No video. */
export function ReplayPlayer({ replay }: { replay: Replay }) {
  const clock = useRef<Clock>({ t: 0, playing: true, speed: 1 });
  const [ui, setUi] = useState<Clock>(clock.current);
  useEffect(() => { clock.current = { t: 0, playing: true, speed: clock.current.speed }; }, [replay]);
  useEffect(() => {
    const id = window.setInterval(() => setUi(prev => { const c = clock.current; return Math.abs(prev.t - c.t) < 50 && prev.playing === c.playing && prev.speed === c.speed ? prev : { ...c }; }), 100);
    return () => clearInterval(id);
  }, []);
  const set = (patch: Partial<Clock>) => { Object.assign(clock.current, patch); setUi({ ...clock.current }); };
  const toggle = () => set(clock.current.playing ? { playing: false } : { playing: true, t: clock.current.t >= replay.durationMs ? 0 : clock.current.t });
  return <div className="replay-player">
    <div className="replay-stage">
      <Canvas dpr={[1, 2]} camera={{ position: replay.twin ? [0.5, 0.4, 3.4] : [0, 0.3, 6], fov: 40 }} gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
        <Orbit />
        <ambientLight intensity={1.2} />
        <directionalLight position={[2, 3, 4]} intensity={2} />
        {replay.twin ? <TwinReplay replay={replay} twin={replay.twin} clock={clock} /> : <Scene replay={replay} clock={clock} />}
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
