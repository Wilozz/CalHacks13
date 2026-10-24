import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BONES } from '../coordinates';
import { pinchCloseness, PinchDetector } from '../remote/pinch';
import { depthScale, type P3, type Placement } from '../remote/placement';
import type { HandFrame } from '../coordinates';
import type { RemoteHandState } from '../remote/remoteHand';
import { TwinMover } from '../remote/twinMove';
import { fingertipOnTwin, modelBounds, placeHandOnTwin } from '../remote/twinPlacement';
import type { TwinInfo, TwinPose } from '../remote/twinWire';
import { edgeGeometry, PartMesh } from './DemoScene';

const CYAN = '#64f5ed';
const ZERO: TwinPose = { offset: [0, 0, 0], grabbing: false, hold: null };

type Mode = 'none' | 'waiting' | 'hover' | 'grab' | 'idle';
export interface BoxStatus { mode: Mode; moved: boolean; remote: boolean }

interface SceneProps {
  twin: TwinInfo; hand: MutableRefObject<RemoteHandState>; placement: MutableRefObject<Placement>; posFlip: boolean;
  drive: 'local' | 'remote'; remotePose: MutableRefObject<TwinPose>; onPose: (p: TwinPose) => void;
  status: MutableRefObject<BoxStatus>; resetToken: number;
}

const shapeGeometry = (shape: string) => shape === 'box' ? new THREE.BoxGeometry(1, 1, 1) : shape === 'sphere' ? new THREE.SphereGeometry(0.5, 20, 20) : shape === 'cone' ? new THREE.ConeGeometry(0.5, 1, 24) : new THREE.CylinderGeometry(0.5, 0.5, 1, 24);

/**
 * The 3D copy and the helper's hand. Pinching with the fingertip on the copy grabs it and it follows the
 * hand (moving); the hand is drawn gripping the grabbed spot. When the other person is the helper, this
 * only displays the pose they send.
 */
