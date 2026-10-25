import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HandFrame } from '../coordinates';
import { BONES } from '../coordinates';
import { GrabGate } from '../remote/grabGate';
import { GraspDetector, grabPoint, twistAngle, type GraspKind } from '../remote/grasp';
import { OneEuro } from '../remote/oneEuro';
import { pinchCloseness } from '../remote/pinch';
import { depthScale, type P3, type Placement } from '../remote/placement';
import { palmQuat, qAngle, QI, type Q } from '../remote/quat';
import { CLAW, isLanyard, KitRig, lanyardProfile, seatOffset, type KitState } from '../remote/kitRig';
import { TwinRig, type Hold, type Rig, type Target } from '../remote/twinRig';
import type { MoveInput } from '../remote/twinMove';
import { fingertipOnTwin, HOLD_FINGERS, placeHandOnTwin } from '../remote/twinPlacement';
import { REST_POSE, type TwinInfo, type TwinPose } from '../remote/twinWire';
import { componentsOf } from '../remote/components';
import type { ScanFrame } from '../useSceneScan';
import { edgeGeometry, PartMesh } from './DemoScene';
import type { FittedMesh, MeshPiece } from './meshFit';
import { useTwinMesh } from './useTwinMesh';

const CYAN = '#64f5ed';
const HOLD_COLOR: Record<GraspKind, string> = { none: CYAN, pinch: '#fff36b', grip: '#ff9f43' };
const SLOTS = [0, 1] as const;
// The second hand is tinted so you can tell the two apart.
const HAND_COLORS = [{ joint: '#9ffcf5', bone: '#22d3e6' }, { joint: '#e1d4ff', bone: '#a78bfa' }];

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
  /** hands in view, and what the second one is doing */
  hands: number; kind2: GraspKind; target2: string;
  /** how far the screwed-on piece in hand (or under a hand) is unscrewed, 0-100, or -1 */
  unscrew: number;
  /** the lanyard: '' (not one), the clasp is 'apart' from the card, its claw is 'open', 'near' the hole, or clipped 'on' */
  kit: '' | 'apart' | 'open' | 'near' | 'on';
  /** it clipped on in the last moment (for the "clipped on" message) */
  kitJust: boolean;
}

/** Where the hands come from: the live tracker or the friend's stream (RemoteHandState), or a replay. */
export interface HandSource { current(now: number, slot: 0 | 1): HandFrame | null }
interface SceneProps {
  mirror: boolean; twin: TwinInfo; hand: MutableRefObject<HandSource>; placement: MutableRefObject<Placement>; posFlip: boolean;
  drive: 'local' | 'remote'; remotePose: MutableRefObject<TwinPose>; onPose: (p: TwinPose) => void;
  status: MutableRefObject<BoxStatus>; resetToken: number;
  /** the SAM 3D mesh, cut into the same pieces as the model; null = draw the model's shapes */
  mesh: FittedMesh | null;
  /** a flick upward while holding it: throw it to the friend */
  onThrow?: () => void;
}

const toLinear = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** A piece of the SAM 3D mesh, in its scanned colours. Reports its material so it can glow when a hand is on it. */
function MeshView({ piece, onMat }: { piece: MeshPiece; onMat: (m: THREE.MeshStandardMaterial | null) => void }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(piece.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(piece.colors, toLinear), 3)); // the scan's colours are sRGB
    g.setIndex(new THREE.BufferAttribute(piece.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [piece]);
  useEffect(() => () => geom.dispose(), [geom]);
  return <mesh geometry={geom}><meshStandardMaterial ref={onMat} vertexColors side={THREE.DoubleSide} roughness={0.7} metalness={0.05} emissive="#fff36b" emissiveIntensity={0} /></mesh>;
}
const METAL = { color: '#d5dae2', metalness: 0.85, roughness: 0.28 };
const GAP = 1.1; // the claw's opening, radians of its ring
/**
 * The lobster claw, hanging from the clasp at `at`: a ring with a gap that a spring gate closes. The gate swings in about
 * its lower hinge as `state.gate` goes from 0 (shut) to 1 (open). Drawn, not scanned: a scan of small shiny metal is a
 * blob, and a scan cannot open.
 */
function LobsterClaw({ at, state }: { at: P3; state: MutableRefObject<KitState> }) {
  const gate = useRef<THREE.Group>(null!), glow = useRef<THREE.MeshStandardMaterial[]>([]);
  const { r, tube, stem } = CLAW, hinge: P3 = [r * Math.cos(-GAP / 2), r * Math.sin(-GAP / 2), 0];
  useFrame(({ clock }) => {
    const k = state.current;
    if (gate.current) gate.current.rotation.z = k.gate * 1.05;
    const snap = k.sinceJoin >= 0 && k.sinceJoin < 700 ? 1 - k.sinceJoin / 700 : 0;
    glow.current.forEach(m => { m.emissive.set(snap > 0 ? '#7dffb2' : '#64f5ed'); m.emissiveIntensity = snap > 0 ? snap : k.near ? 0.35 + 0.25 * Math.sin(clock.elapsedTime * 10) : 0; });
  });
  const mat = (i: number) => <meshStandardMaterial ref={m => { if (m) glow.current[i] = m; }} {...METAL} emissive="#64f5ed" emissiveIntensity={0} />;
  return <group position={at} rotation={[0, 0.9, 0]}>
    <mesh position={[0, -stem / 2, 0]}><cylinderGeometry args={[tube * 1.3, tube * 1.3, stem, 10]} />{mat(0)}</mesh>
    <group position={[0, -stem - r, 0]}>
      <mesh rotation={[0, 0, GAP / 2]}><torusGeometry args={[r, tube, 10, 40, 2 * Math.PI - GAP]} />{mat(1)}</mesh>
      <group ref={gate} position={hinge}>
        <mesh position={[-hinge[0], -hinge[1], 0]} rotation={[0, 0, -GAP / 2]}><torusGeometry args={[r, tube * 0.85, 8, 12, GAP]} />{mat(2)}</mesh>
        <mesh position={[0.008, r * Math.sin(GAP / 2), 0]}><boxGeometry args={[0.02, 0.014, 0.02]} />{mat(3)}</mesh>
      </group>
    </group>
  </group>;
}
const STRAP = { color: '#3a63d6', width: 0.05, segments: 28, spread: 0.2, top: 1.75 };
/**
 * The lanyard's strap, so the clasp is never a lone claw: two ribbons from the top of the clasp up out of the box, as if
 * worn around a neck. The bottom end is read from the clasp's live transform every frame, so the strap stays attached
 * through carrying, swinging, unclipping and clipping back; the top ends stay put, off screen.
 */
