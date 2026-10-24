import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HandFrame } from '../coordinates';
import { BONES } from '../coordinates';
import { GraspDetector, grabPoint, twistAngle, type GraspKind } from '../remote/grasp';
import { depthScale, type P3, type Placement } from '../remote/placement';
import { palmQuat, qAngle, QI, type Q } from '../remote/quat';
import type { RemoteHandState } from '../remote/remoteHand';
import { TwinMover } from '../remote/twinMove';
import { fingertipOnTwin, HOLD_FINGERS, modelBounds, placeHandOnTwin } from '../remote/twinPlacement';
import { REST_POSE, type TwinInfo, type TwinPose } from '../remote/twinWire';
import { edgeGeometry, PartMesh } from './DemoScene';

const CYAN = '#64f5ed';
const HOLD_COLOR: Record<GraspKind, string> = { none: CYAN, pinch: '#fff36b', grip: '#ff9f43' };

type Mode = 'none' | 'waiting' | 'hover' | 'grab' | 'idle';
export interface BoxStatus { mode: Mode; kind: GraspKind; moved: boolean; turned: boolean; remote: boolean; angle: number }

interface SceneProps {
  twin: TwinInfo; hand: MutableRefObject<RemoteHandState>; placement: MutableRefObject<Placement>; posFlip: boolean;
  drive: 'local' | 'remote'; remotePose: MutableRefObject<TwinPose>; onPose: (p: TwinPose) => void;
  status: MutableRefObject<BoxStatus>; resetToken: number;
}

const shapeGeometry = (shape: string) => shape === 'box' ? new THREE.BoxGeometry(1, 1, 1) : shape === 'sphere' ? new THREE.SphereGeometry(0.5, 20, 20) : shape === 'cone' ? new THREE.ConeGeometry(0.5, 1, 24) : new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
// How close the helper's hand is to their camera (1 = reference distance); closer pulls a held object toward the viewer.
const tipDepth = (frame: HandFrame | null, pl: Placement) => frame ? depthScale(frame, pl) : 1;
const same = (a: number[], b: number[], e: number) => a.every((v, i) => Math.abs(v - b[i]) <= e);

/**
 * The 3D copy and the helper's hand. Pinch (thumb + index) on the copy to grab it and move it, twist to spin it;
 * grip (thumb + index + middle) to hold it and turn it with your whole hand. The hand is drawn holding the spot
 * it grabbed. When the other person is the helper, this only displays the pose they send.
 */
