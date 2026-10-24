import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HandFrame } from '../coordinates';
import { BONES } from '../coordinates';
import { GraspDetector, grabPoint, twistAngle, type GraspKind } from '../remote/grasp';
import { pinchCloseness } from '../remote/pinch';
import { depthScale, type P3, type Placement } from '../remote/placement';
import { palmQuat, qAngle, QI, type Q } from '../remote/quat';
import type { RemoteHandState } from '../remote/remoteHand';
import { TwinRig, type Target } from '../remote/twinRig';
import { fingertipOnTwin, HOLD_FINGERS, placeHandOnTwin } from '../remote/twinPlacement';
import { REST_POSE, type TwinInfo, type TwinPose } from '../remote/twinWire';
import { componentsOf } from '../remote/components';
import { edgeGeometry, PartMesh } from './DemoScene';
import { Recorder, type Replay } from '../replay/log';

const CYAN = '#64f5ed';
const HOLD_COLOR: Record<GraspKind, string> = { none: CYAN, pinch: '#fff36b', grip: '#ff9f43' };

type Mode = 'none' | 'waiting' | 'hover' | 'grab' | 'idle';
export interface BoxStatus {
  mode: Mode; kind: GraspKind; moved: boolean; turned: boolean; remote: boolean; angle: number;
  /** what is held or hovered: 'whole', a component's name, or '' */
  target: string; partAngle: number; partMoved: boolean;
  /** which side of the index finger the thumb is on, as it appears on screen: a right hand shows 'right' in a mirror */
  thumb: 'left' | 'right' | '';
  /** how far the highest component has risen above where it sat, in hundredths of the object's height */
  partLift: number;
  /** where the first component's centre is relative to where it started, x,y,z in hundredths */
  partPos: string;
}

interface SceneProps {
  mirror: boolean; twin: TwinInfo; hand: MutableRefObject<RemoteHandState>; placement: MutableRefObject<Placement>; posFlip: boolean;
  drive: 'local' | 'remote'; remotePose: MutableRefObject<TwinPose>; onPose: (p: TwinPose) => void;
  status: MutableRefObject<BoxStatus>; resetToken: number;
  /** when set, every rendered frame's hand and pose go into it */
  recorder?: MutableRefObject<Recorder | null>;
}
export const IDLE_STATUS: BoxStatus = { mode: 'none', kind: 'none', moved: false, turned: false, remote: false, angle: 0, target: '', partAngle: 0, partMoved: false, thumb: '', partLift: 0, partPos: '' };

const shapeGeometry = (shape: string) => shape === 'box' ? new THREE.BoxGeometry(1, 1, 1) : shape === 'sphere' ? new THREE.SphereGeometry(0.5, 20, 20) : shape === 'cone' ? new THREE.ConeGeometry(0.5, 1, 24) : new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
// How close the helper's hand is to their camera (1 = reference distance); closer pulls a held object toward the viewer.
const tipDepth = (frame: HandFrame | null, pl: Placement) => frame ? depthScale(frame, pl) : 1;
const same = (a: number[], b: number[], e: number) => a.every((v, i) => Math.abs(v - b[i]) <= e);
const toQ = (q: THREE.Quaternion): Q => [q.x, q.y, q.z, q.w];
const MOVED = 0.05, TURNED = 0.08;

/** A smoothed position and orientation, so pieces glide to their pose instead of snapping. */
const view = () => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), wantPos: new THREE.Vector3(), wantQuat: new THREE.Quaternion() });

/**
 * The 3D copy and the helper's hand. The object is a whole plus separately movable pieces (the cap): pinch or grip
 * on the cap and only the cap moves or turns; do it anywhere else and the whole object does, cap included. Nothing
 * is selected first. Pinch (thumb + index) moves, and twisting spins; grip (thumb + index + middle) turns with your
 * whole hand. When the other person is the helper, this only displays the pose they send.
 */