function TwinScene({ twin, hand, placement, posFlip, drive, remotePose, onPose, status, resetToken }: SceneProps) {
  const { lo, hi } = useMemo(() => modelBounds(twin.model), [twin.model]);
  const mover = useMemo(() => new TwinMover({ lo, hi }), [lo, hi]);
  const pinch = useMemo(() => new PinchDetector(), []);
  const objGroup = useRef<THREE.Group>(null!);
  const handGroup = useRef<THREE.Group>(null!);
  const joints = useRef<(THREE.Mesh | null)[]>([]);
  const bones = useRef<(THREE.Mesh | null)[]>([]);
  const tipMesh = useRef<THREE.Mesh>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const shadow = useRef<THREE.Mesh>(null!);
  const outlineMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const trail = useMemo(() => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.7 })), []);
  const s = useRef({ pos: Array.from({ length: 21 }, () => new THREE.Vector3()), a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fresh: false, view: new THREE.Vector3(), sent: ZERO, sentAt: 0 });
  const mats = useMemo(() => ({ joint: new THREE.MeshBasicMaterial({ color: '#9ffcf5', transparent: true }), bone: new THREE.MeshBasicMaterial({ color: '#22d3e6', transparent: true }), tip: new THREE.MeshBasicMaterial({ color: '#ffffff' }), ring: new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, side: THREE.DoubleSide }) }), []);
  const geoms = useMemo(() => twin.model.parts.map(p => shapeGeometry(p.shape)), [twin.model]);

  useEffect(() => { mover.reset(); s.current.view.set(0, 0, 0); onPose(ZERO); }, [resetToken, mover]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }, dt) => {
    const now = performance.now();
    const frame = hand.current.current(now);
    const v = s.current;
    let state = { offset: [...mover.offset] as P3, grabbing: false, hover: false, hold: null as P3 | null };
    let handPts: P3[] | null = null;
    let closeness = 0;

    if (drive === 'local') {
      const tip = frame ? fingertipOnTwin(frame, placement.current, twin.model, twin.bbox, twin.feedAspect, posFlip) : null;
      const pinching = pinch.update(frame);
      closeness = pinchCloseness(pinch.ratio);
      const m = mover.update(frame && tip ? { tip: tip.target, pinching, depth: tipDepth(frame, placement.current) } : null);
      state = m;
      if (frame && tip) handPts = placeHandOnTwin(frame, placement.current, twin.model, twin.bbox, twin.feedAspect, posFlip, m.grabbing && m.hold ? [m.hold[0] + m.offset[0], m.hold[1] + m.offset[1], m.hold[2] + m.offset[2]] : undefined)?.points ?? null;
      // Tell the other screen where the copy is, but not more than ~15 times a second.
      const cur: TwinPose = { offset: m.offset, grabbing: m.grabbing, hold: m.hold };
      const changed = cur.grabbing !== v.sent.grabbing || cur.offset.some((x, i) => Math.abs(x - v.sent.offset[i]) > 0.004);
      if (changed && now - v.sentAt > 66) { v.sent = cur; v.sentAt = now; onPose(cur); }
    } else {
      const rp = remotePose.current;
      state = { offset: rp.offset as P3, grabbing: rp.grabbing, hover: false, hold: rp.hold as P3 | null };
      const tip = frame ? fingertipOnTwin(frame, placement.current, twin.model, twin.bbox, twin.feedAspect, posFlip) : null;
      if (frame && tip) handPts = placeHandOnTwin(frame, placement.current, twin.model, twin.bbox, twin.feedAspect, posFlip, rp.grabbing && rp.hold ? [rp.hold[0] + rp.offset[0], rp.hold[1] + rp.offset[1], rp.hold[2] + rp.offset[2]] : undefined)?.points ?? null;
    }

    // Object: smooth toward its pose and lift slightly while held.
    const lift = state.grabbing ? 0.06 : 0;
    v.view.lerp(v.a.set(state.offset[0], state.offset[1], state.offset[2] + lift), 1 - Math.exp(-dt * 22));
    objGroup.current.position.copy(v.view);
    objGroup.current.scale.setScalar(state.grabbing ? 1.04 : 1);
    outlineMats.current.forEach(m => { m.opacity = state.grabbing ? 0.95 : state.hover ? 0.7 + 0.2 * Math.sin(clock.elapsedTime * 6) : 0; });
    shadow.current.position.set(v.view.x, lo[1] - 0.04, v.view.z);
    shadow.current.scale.setScalar(1 + Math.max(0, v.view.y) * 0.3);
    const moved = Math.hypot(v.view.x, v.view.y, v.view.z) > 0.05;
    const pos = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, 0, 0, 0); pos.setXYZ(1, v.view.x, v.view.y, v.view.z); pos.needsUpdate = true; trail.computeLineDistances();
    trail.visible = moved;

    // Hand.
    handGroup.current.visible = !!handPts;
    if (handPts) {
      const alpha = v.fresh ? 1 - Math.exp(-dt * 24) : 1; v.fresh = true;
      handPts.forEach((p, i) => { v.pos[i].lerp(v.a.set(p[0], p[1], p[2]), alpha); joints.current[i]?.position.copy(v.pos[i]); });
      BONES.forEach(([i, j], n) => {
        const m = bones.current[n]; if (!m) return;
        v.a.copy(v.pos[i]); v.b.copy(v.pos[j]).sub(v.a);
        m.position.copy(v.a).addScaledVector(v.b, 0.5); m.scale.set(1, v.b.length(), 1); m.quaternion.setFromUnitVectors(v.up, v.b.normalize());
      });
      tipMesh.current.position.copy(v.pos[8]); ring.current.position.copy(v.pos[8]);
      // The ring closes as the fingers meet and goes solid when grabbed.
      const r = 0.07 + 0.16 * (1 - closeness);
      ring.current.scale.set(r, r, r); ring.current.visible = drive === 'local' ? (state.hover || state.grabbing || closeness > 0.2) : state.grabbing;
      mats.ring.opacity = state.grabbing ? 1 : 0.8; mats.ring.color.set(state.grabbing ? '#fff36b' : CYAN);
      mats.joint.opacity = mats.bone.opacity = 0.95;
    } else v.fresh = false;

    const mode: Mode = !frame ? 'waiting' : state.grabbing ? 'grab' : state.hover ? 'hover' : 'idle';
    status.current = { mode, moved, remote: drive === 'remote' };
  });

  return <>
    <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.38, 32]} /><meshBasicMaterial color="#000" transparent opacity={0.28} depthWrite={false} /></mesh>
    {/* Where it started, as an outline, with a dashed line to where it is now. */}
    {twin.model.parts.map((p, i) => <lineSegments key={`o${i}`} geometry={edgeGeometry[p.shape]} position={p.position} scale={p.size}><lineBasicMaterial color="#ffffff" transparent opacity={0.4} /></lineSegments>)}
    <primitive object={trail} />
    <group ref={objGroup}>
      {twin.model.parts.map((p, i) => <PartMesh key={i} part={p} solid />)}
      {twin.model.parts.map((p, i) => <mesh key={`h${i}`} position={p.position} scale={[p.size[0] * 1.08, p.size[1] * 1.08, p.size[2] * 1.08]} geometry={geoms[i]}>
        <meshBasicMaterial ref={m => { if (m) outlineMats.current[i] = m; }} color="#fff36b" side={THREE.BackSide} transparent opacity={0} depthWrite={false} />
      </mesh>)}
    </group>
    <group ref={handGroup} visible={false}>
      {Array.from({ length: 21 }, (_, i) => <mesh key={i} ref={el => { joints.current[i] = el; }} material={mats.joint}><sphereGeometry args={[0.026, 10, 10]} /></mesh>)}
      {BONES.map((_, i) => <mesh key={i} ref={el => { bones.current[i] = el; }} material={mats.bone}><cylinderGeometry args={[0.014, 0.014, 1, 8]} /></mesh>)}
      <mesh ref={tipMesh} material={mats.tip}><sphereGeometry args={[0.04, 14, 14]} /></mesh>
      <mesh ref={ring} material={mats.ring} visible={false}><torusGeometry args={[1, 0.07, 8, 40]} /></mesh>
    </group>
  </>;
}