function TwinScene({ twin, hand, placement, posFlip, drive, remotePose, onPose, status, resetToken }: SceneProps) {
  const { lo, hi } = useMemo(() => modelBounds(twin.model), [twin.model]);
  const mover = useMemo(() => new TwinMover({ lo, hi }), [lo, hi]);
  const grasp = useMemo(() => new GraspDetector(), []);
  const objGroup = useRef<THREE.Group>(null!);
  const handGroup = useRef<THREE.Group>(null!);
  const joints = useRef<(THREE.Mesh | null)[]>([]);
  const bones = useRef<(THREE.Mesh | null)[]>([]);
  const holdDots = useRef<(THREE.Mesh | null)[]>([]);   // thumb, index, middle tips light up for the fingers that hold
  const ring = useRef<THREE.Mesh>(null!);
  const shadow = useRef<THREE.Mesh>(null!);
  const outlineMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const trail = useMemo(() => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.7 })), []);
  const s = useRef({ pos: Array.from({ length: 21 }, () => new THREE.Vector3()), a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fresh: false, view: new THREE.Vector3(), quat: new THREE.Quaternion(), want: new THREE.Quaternion(), sent: REST_POSE, sentAt: 0 });
  const mats = useMemo(() => ({ joint: new THREE.MeshBasicMaterial({ color: '#9ffcf5', transparent: true }), bone: new THREE.MeshBasicMaterial({ color: '#22d3e6', transparent: true }), tip: new THREE.MeshBasicMaterial({ color: '#ffffff' }), ring: new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, side: THREE.DoubleSide }) }), []);
  const geoms = useMemo(() => twin.model.parts.map(p => shapeGeometry(p.shape)), [twin.model]);

  useEffect(() => { mover.reset(); s.current.view.set(0, 0, 0); s.current.quat.identity(); onPose(REST_POSE); }, [resetToken, mover]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }, dt) => {
    const now = performance.now();
    const frame = hand.current.current(now);
    const v = s.current;
    let offset: P3 = [...mover.offset] as P3, rotation: Q = mover.rotation, grabbing = false, hover = false, kind: GraspKind = 'none', anchor: P3 | null = null;
    let handPts: P3[] | null = null;
    let closeness = 0;

    const place = (frameNow: HandFrame, at: P3 | undefined, k: GraspKind, from: { x: number; y: number }) =>
      placeHandOnTwin(frameNow, placement.current, twin.model, twin.bbox, twin.feedAspect, posFlip, at, k, from)?.points ?? null;

    if (drive === 'local') {
      kind = grasp.update(frame);
      const from = frame ? grabPoint(frame, kind) : undefined;
      const tip = frame && from ? fingertipOnTwin(frame, placement.current, twin.model, twin.bbox, twin.feedAspect, posFlip, from) : null;
      closeness = grasp.ratios ? Math.min(1, Math.max(0, (0.95 - grasp.ratios.pinch) / 0.65)) : 0;
      let twist = 0, palm: Q | null = null;
      if (frame && tip && from) {
        const base = place(frame, undefined, kind, from);          // the hand's shape, to read how the fingers are turned
        if (base) { twist = twistAngle(base); palm = palmQuat(base); }
      }
      const m = mover.update(frame && tip ? { tip: tip.target, kind, depth: tipDepth(frame, placement.current), twist, palm } : null);
      offset = m.offset; rotation = m.rotation; grabbing = m.grabbing; hover = m.hover; anchor = m.anchor;
      if (frame && tip && from) handPts = place(frame, m.grabbing && m.anchor ? m.anchor : undefined, kind, from);
      // Tell the other screen where the copy is, but not more than ~15 times a second.
      const cur: TwinPose = { offset: m.offset, rotation: m.rotation, grabbing: m.grabbing, kind: m.kind, anchor: m.anchor };
      const changed = cur.grabbing !== v.sent.grabbing || cur.kind !== v.sent.kind || !same(cur.offset, v.sent.offset, 0.004) || qAngle(cur.rotation, v.sent.rotation) > 0.01;
      if (changed && now - v.sentAt > 66) { v.sent = cur; v.sentAt = now; onPose(cur); }
    } else {
      const rp = remotePose.current;
      offset = rp.offset; rotation = rp.rotation; grabbing = rp.grabbing; kind = rp.kind; anchor = rp.anchor;
      if (frame) {
        const from = grabPoint(frame, rp.kind);
        handPts = place(frame, rp.grabbing && rp.anchor ? rp.anchor : undefined, rp.kind, from);
      }
    }

    // Object: ease toward its pose, lift a little while held, and turn smoothly.
    const lift = grabbing ? 0.06 : 0;
    v.view.lerp(v.a.set(offset[0], offset[1], offset[2] + lift), 1 - Math.exp(-dt * 22));
    v.want.set(rotation[0], rotation[1], rotation[2], rotation[3]);
    v.quat.slerp(v.want, 1 - Math.exp(-dt * 20));
    objGroup.current.position.copy(v.view);
    objGroup.current.quaternion.copy(v.quat);
    objGroup.current.scale.setScalar(grabbing ? 1.04 : 1);
    outlineMats.current.forEach(m => { m.opacity = grabbing ? 0.95 : hover ? 0.7 + 0.2 * Math.sin(clock.elapsedTime * 6) : 0; m.color.set(grabbing && kind === 'grip' ? '#ff9f43' : '#fff36b'); });
    shadow.current.position.set(v.view.x, lo[1] - 0.04, v.view.z);
    shadow.current.scale.setScalar(1 + Math.max(0, v.view.y) * 0.3);
    const turnRad = qAngle(v.quat.toArray() as unknown as Q, QI);
    const moved = Math.hypot(v.view.x, v.view.y, v.view.z) > 0.05, turned = turnRad > 0.08;
    const pos = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, 0, 0, 0); pos.setXYZ(1, v.view.x, v.view.y, v.view.z); pos.needsUpdate = true; trail.computeLineDistances();
    trail.visible = moved;

    // Hand: the fingers that hold light up, and a ring closes around where they meet.
    handGroup.current.visible = !!handPts;
    if (handPts) {
      const alpha = v.fresh ? 1 - Math.exp(-dt * 24) : 1; v.fresh = true;
      handPts.forEach((p, i) => { v.pos[i].lerp(v.a.set(p[0], p[1], p[2]), alpha); joints.current[i]?.position.copy(v.pos[i]); });
      BONES.forEach(([i, j], n) => {
        const m = bones.current[n]; if (!m) return;
        v.a.copy(v.pos[i]); v.b.copy(v.pos[j]).sub(v.a);
        m.position.copy(v.a).addScaledVector(v.b, 0.5); m.scale.set(1, v.b.length(), 1); m.quaternion.setFromUnitVectors(v.up, v.b.normalize());
      });
      const holding = HOLD_FINGERS[kind];
      [4, 8, 12].forEach((f, i) => { const d = holdDots.current[i]; if (d) { d.position.copy(v.pos[f]); d.visible = kind !== 'none' ? holding.includes(f) : f === 8; } });
      v.b.set(0, 0, 0); holding.forEach(f => v.b.add(v.pos[f])); v.b.multiplyScalar(1 / holding.length);
      ring.current.position.copy(v.b);
      const r = 0.07 + 0.16 * (1 - closeness) + (kind === 'grip' ? 0.03 : 0);
      ring.current.scale.set(r, r, r);
      ring.current.visible = drive === 'local' ? (hover || grabbing || closeness > 0.2) : grabbing;
      mats.ring.opacity = grabbing ? 1 : 0.8; mats.ring.color.set(grabbing ? HOLD_COLOR[kind] : CYAN);
      mats.joint.opacity = mats.bone.opacity = 0.95;
    } else v.fresh = false;

    const mode: Mode = !frame ? 'waiting' : grabbing ? 'grab' : hover ? 'hover' : 'idle';
    status.current = { mode, kind, moved, turned, remote: drive === 'remote', angle: Math.round((turnRad * 180) / Math.PI / 5) * 5 };
    void anchor;
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
      {[0, 1, 2].map(i => <mesh key={`d${i}`} ref={el => { holdDots.current[i] = el; }} material={mats.tip}><sphereGeometry args={[0.042, 14, 14]} /></mesh>)}
      <mesh ref={ring} material={mats.ring} visible={false}><torusGeometry args={[1, 0.07, 8, 40]} /></mesh>
    </group>
  </>;
}