export function TwinScene({ mirror, twin, hand, placement, posFlip, drive, remotePose, onPose, status, resetToken, recorder }: SceneProps) {
  const rig = useMemo(() => new TwinRig(twin.model), [twin.model]);
  const comps = rig.components;
  const grasp = useMemo(() => new GraspDetector(), []);
  const rootGroup = useRef<THREE.Group>(null!);
  const compGroups = useRef<(THREE.Group | null)[]>([]);
  const handGroup = useRef<THREE.Group>(null!);
  const joints = useRef<(THREE.Mesh | null)[]>([]);
  const bones = useRef<(THREE.Mesh | null)[]>([]);
  const holdDots = useRef<(THREE.Mesh | null)[]>([]);
  const ring = useRef<THREE.Mesh>(null!);
  const shadow = useRef<THREE.Mesh>(null!);
  const outlineMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const trail = useMemo(() => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.7 })), []);
  const views = useMemo(() => ({ root: view(), parts: comps.map(() => view()) }), [comps]);
  const s = useRef({ pos: Array.from({ length: 21 }, () => new THREE.Vector3()), a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fresh: false, sent: REST_POSE, sentAt: 0, firm: null as null | { tip: P3; twist: number; palm: Q | null; depth: number } });
  const mats = useMemo(() => ({ joint: new THREE.MeshBasicMaterial({ color: '#9ffcf5', transparent: true }), bone: new THREE.MeshBasicMaterial({ color: '#22d3e6', transparent: true }), tip: new THREE.MeshBasicMaterial({ color: '#ffffff' }), ring: new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, side: THREE.DoubleSide }) }), []);
  const geoms = useMemo(() => twin.model.parts.map(p => shapeGeometry(p.shape)), [twin.model]);
  const owner = useMemo(() => twin.model.parts.map((_, i) => comps.findIndex(c => c.parts.includes(i))), [twin.model, comps]); // -1: part of the body
  const bottom = useMemo(() => Math.min(...twin.model.parts.map(p => p.position[1] - p.size[1] / 2)), [twin.model]);
  const nameOf = (t: Target | null) => t === null ? '' : t === 'whole' ? 'whole' : comps[t]?.name ?? 'part';

  useEffect(() => {
    rig.reset(); const v = s.current; views.root.pos.set(0, 0, 0); views.root.quat.identity();
    views.parts.forEach((p, i) => { p.pos.set(...comps[i].center); p.quat.identity(); });
    onPose(REST_POSE); v.sent = REST_POSE;
  }, [resetToken, rig]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }, dt) => {
    const now = performance.now();
    const frame = hand.current.current(now);
    const v = s.current;
    let root = { offset: [0, 0, 0] as P3, rotation: QI as Q };
    let parts = comps.map(() => ({ offset: [0, 0, 0] as P3, rotation: QI as Q }));
    let target: Target | null = null, hover: Target | null = null, kind: GraspKind = 'none';
    let handPts: P3[] | null = null;
    let closeness = 0;
    let shown: TwinPose = REST_POSE;

    // Alone, the whole picture is mirrored (so left is left, like your selfie video), and that mirror already
    // flips the hand: flipping the shape too would draw your right hand as a left hand.
    const shapePl = mirror ? { ...placement.current, flipX: false } : placement.current;
    const place = (frameNow: HandFrame, at: P3 | undefined, k: GraspKind, from: { x: number; y: number }) =>
      placeHandOnTwin(frameNow, shapePl, twin.model, twin.bbox, twin.feedAspect, posFlip, at, k, from)?.points ?? null;

    if (drive === 'local') {
      kind = grasp.update(frame);
      const from = frame ? grabPoint(frame, kind) : undefined;
      const tip = frame && from ? fingertipOnTwin(frame, placement.current, twin.model, twin.bbox, twin.feedAspect, posFlip, from) : null;
      closeness = pinchCloseness(grasp.ratios?.pinch ?? null);
      let twist = 0, palm: Q | null = null;
      if (frame && tip && from) {
        const base = place(frame, undefined, kind, from);          // the hand's shape, to read how the fingers are turned
        if (base) { twist = twistAngle(base); palm = palmQuat(base); }
      }
      // While the fingers are opening (before the release is confirmed) hold the last firm reading, so letting go can
      // never drag the object along with the fingers' last movement.
      const opening = kind !== 'none' && (grasp.ratios?.pinch ?? 0) > 0.38;
      let reading = frame && tip ? { tip: tip.target, twist, palm, depth: tipDepth(frame, placement.current) } : null;
      if (reading && opening && v.firm) reading = v.firm; else if (reading && !opening) v.firm = reading;
      if (!frame) v.firm = null;
      const m = rig.update(reading ? { ...reading, kind } : null);
      root = m.root; parts = m.parts; target = m.target; hover = m.hover;
      if (frame && tip && from) handPts = place(frame, m.grabbing && m.anchor ? m.anchor : undefined, kind, from);
      // Tell the other screen where everything is, but not more than ~15 times a second.
      const cur: TwinPose = { offset: m.root.offset, rotation: m.root.rotation, grabbing: m.grabbing, kind: m.kind, anchor: m.anchor, parts: m.parts, target: m.target === null ? -2 : m.target === 'whole' ? -1 : m.target };
      shown = cur;
      const sent = v.sent;
      const changed = cur.grabbing !== sent.grabbing || cur.kind !== sent.kind || cur.target !== sent.target || !same(cur.offset, sent.offset, 0.004) || qAngle(cur.rotation, sent.rotation) > 0.01
        || cur.parts.some((p, i) => !sent.parts[i] || !same(p.offset, sent.parts[i].offset, 0.004) || qAngle(p.rotation, sent.parts[i].rotation) > 0.01);
      if (changed && now - v.sentAt > 66) { v.sent = cur; v.sentAt = now; onPose(cur); }
    } else {
      const rp = remotePose.current; shown = rp;
      root = { offset: rp.offset, rotation: rp.rotation };
      parts = comps.map((_, i) => rp.parts[i] ? { offset: rp.parts[i].offset, rotation: rp.parts[i].rotation } : { offset: [0, 0, 0] as P3, rotation: QI });
      target = rp.target === -2 ? null : rp.target === -1 ? 'whole' : rp.target < comps.length ? rp.target : null; kind = rp.kind;
      if (frame) handPts = place(frame, rp.grabbing && rp.anchor ? rp.anchor : undefined, rp.kind, grabPoint(frame, rp.kind));
    }
    const grabbing = target !== null;
    recorder?.current?.frame(now, frame, shown);

    // Ease every piece toward its pose; the whole lifts a little while held.
    const k = 1 - Math.exp(-dt * 22), kq = 1 - Math.exp(-dt * 20);
    const lift = grabbing ? 0.06 : 0;
    views.root.wantPos.set(root.offset[0], root.offset[1], root.offset[2] + (target === 'whole' ? lift : 0));
    views.root.wantQuat.set(...root.rotation);
    views.root.pos.lerp(views.root.wantPos, k); views.root.quat.slerp(views.root.wantQuat, kq);
    rootGroup.current.position.copy(views.root.pos); rootGroup.current.quaternion.copy(views.root.quat);
    comps.forEach((c, i) => {
      const w = views.parts[i], p = parts[i], g = compGroups.current[i]; if (!g) return;
      w.wantPos.set(c.center[0] + p.offset[0], c.center[1] + p.offset[1], c.center[2] + p.offset[2] + (target === i ? lift : 0));
      w.wantQuat.set(...p.rotation);
      w.pos.lerp(w.wantPos, k); w.quat.slerp(w.wantQuat, kq);
      g.position.copy(w.pos); g.quaternion.copy(w.quat);
    });

    // Outline whatever you are over or holding: the cap alone, or every part when it is the whole.
    const active = target ?? hover;
    outlineMats.current.forEach((m, i) => {
      const on = active !== null && (active === 'whole' || owner[i] === active);
      m.opacity = !on ? 0 : grabbing ? 0.95 : 0.7 + 0.2 * Math.sin(clock.elapsedTime * 6);
      m.color.set(grabbing && kind === 'grip' ? '#ff9f43' : '#fff36b');
    });
    shadow.current.position.set(views.root.pos.x, bottom - 0.04, views.root.pos.z);
    shadow.current.scale.setScalar(1 + Math.max(0, views.root.pos.y) * 0.3);
    const rootTurn = qAngle(toQ(views.root.quat), QI), rootMoved = views.root.pos.length() > MOVED;
    const partTurn = Math.max(0, ...views.parts.map(p => qAngle(toQ(p.quat), QI)));
    const partMoved = views.parts.some((p, i) => p.pos.distanceTo(v.a.set(...comps[i].center)) > MOVED);
    const tp = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    tp.setXYZ(0, 0, 0, 0); tp.setXYZ(1, views.root.pos.x, views.root.pos.y, views.root.pos.z); tp.needsUpdate = true; trail.computeLineDistances();
    trail.visible = rootMoved;

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
      ring.current.visible = drive === 'local' ? (hover !== null || grabbing || closeness > 0.2) : grabbing;
      mats.ring.opacity = grabbing ? 1 : 0.8; mats.ring.color.set(grabbing ? HOLD_COLOR[kind] : CYAN);
      mats.joint.opacity = mats.bone.opacity = 0.95;
    } else v.fresh = false;

    const mode: Mode = !frame ? 'waiting' : grabbing ? 'grab' : hover !== null ? 'hover' : 'idle';
    status.current = { mode, kind, moved: rootMoved, turned: rootTurn > TURNED, remote: drive === 'remote', angle: Math.round((rootTurn * 180) / Math.PI / 5) * 5, target: nameOf(active), partAngle: Math.round((partTurn * 180) / Math.PI / 5) * 5, partMoved,
      partPos: views.parts[0] ? [0, 1, 2].map(i => Math.round(([views.parts[0].pos.x, views.parts[0].pos.y, views.parts[0].pos.z][i] - comps[0].center[i]) * 100)).join(',') : '',
      partLift: Math.round(Math.max(0, ...views.parts.map((p, i) => p.pos.y - comps[i].center[1])) * 20) * 5,
      thumb: handPts ? ((v.pos[4].x - v.pos[8].x) * (mirror ? -1 : 1) > 0 ? 'right' : 'left') : '' };
  });

  const partMesh = (i: number, offset?: P3) => <PartMesh key={i} part={twin.model.parts[i]} offset={offset} solid />;
  const outline = (i: number, offset?: P3) => {
    const p = twin.model.parts[i], o = offset ?? [0, 0, 0];
    return <mesh key={`h${i}`} position={[p.position[0] - o[0], p.position[1] - o[1], p.position[2] - o[2]]} scale={[p.size[0] * 1.08, p.size[1] * 1.08, p.size[2] * 1.08]} geometry={geoms[i]}>
      <meshBasicMaterial ref={m => { if (m) outlineMats.current[i] = m; }} color="#fff36b" side={THREE.BackSide} transparent opacity={0} depthWrite={false} />
    </mesh>;
  };
  return <>
    <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.38, 32]} /><meshBasicMaterial color="#000" transparent opacity={0.28} depthWrite={false} /></mesh>
    {/* Where everything started, as outlines, with a dashed line to where the whole is now. */}
    {twin.model.parts.map((p, i) => <lineSegments key={`o${i}`} geometry={edgeGeometry[p.shape]} position={p.position} scale={p.size}><lineBasicMaterial color="#ffffff" transparent opacity={0.4} /></lineSegments>)}
    <primitive object={trail} />
    <group ref={rootGroup}>
      {twin.model.parts.map((_, i) => owner[i] < 0 ? <group key={i}>{partMesh(i)}{outline(i)}</group> : null)}
      {comps.map((c, ci) => <group key={`c${ci}`} ref={el => { compGroups.current[ci] = el; }} position={c.center}>
        {c.parts.map(i => <group key={i}>{partMesh(i, c.center)}{outline(i, c.center)}</group>)}
      </group>)}
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