// How close the helper's hand is to their camera (1 = reference distance); closer pulls a grabbed object toward the viewer.
const tipDepth = (frame: HandFrame | null, pl: Placement) => frame ? depthScale(frame, pl) : 1;

function Lookat() {
  useFrame(({ camera }) => camera.lookAt(0, 0, 0));
  return null;
}

const HINT: Record<Mode, string> = { none: '', waiting: 'waiting for hand', hover: 'pinch to grab', grab: 'moving', idle: 'point at it, then pinch' };

/**
 * Small grey box with a 3D copy of the object the helper is pointing at, and the helper's hand on it.
 * The view is fixed (no spinning) so the hand's position on the object stays meaningful.
 */
export function TwinBox({ twin, hand, placement, posFlip, drive, remotePose, onPose, onClose }: {
  twin: TwinInfo; hand: MutableRefObject<RemoteHandState>; placement: Placement; posFlip: boolean;
  drive: 'local' | 'remote'; remotePose: MutableRefObject<TwinPose>; onPose: (p: TwinPose) => void; onClose: () => void;
}) {
  const pl = useRef(placement);
  useEffect(() => { pl.current = placement; }, [placement]);
  const status = useRef<BoxStatus>({ mode: 'none', moved: false, remote: false });
  const [ui, setUi] = useState<BoxStatus>(status.current);
  const [resetToken, setResetToken] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setUi(prev => (prev.mode === status.current.mode && prev.moved === status.current.moved && prev.remote === status.current.remote) ? prev : { ...status.current }), 150);
    return () => clearInterval(id);
  }, []);
  const text = ui.remote && ui.mode === 'grab' ? 'friend is moving it' : ui.remote && ui.mode !== 'waiting' ? (ui.moved ? 'moved by your friend' : 'friend is pointing') : ui.mode === 'idle' && ui.moved ? 'moved · pinch to move again' : HINT[ui.mode];
  return <aside className="twin-box" aria-label={`3D copy of ${twin.label}`} data-mode={ui.mode} data-moved={ui.moved ? '1' : '0'}>
    <Canvas dpr={[1, 2]} camera={{ position: [0.5, 0.4, 3.4], fov: 40 }} gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
      <Lookat />
      <ambientLight intensity={1.2} />
      <directionalLight position={[2, 3, 4]} intensity={2} />
      <TwinScene key={twin.objectId} twin={twin} hand={hand} placement={pl} posFlip={posFlip} drive={drive} remotePose={remotePose} onPose={onPose} status={status} resetToken={resetToken} />
    </Canvas>
    <div className="twin-label"><span>{twin.label}</span><span className="twin-status">{text}</span></div>
    {ui.moved && drive === 'local' && <button className="twin-reset" aria-label="Put it back" title="Put it back" onClick={() => setResetToken(n => n + 1)}>↺</button>}
    <button className="twin-close" aria-label="Close 3D view" onClick={onClose}>×</button>
  </aside>;
}