function Strap({ clasp, at }: { clasp: MutableRefObject<(THREE.Group | null)[]>; at: P3 }) {
  const N = STRAP.segments;
  const geoms = useMemo(() => [0, 1].map(() => {
    const g = new THREE.BufferGeometry(), idx: number[] = [];
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 6), 3));
    for (let i = 0; i < N; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    return g;
  }), [N]);
  useEffect(() => () => geoms.forEach(g => g.dispose()), [geoms]);
  const v = useMemo(() => ({ bottom: new THREE.Vector3(), top: new THREE.Vector3(), ctrl: new THREE.Vector3(), pt: new THREE.Vector3(), tan: new THREE.Vector3(), side: new THREE.Vector3(), view: new THREE.Vector3(0, 0, 1) }), []);
  useFrame(() => {
    const g = clasp.current[0]; if (!g) return;
    g.updateWorldMatrix(true, false);
    const b = v.bottom.set(...at).applyMatrix4(g.matrixWorld);
    [-1, 1].forEach((dir, s) => {
      // A gentle curve outward from the clasp to its anchor above the box.
      v.top.set(dir * STRAP.spread, STRAP.top, b.z - 0.08);
      v.ctrl.set(b.x + dir * 0.03 + (v.top.x - b.x) * 0.25, b.y + (v.top.y - b.y) * 0.5, (b.z + v.top.z) / 2);
      const pos = geoms[s].getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= N; i++) {
        const t = i / N, u = 1 - t;
        v.pt.set(u * u * b.x + 2 * u * t * v.ctrl.x + t * t * v.top.x + dir * 0.008 * u, u * u * b.y + 2 * u * t * v.ctrl.y + t * t * v.top.y, u * u * b.z + 2 * u * t * v.ctrl.z + t * t * v.top.z);
        v.tan.set(2 * u * (v.ctrl.x - b.x) + 2 * t * (v.top.x - v.ctrl.x), 2 * u * (v.ctrl.y - b.y) + 2 * t * (v.top.y - v.ctrl.y), 2 * u * (v.ctrl.z - b.z) + 2 * t * (v.top.z - v.ctrl.z));
        v.side.crossVectors(v.tan, v.view).normalize().multiplyScalar(STRAP.width / 2);
        pos.setXYZ(2 * i, v.pt.x - v.side.x, v.pt.y - v.side.y, v.pt.z - v.side.z);
        pos.setXYZ(2 * i + 1, v.pt.x + v.side.x, v.pt.y + v.side.y, v.pt.z + v.side.z);
      }
      pos.needsUpdate = true; geoms[s].computeVertexNormals(); geoms[s].computeBoundingSphere();
    });
  });
  return <>{geoms.map((g, i) => <mesh key={i} geometry={g} frustumCulled={false}><meshStandardMaterial color={STRAP.color} side={THREE.DoubleSide} roughness={0.85} /></mesh>)}</>;
}
/** The card's slot: dark, and it lights up when the open claw is close enough to clip on. */
function Slot({ at, state }: { at: P3; state: MutableRefObject<KitState> }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(({ clock }) => { const k = state.current; if (mat.current) mat.current.color.set(k.near ? (Math.sin(clock.elapsedTime * 10) > 0 ? '#64f5ed' : '#2a7f7a') : '#1d2228'); });
  return <mesh position={[at[0], at[1], at[2] + 0.003]}><planeGeometry args={[0.1, 0.028]} /><meshBasicMaterial ref={mat} color="#1d2228" side={THREE.DoubleSide} /></mesh>;
}
export const IDLE_STATUS: BoxStatus = { mode: 'none', kind: 'none', moved: false, turned: false, remote: false, angle: 0, target: '', partAngle: 0, partMoved: false, thumb: '', partLift: 0, partPos: '', hands: 0, kind2: 'none', target2: '', unscrew: -1, kit: '', kitJust: false };

const shapeGeometry = (shape: string) => shape === 'box' ? new THREE.BoxGeometry(1, 1, 1) : shape === 'sphere' ? new THREE.SphereGeometry(0.5, 20, 20) : shape === 'cone' ? new THREE.ConeGeometry(0.5, 1, 24) : new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
// How close the helper's hand is to their camera (1 = reference distance); closer pulls a held object toward the viewer.
const tipDepth = (frame: HandFrame | null, pl: Placement) => frame ? depthScale(frame, pl) : 1;
const same = (a: number[], b: number[], e: number) => a.every((v, i) => Math.abs(v - b[i]) <= e);
const toQ = (q: THREE.Quaternion): Q => [q.x, q.y, q.z, q.w];
const MOVED = 0.05, TURNED = 0.08;
// Two hands working close together hide each other from the tracker for a few frames: a hand that is holding something
// and vanishes keeps its last real reading this long before the hold ends.
const HOLD_GRACE_MS = 350;
const IDLE: Hold = { target: null, hover: null, grabbing: false, kind: 'none', anchor: null };
// A throw: the holding hand's fingertip moving up the camera image this fast (image heights per second, smoothed).
// Lifting the clasp off the card is much slower than this.
const FLICK = 2.2;