function Lookat() {
  useFrame(({ camera }) => camera.lookAt(0, 0, 0));
  return null;
}

const HINT: Record<Mode, string> = { none: '', waiting: 'waiting for hand', hover: 'pinch to move · grip to turn', grab: 'holding', idle: 'point at it, then pinch' };

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
  const status = useRef<BoxStatus>({ mode: 'none', kind: 'none', moved: false, turned: false, remote: false, angle: 0 });
  const [ui, setUi] = useState<BoxStatus>(status.current);
  const [resetToken, setResetToken] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setUi(prev => { const n = status.current; return prev.mode === n.mode && prev.kind === n.kind && prev.moved === n.moved && prev.turned === n.turned && prev.remote === n.remote && prev.angle === n.angle ? prev : { ...n }; }), 150);
    return () => clearInterval(id);
  }, []);
  const changed = ui.moved || ui.turned;
  const holding = ui.mode === 'grab';
  const text = ui.remote
    ? (holding ? 'friend is holding it' : changed && ui.mode !== 'waiting' ? 'moved by your friend' : ui.mode === 'waiting' ? 'waiting for hand' : 'friend is pointing')
    : holding ? (ui.kind === 'grip' ? 'gripping · turn your hand' : 'pinching · twist to turn')
    : ui.mode === 'idle' && changed ? 'moved · pinch to move again' : HINT[ui.mode];
  return <aside className="twin-box" aria-label={`3D copy of ${twin.label}`} data-mode={ui.mode} data-kind={ui.kind} data-moved={ui.moved ? '1' : '0'} data-turned={ui.turned ? '1' : '0'} data-angle={ui.angle}>
    <Canvas dpr={[1, 2]} camera={{ position: [0.5, 0.4, 3.4], fov: 40 }} gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
      <Lookat />
      <ambientLight intensity={1.2} />
      <directionalLight position={[2, 3, 4]} intensity={2} />
      <TwinScene key={twin.objectId} twin={twin} hand={hand} placement={pl} posFlip={posFlip} drive={drive} remotePose={remotePose} onPose={onPose} status={status} resetToken={resetToken} />
    </Canvas>
    {holding && <span className={`twin-badge ${ui.kind}`}>{ui.kind === 'grip' ? 'GRIP' : 'PINCH'}</span>}
    <div className="twin-label"><span>{twin.label}</span><span className="twin-status">{text}</span></div>
    {changed && drive === 'local' && <button className="twin-reset" aria-label="Put it back" title="Put it back" onClick={() => setResetToken(n => n + 1)}>↺</button>}
    <button className="twin-close" aria-label="Close 3D view" onClick={onClose}>×</button>
  </aside>;
}