/**
 * Small grey box with a 3D copy of the object the helper is pointing at, and the helper's hand on it.
 * The view is fixed (no spinning) so the hand's position on the object stays meaningful.
 * `mirror` flips the picture like a selfie view: alone, you watch yourself in a mirror, so the copy and your hand
 * must move the way your mirrored video does (move left, the hand goes left).
 */
export function TwinBox({ twin, hand, placement, posFlip, mirror = false, drive, remotePose, onPose, onClose, onRecorded }: {
  twin: TwinInfo; hand: MutableRefObject<RemoteHandState>; placement: Placement; posFlip: boolean; mirror?: boolean;
  drive: 'local' | 'remote'; remotePose: MutableRefObject<TwinPose>; onPose: (p: TwinPose) => void; onClose: () => void;
  /** a finished recording of what this box showed */
  onRecorded?: (r: Replay) => void;
}) {
  const pl = useRef(placement);
  useEffect(() => { pl.current = placement; }, [placement]);
  const status = useRef<BoxStatus>(IDLE_STATUS);
  const recorder = useRef<Recorder | null>(null);
  const [recSecs, setRecSecs] = useState<number | null>(null);
  const recStart = useRef(0);
  const stopRecording = () => { const r = recorder.current; if (!r) return; recorder.current = null; setRecSecs(null); onRecorded?.(r.finish(performance.now())); };
  const startRecording = () => { recStart.current = performance.now(); recorder.current = new Recorder(recStart.current, { twin, mirror, posFlip, placement: pl.current }); setRecSecs(0); };
  const stopRef = useRef(stopRecording); stopRef.current = stopRecording;
  // A different object (or closing the box) ends the recording rather than losing it.
  useEffect(() => () => stopRef.current(), [twin.objectId]);
  useEffect(() => {
    if (recSecs === null) return;
    const id = window.setInterval(() => { if (recorder.current?.full) stopRef.current(); else setRecSecs(Math.floor((performance.now() - recStart.current) / 1000)); }, 250);
    return () => clearInterval(id);
  }, [recSecs === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ui, setUi] = useState<BoxStatus>(status.current);
  const [resetToken, setResetToken] = useState(0);
  const [big, setBig] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setUi(prev => { const n = status.current; return (Object.keys(n) as (keyof BoxStatus)[]).every(k => prev[k] === n[k]) ? prev : { ...n }; }), 150);
    return () => clearInterval(id);
  }, []);
  const changed = ui.moved || ui.turned || ui.partMoved || ui.partAngle > 0;
  const holding = ui.mode === 'grab';
  const partNames = useMemo(() => componentsOf(twin.model).map(c => c.name), [twin.model]);
  // Short on purpose: the small box is only ~30 characters wide.
  const what = ui.target === 'whole' ? 'the whole' : `the ${ui.target}`;
  const text = ui.remote
    ? (holding ? `friend holds ${what}` : changed && ui.mode !== 'waiting' ? 'moved by your friend' : ui.mode === 'waiting' ? 'waiting for hand' : 'friend is pointing')
    : holding ? `${ui.kind === 'grip' ? 'gripping' : 'pinching'} ${what}`
    : ui.mode === 'hover' ? `pinch ${what}` : ui.mode === 'idle' && changed ? 'moved · pinch to move again' : ui.mode === 'waiting' ? 'waiting for hand' : partNames.length ? `pinch the ${partNames[0]} or the whole` : 'point at it, then pinch';
  return <aside className={`twin-box ${mirror ? 'mirror' : ''} ${big ? 'big' : ''}`} aria-label={`3D copy of ${twin.label}`} data-mode={ui.mode} data-kind={ui.kind} data-moved={ui.moved ? '1' : '0'} data-turned={ui.turned ? '1' : '0'} data-angle={ui.angle} data-target={ui.target} data-part-angle={ui.partAngle} data-part-moved={ui.partMoved ? '1' : '0'} data-big={big ? '1' : '0'} data-thumb={ui.thumb} data-part-lift={ui.partLift} data-part-pos={ui.partPos}>
    <Canvas dpr={[1, 2]} camera={{ position: [0.5, 0.4, 3.4], fov: 40 }} gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
      <Lookat />
      <ambientLight intensity={1.2} />
      <directionalLight position={[2, 3, 4]} intensity={2} />
      <TwinScene key={twin.objectId} mirror={mirror} twin={twin} hand={hand} placement={pl} posFlip={posFlip} drive={drive} remotePose={remotePose} onPose={onPose} status={status} resetToken={resetToken} recorder={recorder} />
    </Canvas>
    {recSecs !== null && <span className="twin-rec" role="status">● REC {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}</span>}
    {holding && <span className={`twin-badge ${ui.kind}`}>{ui.kind === 'grip' ? 'GRIP' : 'PINCH'}</span>}
    <div className="twin-label"><span>{twin.label}</span><span className="twin-status">{text}</span></div>
    <div className="twin-tools">
      {onRecorded && <button className={`twin-tool ${recSecs !== null ? 'recording' : ''}`} aria-label={recSecs !== null ? 'Stop recording' : 'Record a tutorial'} aria-pressed={recSecs !== null} title={recSecs !== null ? 'Stop recording' : 'Record a tutorial'} onClick={recSecs !== null ? stopRecording : startRecording}>{recSecs !== null ? '■' : '●'}</button>}
      <button className="twin-tool" aria-label={big ? 'Make it smaller' : 'Make it bigger'} aria-pressed={big} title={big ? 'Make it smaller' : 'Make it bigger'} onClick={() => setBig(b => !b)}>{big ? '⤡' : '⤢'}</button>
      {changed && drive === 'local' && <button className="twin-tool" aria-label="Put it back" title="Put it back" onClick={() => setResetToken(n => n + 1)}>↺</button>}
      <button className="twin-tool" aria-label="Close 3D view" onClick={onClose}>×</button>
    </div>
  </aside>;
}