/** A smoothed position and orientation, so pieces glide to their pose instead of snapping. */
const view = () => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), wantPos: new THREE.Vector3(), wantQuat: new THREE.Quaternion() });

/**
 * The 3D copy and up to two hands. The object is a whole plus separately movable pieces (the cap): pinch or grip on the
 * cap and only the cap moves or turns; do it anywhere else and the whole object does, cap included. Nothing is selected
 * first, and each hand can hold a different piece (steady the bottle with one, twist the cap with the other). A fist
 * goes for the body and fingertips for the piece; a cap has to be twisted loose before it can be pulled off.
 * Pinch (thumb + index) moves, and twisting spins; grip (thumb + index + middle) turns with your whole hand.
 * A grab only starts when it is deliberate (see GrabGate), so waving a hand about does nothing.
 * When the other person is the helper, this only displays the pose they send.
 */
export function TwinScene({ mirror, twin, hand, placement, posFlip, drive, remotePose, onPose, status, resetToken, mesh, onThrow }: SceneProps) {
  // With a scanned mesh, the hands work on the mesh's own shape (see fitToModel), so they land on what you see.
  const model = mesh?.model ?? twin.model;
  // A lanyard is two pieces that clip together (KitRig); anything else is a whole with parts (TwinRig).
  const kitProfile = useMemo(() => (isLanyard(twin.label) && componentsOf(model).length ? mesh?.kit ?? lanyardProfile(model) : null), [twin.label, model, mesh]);
  const rig: Rig = useMemo(() => (kitProfile ? new KitRig(model, kitProfile) : new TwinRig(model)), [model, kitProfile]);
  const kit = useRef<KitState>({ joined: false, gate: 0, near: false, sinceJoin: -1 });
  const comps = rig.components;
  const grasps = useMemo(() => SLOTS.map(() => new GraspDetector()), []);
  const gates = useMemo(() => SLOTS.map(() => new GrabGate()), []);
  const smooth = useMemo(() => SLOTS.map(() => ({ x: new OneEuro(1.4, 0.5), y: new OneEuro(1.4, 0.5) })), []);
  const rootGroup = useRef<THREE.Group>(null!);
  const compGroups = useRef<(THREE.Group | null)[]>([]);
  const hg = useRef(SLOTS.map(() => ({ group: null as THREE.Group | null, joints: [] as (THREE.Mesh | null)[], bones: [] as (THREE.Mesh | null)[], dots: [] as (THREE.Mesh | null)[], ring: null as THREE.Mesh | null })));
  const shadow = useRef<THREE.Mesh>(null!);
  const outlineMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const meshMats = useRef(new Map<number, THREE.MeshStandardMaterial>()); // -1: the body, else a component
  const ghosts = useRef<(THREE.LineSegments | null)[]>([]);
  const trail = useMemo(() => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.7 })), []);
  const views = useMemo(() => ({ root: view(), parts: comps.map(() => view()) }), [comps]);
  const s = useRef({
    pos: SLOTS.map(() => Array.from({ length: 21 }, () => new THREE.Vector3())), fresh: [false, false], a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
    sent: REST_POSE, sentAt: 0, holding: [false, false], firm: [null, null] as (null | { tip: P3; twist: number; palm: Q | null; depth: number })[],
    last: [null, null] as (MoveInput | null)[], lastAt: [0, 0],
    flick: SLOTS.map(() => ({ y: 0, t: 0, vy: 0 })), thrown: false,
  });
  const mats = useMemo(() => SLOTS.map(sl => ({ joint: new THREE.MeshBasicMaterial({ color: HAND_COLORS[sl].joint, transparent: true }), bone: new THREE.MeshBasicMaterial({ color: HAND_COLORS[sl].bone, transparent: true }), tip: new THREE.MeshBasicMaterial({ color: '#ffffff' }), ring: new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, side: THREE.DoubleSide }) })), []);
  const geoms = useMemo(() => model.parts.map(p => shapeGeometry(p.shape)), [model]);
  const owner = useMemo(() => model.parts.map((_, i) => comps.findIndex(c => c.parts.includes(i))), [model, comps]); // -1: part of the body
  const bottom = useMemo(() => Math.min(...model.parts.map(p => p.position[1] - p.size[1] / 2)), [model]);
  const nameOf = (t: Target | null) => t === null ? '' : t === 'whole' ? 'whole' : comps[t]?.name ?? 'part';

  useEffect(() => {
    rig.reset(); const v = s.current; views.root.pos.set(0, 0, 0); views.root.quat.identity();
    views.parts.forEach((p, i) => { p.pos.set(...comps[i].center); p.quat.identity(); });
    gates.forEach(g => g.reset());
    onPose(REST_POSE); v.sent = REST_POSE;
  }, [resetToken, rig]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }, dt) => {
    const now = performance.now(), tSec = now / 1000;
    const v = s.current;
    let root = { offset: [0, 0, 0] as P3, rotation: QI as Q };
    let parts = comps.map(() => ({ offset: [0, 0, 0] as P3, rotation: QI as Q }));
    let holds: [Hold, Hold] = [IDLE, IDLE];
    const frames: (HandFrame | null)[] = SLOTS.map(sl => hand.current.current(now, sl));
    const handPts: (P3[] | null)[] = [null, null];
    const closeness = [0, 0];
    let shown: TwinPose = REST_POSE;

    // Alone, the whole picture is mirrored (so left is left, like your selfie video), and that mirror already
    // flips the hand: flipping the shape too would draw your right hand as a left hand.
    const shapePl = mirror ? { ...placement.current, flipX: false } : placement.current;
    const place = (f: HandFrame, at: P3 | undefined, from: { x: number; y: number }) =>
      placeHandOnTwin(f, shapePl, model, twin.bbox, twin.feedAspect, posFlip, at, 'none', from)?.points ?? null;

    if (drive === 'local') {
      const inputs: [MoveInput | null, MoveInput | null] = [null, null];
      const froms: ({ x: number; y: number } | undefined)[] = [undefined, undefined];
      SLOTS.forEach(sl => {
        const frame = frames[sl];
        if (!frame && v.holding[sl] && v.last[sl] && now - v.lastAt[sl] < HOLD_GRACE_MS) { inputs[sl] = v.last[sl]; return; }
        const raw = grasps[sl].update(frame);
        const from = frame ? grabPoint(frame, raw) : undefined; froms[sl] = from;
        const tip = frame && from ? fingertipOnTwin(frame, placement.current, model, twin.bbox, twin.feedAspect, posFlip, from) : null;
        closeness[sl] = pinchCloseness(grasps[sl].ratios?.pinch ?? null);
        if (!frame || !tip || !from) { v.firm[sl] = null; v.last[sl] = null; gates[sl].reset(); smooth[sl].x.reset(); smooth[sl].y.reset(); return; }
        // Steady the fingertip a little (heavier when still, lighter when moving fast).
        const tipS: P3 = [smooth[sl].x.filter(tip.target[0], tSec), smooth[sl].y.filter(tip.target[1], tSec), tip.target[2]];
        let twist = 0, palm: Q | null = null;
        const base = place(frame, undefined, from);            // the hand's shape, to read how the fingers are turned
        if (base) { twist = twistAngle(base); palm = palmQuat(base); }
        // A grab is only deliberate if the hand was open, over a part, and closing slowly: waving does nothing.
        const kind = gates[sl].filter({ now, kind: raw, tip: { x: tipS[0], y: tipS[1] }, hovering: rig.hoverAt(tipS, sl, raw) !== null, grabbing: v.holding[sl] });
        // While the fingers are opening (before the release is confirmed) hold the last firm reading, so letting go can
        // never drag the object along with the fingers' last movement.
        const opening = kind !== 'none' && (grasps[sl].ratios?.pinch ?? 0) > 0.38;
        let reading = { tip: tipS, twist, palm, depth: tipDepth(frame, placement.current) };
        if (opening && v.firm[sl]) reading = v.firm[sl]!; else if (!opening) v.firm[sl] = reading;
        inputs[sl] = { ...reading, kind }; v.last[sl] = inputs[sl]; v.lastAt[sl] = now;
      });
      const m = rig.step(inputs);
      v.holding = [m.holds[0].grabbing, m.holds[1].grabbing];
      root = m.root; parts = m.parts; holds = m.holds;
      SLOTS.forEach(sl => {
        const f = frames[sl], fl = v.flick[sl];
        if (!f || !m.holds[sl].grabbing) { fl.t = 0; fl.vy = 0; return; }
        const y = f.landmarks[8].y;
        if (fl.t && now > fl.t) fl.vy = 0.6 * fl.vy + 0.4 * ((y - fl.y) * 1000) / (now - fl.t);
        fl.y = y; fl.t = now;
        if (fl.vy < -FLICK && onThrow && !v.thrown) { v.thrown = true; onThrow(); }
      });
      SLOTS.forEach(sl => { const f = frames[sl], fr = froms[sl]; if (f && fr) handPts[sl] = place(f, m.holds[sl].grabbing && m.holds[sl].anchor ? m.holds[sl].anchor! : undefined, fr); });
      // Tell the other screen where everything is, but not more than ~15 times a second.
      if (rig instanceof KitRig) kit.current = { ...rig.kit };
      const cur: TwinPose = {
        offset: m.root.offset, rotation: m.root.rotation, grabbing: m.holds[0].grabbing, kind: m.holds[0].kind, anchor: m.holds[0].anchor, parts: m.parts,
        target: m.holds[0].target === null ? -2 : m.holds[0].target === 'whole' ? -1 : m.holds[0].target,
        second: { target: m.holds[1].target === null ? -2 : m.holds[1].target === 'whole' ? -1 : m.holds[1].target, kind: m.holds[1].kind, anchor: m.holds[1].anchor },
        ...(rig instanceof KitRig ? { kit: { joined: rig.kit.joined, gate: rig.kit.gate, near: rig.kit.near } } : {}),
      };
      shown = cur;
      const sent = v.sent;
      const changed = cur.grabbing !== sent.grabbing || cur.kind !== sent.kind || cur.target !== sent.target || !same(cur.offset, sent.offset, 0.004) || qAngle(cur.rotation, sent.rotation) > 0.01
        || cur.parts.some((p, i) => !sent.parts[i] || !same(p.offset, sent.parts[i].offset, 0.004) || qAngle(p.rotation, sent.parts[i].rotation) > 0.01)
        || cur.second!.target !== (sent.second?.target ?? -2) || cur.second!.kind !== (sent.second?.kind ?? 'none')
        || (!!cur.kit && (!sent.kit || cur.kit.joined !== sent.kit.joined || cur.kit.near !== sent.kit.near || Math.abs(cur.kit.gate - sent.kit.gate) > 0.05));
      if (changed && now - v.sentAt > 66) { v.sent = cur; v.sentAt = now; onPose(cur); }
    } else {
      const rp = remotePose.current; shown = rp;
      if (rp.kit) { const was = kit.current; kit.current = { ...rp.kit, sinceJoin: rp.kit.joined ? (was.joined ? (was.sinceJoin < 0 ? -1 : was.sinceJoin + dt * 1000) : 0) : -1 }; }
      root = { offset: rp.offset, rotation: rp.rotation };
      // Before any pose arrives, a lanyard shows clipped together, as it starts.
      parts = comps.map((_, i) => rp.parts[i] ? { offset: rp.parts[i].offset, rotation: rp.parts[i].rotation } : { offset: i === 0 && kitProfile ? seatOffset(kitProfile) : [0, 0, 0] as P3, rotation: QI });
      const asTarget = (t: number): Target | null => (t === -2 ? null : t === -1 ? 'whole' : t < comps.length ? t : null);
      holds = [
        { target: asTarget(rp.target), hover: null, grabbing: rp.grabbing, kind: rp.kind, anchor: rp.anchor },
        rp.second ? { target: asTarget(rp.second.target), hover: null, grabbing: rp.second.target !== -2, kind: rp.second.kind, anchor: rp.second.anchor } : IDLE,
      ];
      SLOTS.forEach(sl => { const f = frames[sl]; if (f) handPts[sl] = place(f, holds[sl].grabbing && holds[sl].anchor ? holds[sl].anchor! : undefined, grabPoint(f, holds[sl].kind)); });
    }
    const grabbing = holds.some(h => h.grabbing);
    const holdsWhole = holds.some(h => h.target === 'whole');

    // Ease every piece toward its pose; a held piece lifts a little.
    const k = 1 - Math.exp(-dt * 22), kq = 1 - Math.exp(-dt * 20);
    const lift = 0.06;
    views.root.wantPos.set(root.offset[0], root.offset[1], root.offset[2] + (holdsWhole ? lift : 0));
    views.root.wantQuat.set(...root.rotation);
    views.root.pos.lerp(views.root.wantPos, k); views.root.quat.slerp(views.root.wantQuat, kq);
    rootGroup.current.position.copy(views.root.pos); rootGroup.current.quaternion.copy(views.root.quat);
    comps.forEach((c, i) => {
      const w = views.parts[i], p = parts[i], g = compGroups.current[i]; if (!g) return;
      w.wantPos.set(c.center[0] + p.offset[0], c.center[1] + p.offset[1], c.center[2] + p.offset[2] + (holds.some(h => h.target === i) ? lift : 0));
      w.wantQuat.set(...p.rotation);
      w.pos.lerp(w.wantPos, k); w.quat.slerp(w.wantQuat, kq);
      g.position.copy(w.pos); g.quaternion.copy(w.quat);
    });

    // Outline whatever either hand is over or holding: the cap alone, or every part when it is the whole.
    const active = holds.map(h => h.target ?? h.hover);
    outlineMats.current.forEach((m, i) => {
      const on = active.some(a => a !== null && (a === 'whole' || owner[i] === a));
      const heldGrip = holds.some(h => h.grabbing && h.kind === 'grip' && (h.target === 'whole' || owner[i] === h.target));
      m.opacity = !on ? 0 : grabbing ? 0.95 : 0.7 + 0.2 * Math.sin(clock.elapsedTime * 6);
      m.color.set(heldGrip ? '#ff9f43' : '#fff36b');
    });
    // The mesh glows instead: an outline of a scanned shape would just be a second copy of it.
    meshMats.current.forEach((m, who) => {
      const on = active.some(a => a !== null && (a === 'whole' || a === who));
      const heldGrip = holds.some(h => h.grabbing && h.kind === 'grip' && (h.target === 'whole' || h.target === who));
      m.emissiveIntensity = !on ? 0 : grabbing ? 0.16 : 0.1 + 0.05 * Math.sin(clock.elapsedTime * 6);
      m.emissive.set(heldGrip ? '#ff9f43' : '#fff36b');
    });
    shadow.current.position.set(views.root.pos.x, bottom - 0.04, views.root.pos.z);
    shadow.current.scale.setScalar(1 + Math.max(0, views.root.pos.y) * 0.3);
    const rootTurn = qAngle(toQ(views.root.quat), QI), rootMoved = views.root.pos.length() > MOVED;
    const partTurn = Math.max(0, ...views.parts.map(p => qAngle(toQ(p.quat), QI)));
    const partMoved = views.parts.some((p, i) => p.pos.distanceTo(v.a.set(...comps[i].center)) > MOVED);
    const tp = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    tp.setXYZ(0, 0, 0, 0); tp.setXYZ(1, views.root.pos.x, views.root.pos.y, views.root.pos.z); tp.needsUpdate = true; trail.computeLineDistances();
    trail.visible = rootMoved && !kitProfile; // a lanyard's card swings about: a trail from where it began says nothing
    // The white "where it started" outline is for moving the whole object. For a lifted cap it only looked like the bottle still had one.
    ghosts.current.forEach((g, i) => { if (g) g.visible = owner[i] < 0 && rootMoved && !mesh && !kitProfile; }); // box outlines around a scanned mesh would only confuse

    // Hands: the fingers that hold light up, and a ring closes around where they meet.
    SLOTS.forEach(sl => {
      const h = hg.current[sl], pts = handPts[sl], pos = v.pos[sl], hold = holds[sl];
      if (!h.group) return;
      h.group.visible = !!pts;
      if (!pts) { v.fresh[sl] = false; return; }
      const alpha = v.fresh[sl] ? 1 - Math.exp(-dt * 24) : 1; v.fresh[sl] = true;
      pts.forEach((p, i) => { pos[i].lerp(v.a.set(p[0], p[1], p[2]), alpha); h.joints[i]?.position.copy(pos[i]); });
      BONES.forEach(([i, j], n) => {
        const m = h.bones[n]; if (!m) return;
        v.a.copy(pos[i]); v.b.copy(pos[j]).sub(v.a);
        m.position.copy(v.a).addScaledVector(v.b, 0.5); m.scale.set(1, v.b.length(), 1); m.quaternion.setFromUnitVectors(v.up, v.b.normalize());
      });
      const rawKind = drive === 'local' ? grasps[sl].kind : hold.kind;
      const holding = HOLD_FINGERS[rawKind];
      [4, 8, 12].forEach((f, i) => { const d = h.dots[i]; if (d) { d.position.copy(pos[f]); d.visible = rawKind !== 'none' ? holding.includes(f) : f === 8; } });
      if (h.ring) {
        v.b.set(0, 0, 0); holding.forEach(f => v.b.add(pos[f])); v.b.multiplyScalar(1 / holding.length);
        h.ring.position.copy(v.b);
        const r = 0.07 + 0.16 * (1 - closeness[sl]) + (rawKind === 'grip' ? 0.03 : 0);
        h.ring.scale.set(r, r, r);
        h.ring.visible = drive === 'local' ? (hold.hover !== null || hold.grabbing || closeness[sl] > 0.2) : hold.grabbing;
        mats[sl].ring.opacity = hold.grabbing ? 1 : 0.8; mats[sl].ring.color.set(hold.grabbing ? HOLD_COLOR[hold.kind] : CYAN);
      }
      mats[sl].joint.opacity = mats[sl].bone.opacity = 0.95;
    });

    // Status for the label (and for tests): the busiest hand leads.
    const lead = holds.find(h => h.grabbing) ?? holds.find(h => h.hover !== null) ?? holds[0];
    const present = frames.filter(Boolean).length;
    const mode: Mode = present === 0 ? 'waiting' : lead.grabbing ? 'grab' : lead.hover !== null ? 'hover' : 'idle';
    const thumbPts = v.pos[0];
    const onPiece = holds.map(h => h.target ?? h.hover).find((t): t is number => typeof t === 'number');
    const loose = drive === 'local' && onPiece !== undefined ? rig.loosened()[onPiece] : null;
    status.current = {
      mode, kind: lead.grabbing ? lead.kind : 'none', moved: rootMoved, turned: rootTurn > TURNED, remote: drive === 'remote', angle: Math.round((rootTurn * 180) / Math.PI / 5) * 5,
      target: nameOf(lead.target ?? lead.hover), partAngle: Math.round((partTurn * 180) / Math.PI / 5) * 5, partMoved,
      partPos: views.parts[0] ? [0, 1, 2].map(i => Math.round(([views.parts[0].pos.x, views.parts[0].pos.y, views.parts[0].pos.z][i] - comps[0].center[i]) * 100)).join(',') : '',
      partLift: Math.round(Math.max(0, ...views.parts.map((p, i) => p.pos.y - comps[i].center[1])) * 20) * 5,
      thumb: handPts[0] ? ((thumbPts[4].x - thumbPts[8].x) * (mirror ? -1 : 1) > 0 ? 'right' : 'left') : '',
      hands: present, kind2: holds[1].grabbing ? holds[1].kind : 'none', target2: nameOf(holds[1].target ?? holds[1].hover),
      unscrew: loose === null || loose === undefined ? -1 : Math.round(loose * 20) * 5,
      kit: !kitProfile ? '' : kit.current.joined ? 'on' : kit.current.near ? 'near' : kit.current.gate > 0.5 ? 'open' : 'apart',
      kitJust: kit.current.sinceJoin >= 0 && kit.current.sinceJoin < 1800,
    };
  });

  const partMesh = (i: number, offset?: P3) => <PartMesh key={i} part={model.parts[i]} offset={offset} solid />;
  const outline = (i: number, offset?: P3) => {
    const p = model.parts[i], o = offset ?? [0, 0, 0];
    return <mesh key={`h${i}`} position={[p.position[0] - o[0], p.position[1] - o[1], p.position[2] - o[2]]} scale={[p.size[0] * 1.08, p.size[1] * 1.08, p.size[2] * 1.08]} geometry={geoms[i]}>
      <meshBasicMaterial ref={m => { if (m) outlineMats.current[i] = m; }} color="#fff36b" side={THREE.BackSide} transparent opacity={0} depthWrite={false} />
    </mesh>;
  };
  return <>
    <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.38, 32]} /><meshBasicMaterial color="#000" transparent opacity={0.28} depthWrite={false} /></mesh>
    {/* Where everything started, as outlines, with a dashed line to where the whole is now. */}
    {model.parts.map((p, i) => <lineSegments key={`o${i}`} ref={el => { ghosts.current[i] = el; }} geometry={edgeGeometry[p.shape]} position={p.position} scale={p.size}><lineBasicMaterial color="#ffffff" transparent opacity={0.4} /></lineSegments>)}
    <primitive object={trail} />
    <group ref={rootGroup}>
      {mesh ? <MeshView piece={mesh.body} onMat={m => { if (m) meshMats.current.set(-1, m); else meshMats.current.delete(-1); }} />
        : model.parts.map((_, i) => owner[i] < 0 ? <group key={i}>{partMesh(i)}{outline(i)}</group> : null)}
      {kitProfile && <Slot at={kitProfile.hole} state={kit} />}
      {comps.map((c, ci) => <group key={`c${ci}`} ref={el => { compGroups.current[ci] = el; }} position={c.center}>
        {mesh?.pieces[ci] ? <MeshView piece={mesh.pieces[ci]!} onMat={m => { if (m) meshMats.current.set(ci, m); else meshMats.current.delete(ci); }} />
          : c.parts.map(i => <group key={i}>{partMesh(i, c.center)}{outline(i, c.center)}</group>)}
        {kitProfile && ci === 0 && <LobsterClaw at={[kitProfile.attach[0] - c.center[0], kitProfile.attach[1] - c.center[1], kitProfile.attach[2] - c.center[2]]} state={kit} />}
      </group>)}
    </group>
    {kitProfile && comps[0] && <Strap clasp={compGroups} at={[kitProfile.attach[0] - comps[0].center[0], comps[0].hi[1], kitProfile.attach[2] - comps[0].center[2]]} />}
    {SLOTS.map(sl => <group key={`hand${sl}`} ref={el => { hg.current[sl].group = el; }} visible={false}>
      {Array.from({ length: 21 }, (_, i) => <mesh key={i} ref={el => { hg.current[sl].joints[i] = el; }} material={mats[sl].joint}><sphereGeometry args={[0.026, 10, 10]} /></mesh>)}
      {BONES.map((_, i) => <mesh key={i} ref={el => { hg.current[sl].bones[i] = el; }} material={mats[sl].bone}><cylinderGeometry args={[0.014, 0.014, 1, 8]} /></mesh>)}
      {[0, 1, 2].map(i => <mesh key={`d${i}`} ref={el => { hg.current[sl].dots[i] = el; }} material={mats[sl].tip}><sphereGeometry args={[0.042, 14, 14]} /></mesh>)}
      <mesh ref={el => { hg.current[sl].ring = el; }} material={mats[sl].ring} visible={false}><torusGeometry args={[1, 0.07, 8, 40]} /></mesh>
    </group>)}
  </>;
}

function Lookat() {
  useFrame(({ camera }) => camera.lookAt(0, 0, 0));
  return null;
}

/**
 * Small grey box with a 3D copy of the object the helper is pointing at, and the helper's hands on it.
 * The view is fixed (no spinning) so a hand's position on the object stays meaningful.
 * `mirror` flips the picture like a selfie view: alone, you watch yourself in a mirror, so the copy and your hands
 * must move the way your mirrored video does (move left, the hand goes left).
 */
export function TwinBox({ twin, hand, placement, posFlip, mirror = false, drive, remotePose, onPose, onClose, frame, onThrow, stage = false }: {
  twin: TwinInfo; hand: MutableRefObject<HandSource>; placement: Placement; posFlip: boolean; mirror?: boolean;
  drive: 'local' | 'remote'; remotePose: MutableRefObject<TwinPose>; onPose: (p: TwinPose) => void; onClose: () => void;
  /** the scanned picture this object was found in, if it is ours: lets this screen ask SAM 3D for a real model */
  frame?: ScanFrame | null;
  /** you hold it in a call: throw it to your friend (a button, or flick it up) */
  onThrow?: () => void;
  /** in a call: drawn on the screen itself, over the video, instead of in the grey box */
  stage?: boolean;
}) {
  const pl = useRef(placement);
  useEffect(() => { pl.current = placement; }, [placement]);
  const status = useRef<BoxStatus>(IDLE_STATUS);
  const [ui, setUi] = useState<BoxStatus>(status.current);
  const [resetToken, setResetToken] = useState(0);
  const [big, setBig] = useState(false);
  const sam = useTwinMesh(twin.label, twin.model);
  const [kept, setKept] = useState('');
  const [shapes, setShapes] = useState(false); // show Claude's shapes even though a mesh is ready (to compare)
  const showMesh = !!sam.mesh && !shapes;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (sam.phase !== 'running') return; const id = window.setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, [sam.phase]);
  const making = sam.phase === 'running' ? `making 3D · ${Math.max(0, Math.round((now - (sam.startedAt ?? now)) / 1000))}s` : '';
  const canMake = !!frame && drive === 'local' && sam.phase !== 'off' && sam.phase !== 'running';
  const make = () => { if (frame) { setShapes(false); sam.generate(frame, twin.bbox); } };
  useEffect(() => {
    const id = window.setInterval(() => setUi(prev => { const n = status.current; return (Object.keys(n) as (keyof BoxStatus)[]).every(k => prev[k] === n[k]) ? prev : { ...n }; }), 150);
    return () => clearInterval(id);
  }, []);
  const changed = ui.moved || ui.turned || ui.partMoved || ui.partAngle > 0;
  const holding = ui.mode === 'grab';
  const partNames = useMemo(() => componentsOf(twin.model).map(c => c.name), [twin.model]);
  // Short on purpose: the small box is only ~30 characters wide.
  const what = ui.target === 'whole' ? 'the whole' : `the ${ui.target}`;
  const both = holding && ui.kind2 !== 'none';
  // A screwed-on piece in hand: say it comes off with a pull (twisting works too, and shows how far it has gone).
  const screwing = ui.unscrew >= 0 && ui.unscrew < 100 && (holding || ui.mode === 'hover');
  const piece = partNames.find(n => n === ui.target || n === ui.target2) ?? 'cap';
  // The lanyard has its own steps: open the claw, bring it to the hole, let go, and it hangs.
  const heldClasp = holding && (ui.target === 'clasp' || ui.target2 === 'clasp'), heldCard = holding && (ui.target === 'whole' || ui.target2 === 'whole');
  const kitText = !ui.kit ? '' : ui.remote
    ? (ui.kit === 'on' ? (ui.kitJust ? 'clipped on ✓' : heldClasp ? 'friend lifts it: it swings' : 'clipped on ✓') : ui.kit === 'near' ? 'friend is clipping it on' : ui.kit === 'open' ? 'friend opens the clasp' : '')
    : ui.kit === 'on' ? (ui.kitJust ? 'clipped on ✓' : heldClasp && ui.kind === 'pinch' ? 'claw open · lift to unclip' : heldClasp ? 'clipped on · it swings' : heldCard ? 'moving both' : 'pinch the clasp to unclip')
    : ui.kit === 'near' ? 'let go to clip it on'
    : ui.kit === 'open' ? 'bring the claw to the hole'
    : heldClasp ? 'pinch to open the claw' : heldCard ? 'holding the card' : ui.mode === 'waiting' ? '' : 'pinch the clasp, clip it on';
  const text = kitText ? kitText : ui.remote
    ? (both ? 'friend uses both hands' : holding ? `friend holds ${what}` : changed && ui.mode !== 'waiting' ? 'moved by your friend' : ui.mode === 'waiting' ? 'waiting for hand' : 'friend is pointing')
    : screwing ? (holding ? (ui.unscrew > 0 ? `pull it off, or twist · ${ui.unscrew}%` : 'pull up to take it off') : `pinch the ${piece}, pull it off`)
    : holding && ui.unscrew === 100 && ui.partLift < 15 ? `${piece} is loose · pull it off`
    : both ? `both hands: ${what} + ${ui.target2 === 'whole' ? 'the whole' : `the ${ui.target2}`}`
    : holding ? `${ui.kind === 'grip' ? 'gripping' : 'pinching'} ${what}`
    : ui.mode === 'hover' ? `pinch ${what}` : ui.mode === 'idle' && changed ? 'moved · pinch to move again' : ui.mode === 'waiting' ? 'waiting for hand' : partNames.length ? `pinch the ${partNames[0]} or the whole` : 'point at it, then pinch';
  return <aside className={`twin-box ${mirror ? 'mirror' : ''} ${big && !stage ? 'big' : ''} ${stage ? 'stage' : ''}`} aria-label={`3D copy of ${twin.label}`} data-mode={ui.mode} data-kind={ui.kind} data-moved={ui.moved ? '1' : '0'} data-turned={ui.turned ? '1' : '0'} data-angle={ui.angle} data-target={ui.target} data-part-angle={ui.partAngle} data-part-moved={ui.partMoved ? '1' : '0'} data-big={big ? '1' : '0'} data-thumb={ui.thumb} data-part-lift={ui.partLift} data-part-pos={ui.partPos} data-hands={ui.hands} data-kind2={ui.kind2} data-target2={ui.target2} data-unscrew={ui.unscrew} data-kit={ui.kit} data-kit-just={ui.kitJust ? '1' : '0'}>
    <Canvas dpr={[1, 2]} camera={{ position: [0.5, 0.4, 3.4], fov: 40 }} gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
      <Lookat />
      <ambientLight intensity={1.2} />
      <directionalLight position={[2, 3, 4]} intensity={2} />
      <TwinScene key={`${twin.objectId}:${drive}`} onThrow={drive === 'local' ? onThrow : undefined} mirror={mirror} twin={twin} hand={hand} placement={pl} posFlip={posFlip} drive={drive} remotePose={remotePose} onPose={onPose} status={status} resetToken={resetToken} mesh={showMesh ? sam.mesh : null} />
    </Canvas>
    {holding && <span className={`twin-badge ${ui.kind}`}>{both ? '2 HANDS' : ui.kind === 'grip' ? 'GRIP' : 'PINCH'}</span>}
    <div className="twin-label"><span>{twin.label}{making ? ` · ${making}` : kept ? ` · ${kept}` : showMesh ? (sam.saved ? ' · saved' : ' · SAM 3D') : ''}</span><span className="twin-status">{text}</span></div>
    <div className="twin-tools">
      {sam.mesh && <button className="twin-tool" aria-pressed={showMesh} aria-label={showMesh ? 'Show the simple shapes' : 'Show the SAM 3D model'} title={showMesh ? `SAM 3D model (cached${sam.ms ? `, made in ${Math.round(sam.ms / 1000)}s` : ''}). Click for the simple shapes.` : 'Show the SAM 3D model'} onClick={() => setShapes(v => !v)}>{showMesh ? '◆' : '◇'}</button>}
      {(canMake && (!sam.mesh || big)) && <button className="twin-tool" aria-label={sam.mesh ? 'Remake the 3D model' : 'Make a 3D model'} title={`${sam.mesh ? 'Remake' : 'Make'} a real 3D model with SAM 3D. Sends the scanned camera picture to fal.ai.${sam.error ? ` Last try failed: ${sam.error}` : ''}`} onClick={make}>{sam.mesh ? '⟳' : '3D'}</button>}
      {sam.mesh && drive === 'local' && sam.canKeep && <button className="twin-tool" aria-pressed={sam.saved} aria-label="Keep this model for the demo" title={sam.saved ? 'Saved for the demo: it loads from the app, no scan or AI server needed. Click to save this version again.' : 'Keep this model for the demo: saves it into the app (public/demo), so it loads instantly without scanning.'} onClick={() => { setKept('saving…'); void sam.keep(twin).then(ok => setKept(ok ? 'saved for the demo' : 'could not save')); }}>★</button>}
      {!stage && <button className="twin-tool" aria-label={big ? 'Make it smaller' : 'Make it bigger'} aria-pressed={big} title={big ? 'Make it smaller' : 'Make it bigger'} onClick={() => setBig(b => !b)}>{big ? '⤡' : '⤢'}</button>}
      {changed && drive === 'local' && <button className="twin-tool" aria-label="Put it back" title="Put it back" onClick={() => setResetToken(n => n + 1)}>↺</button>}
      {onThrow && drive === 'local' && <button className="twin-tool twin-throw" aria-label="Throw to your friend" title="Throw it to your friend (or flick it up)" onClick={onThrow}>Throw</button>}
      <button className="twin-tool" aria-label="Close 3D view" onClick={onClose}>×</button>
    </div>
  </aside>;
}
