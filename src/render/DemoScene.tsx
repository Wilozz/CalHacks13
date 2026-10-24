import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BUILTIN_MODELS, movingTop } from '../ai/modelSpec';
import type { ActionSpec, ModelPart, ModelSpec } from '../ai/types';
import { BONES } from '../coordinates';
import type { LiveData } from '../HandScene';
import { HandDriver } from './handDrive';
import { directionVector, LOOP_SECONDS, poseAt, toScene, travelUnits, twinKindFor, twinPlacement, type Pose } from './motion';

const GHOST = '#64f5ed';

export const edgeGeometry = {
  cylinder: new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 24), 30), box: new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  sphere: new THREE.EdgesGeometry(new THREE.SphereGeometry(0.5, 12, 8), 30), cone: new THREE.EdgesGeometry(new THREE.ConeGeometry(0.5, 1, 24), 30),
};

export function PartMesh({ part, offset = [0, 0, 0] as [number, number, number], solid = false }: { part: ModelPart; offset?: [number, number, number]; solid?: boolean }) {
  const geometry = {
    cylinder: <cylinderGeometry args={[0.5, 0.5, 1, 32]} />, box: <boxGeometry args={[1, 1, 1]} />,
    sphere: <sphereGeometry args={[0.5, 24, 24]} />, cone: <coneGeometry args={[0.5, 1, 32]} />,
  }[part.shape];
  const [x, y, z] = part.position;
  return <mesh position={[x - offset[0], y - offset[1], z - offset[2]]} scale={part.size}>
    {geometry}
    {/* Cyan emissive plus an outline keep dark objects (a black box) readable on a dark view. */}
    <meshStandardMaterial color={part.color} emissive={GHOST} emissiveIntensity={solid ? 0.08 : part.moving ? 0.3 : 0.18} transparent opacity={solid ? 1 : part.moving ? 0.92 : 0.7} roughness={0.5} depthWrite={solid} />
    <lineSegments geometry={edgeGeometry[part.shape]}><lineBasicMaterial color={GHOST} transparent opacity={0.55} /></lineSegments>
  </mesh>;
}

/** The user's actual tracked hand, in twin space, so it is obvious what is moving the model. */
function LiveHand({ live, mirrored, tip }: { live: MutableRefObject<LiveData>; mirrored: boolean; tip: MutableRefObject<THREE.Vector3> }) {
  const group = useRef<THREE.Group>(null!);
  const joints = useRef<(THREE.Mesh | null)[]>([]);
  const bones = useRef<(THREE.Mesh | null)[]>([]);
  const s = useRef({ a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), pts: Array.from({ length: 21 }, () => new THREE.Vector3()) });
  const K = 2.2; // image units -> twin units; a hand is ~0.9 twin units long
  useFrame(() => {
    const { frame, receivedAt } = live.current;
    const fresh = !!frame?.landmarks.length && performance.now() - receivedAt < 350;
    group.current.visible = fresh;
    if (!fresh || !frame) return;
    const dir = mirrored ? -1 : 1, w = frame.landmarks[0], p = s.current.pts;
    frame.landmarks.forEach((l, i) => p[i].set(dir * (l.x - w.x) * K * live.current.aspect, -(l.y - w.y) * K, -(l.z - w.z) * K));
    // Anchor the index fingertip just above the moving part.
    group.current.position.copy(tip.current).sub(p[8]);
    p.forEach((v, i) => joints.current[i]?.position.copy(v));
    BONES.forEach(([a, b], i) => {
      const m = bones.current[i]; if (!m) return;
      const { a: va, b: vb, up } = s.current;
      va.copy(p[a]); vb.copy(p[b]).sub(va);
      m.position.copy(va).addScaledVector(vb, 0.5);
      m.scale.set(1, vb.length(), 1);
      m.quaternion.setFromUnitVectors(up, vb.normalize());
    });
  });
  return <group ref={group} visible={false}>
    {Array.from({ length: 21 }, (_, i) => <mesh key={i} ref={el => { joints.current[i] = el; }}><sphereGeometry args={[i === 8 ? 0.035 : 0.022, 10, 10]} /><meshBasicMaterial color={i === 8 ? '#ffffff' : '#9ffcf5'} /></mesh>)}
    {BONES.map((_, i) => <mesh key={i} ref={el => { bones.current[i] = el; }}><cylinderGeometry args={[0.008, 0.008, 1, 6]} /><meshBasicMaterial color="#20bac9" transparent opacity={0.9} /></mesh>)}
  </group>;
}

function DemoHand({ tip }: { tip: MutableRefObject<THREE.Vector3> }) {
  const g = useRef<THREE.Group>(null!);
  useFrame(() => g.current.position.copy(tip.current));
  return <group ref={g}>
    <mesh position={[0, 0.34, 0]}><boxGeometry args={[0.3, 0.1, 0.34]} /><meshStandardMaterial color={GHOST} transparent opacity={0.3} depthWrite={false} /></mesh>
    <mesh position={[0.02, 0.17, 0.08]}><capsuleGeometry args={[0.04, 0.2, 6, 12]} /><meshStandardMaterial color={GHOST} transparent opacity={0.3} depthWrite={false} /></mesh>
  </group>;
}

function Arrow({ from, dir, length }: { from: [number, number, number]; dir: [number, number, number]; length: number }) {
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()), [dir]);
  return <group position={from} quaternion={q}>
    <mesh position={[0, length / 2, 0]}><cylinderGeometry args={[0.012, 0.012, length, 8]} /><meshBasicMaterial color="#e7ffff" transparent opacity={0.8} /></mesh>
    <mesh position={[0, length + 0.05, 0]}><coneGeometry args={[0.045, 0.1, 12]} /><meshBasicMaterial color="#e7ffff" transparent opacity={0.9} /></mesh>
  </group>;
}

function TwistArrow({ at, sign }: { at: [number, number, number]; sign: number }) {
  const arc = Math.PI * 1.5;
  return <group position={at} rotation={[Math.PI / 2, 0, sign > 0 ? 0 : Math.PI]}>
    <mesh><torusGeometry args={[0.26, 0.012, 8, 48, arc]} /><meshBasicMaterial color="#e7ffff" transparent opacity={0.8} /></mesh>
    <mesh position={[0.26 * Math.cos(arc), 0.26 * Math.sin(arc), 0]} rotation={[0, 0, arc + Math.PI]}><coneGeometry args={[0.045, 0.1, 12]} /><meshBasicMaterial color="#e7ffff" transparent opacity={0.9} /></mesh>
  </group>;
}

interface TwinProps { spec: ActionSpec; model: ModelSpec; reverse: boolean; mode: 'demo' | 'live'; live?: MutableRefObject<LiveData>; aspect: number; mirrored: boolean; onPose?: (p: Pose) => void }

function Twin({ spec, model, reverse, mode, live, aspect, mirrored, onPose }: TwinProps) {
  const act = spec.actionType;
  const moving = useRef<THREE.Group>(null!);
  const tip = useRef(new THREE.Vector3());
  const driver = useMemo(() => new HandDriver(), []);
  const hasMoving = model.parts.some(p => p.moving);
  // Lifting or tilting carries the whole object; so does a model with no marked moving part.
  const whole = act === 'tilt' || act === 'lift' || !hasMoving;
  const pivot: [number, number, number] = whole ? (act === 'tilt' ? [0, -0.5, 0] : [0, 0, 0]) : model.pivot;
  const top = movingTop(model) + 0.04;
  const dir = directionVector(spec);
  const twistSign = (spec.rotationSense === 'tighten') !== reverse ? -1 : 1;

  useFrame(({ clock }, dt) => {
    let pose: Pose;
    if (mode === 'live' && live) {
      const { frame, receivedAt } = live.current;
      const fresh = !!frame?.landmarks.length && performance.now() - receivedAt < 350;
      driver.update(fresh ? frame!.landmarks : null, aspect, mirrored, dt);
      pose = driver.pose(spec);
    } else pose = poseAt(spec, (clock.elapsedTime / LOOP_SECONDS) % 1, reverse);
    moving.current.position.set(pivot[0] + pose.pos[0], pivot[1] + pose.pos[1], pivot[2] + pose.pos[2]);
    moving.current.rotation.set(...pose.rot);
    // The hand rides the top of the moving part, including when the part swings about its pivot.
    tip.current.set(0, top - pivot[1], 0).applyEuler(moving.current.rotation).add(moving.current.position);
    onPose?.(pose);
  });

  const fixed = model.parts.filter(p => whole ? false : !p.moving);
  const movers = model.parts.filter(p => whole ? true : p.moving);
  return <>
    {fixed.map((p, i) => <PartMesh key={`f${i}`} part={p} />)}
    <group ref={moving}>{movers.map((p, i) => <PartMesh key={`m${i}`} part={p} offset={pivot} />)}</group>
    {mode === 'live' && live ? <LiveHand live={live} mirrored={mirrored} tip={tip} /> : <DemoHand tip={tip} />}
    {act === 'twist' && <TwistArrow at={[model.pivot[0], top + 0.08, model.pivot[2]]} sign={twistSign} />}
    {(act === 'pull' || act === 'push' || act === 'slide' || act === 'lift') && <Arrow from={[0, top, 0.1]} dir={dir} length={travelUnits(spec.amount.distanceCm)} />}
    {act === 'press' && <Arrow from={[0, top + 0.55, 0]} dir={[0, -1, 0]} length={0.3} />}
  </>;
}

export function FrameCamera({ aspect }: { aspect: number }) {
  const camera = useThree(s => s.camera) as THREE.OrthographicCamera;
  useEffect(() => {
    Object.assign(camera, { manual: true, left: 0, right: aspect, top: 1, bottom: 0, near: -10, far: 10, zoom: 1 });
    camera.position.set(0, 0, 5);
    camera.updateProjectionMatrix();
  }, [camera, aspect]);
  return null;
}

function Anchor({ x, y }: { x: number; y: number }) {
  const ring = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => { const s = 1 + 0.18 * Math.sin(clock.elapsedTime * 4); ring.current.scale.set(s, s, 1); });
  return <mesh ref={ring} position={[x, y, 0]}><ringGeometry args={[0.028, 0.036, 40]} /><meshBasicMaterial color={GHOST} /></mesh>;
}

function Tether({ a, b }: { a: THREE.Vector3; b: THREE.Vector3 }) {
  const line = useMemo(() => new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: GHOST, dashSize: 0.02, gapSize: 0.015, transparent: true, opacity: 0.8 })), [a, b]);
  useEffect(() => { line.computeLineDistances(); }, [line]);
  return <primitive object={line} />;
}

/**
 * Floating twin of the object the AI saw, tethered to the real one. `model` is the parametric twin Claude
 * wrote from the camera frame (a built-in only when vision gave none). In 'live' mode the twin follows the
 * helper's tracked hand; in 'demo' mode it plays the AI's chosen action on a loop.
 */
export function DemoScene({ spec, model, aspect = 4 / 3, mirrored = false, reverseThread = false, mode = 'demo', live, parentLabel, onPose }:
  { spec: ActionSpec; model?: ModelSpec; aspect?: number; mirrored?: boolean; reverseThread?: boolean; mode?: 'demo' | 'live'; live?: MutableRefObject<LiveData>; parentLabel?: string; onPose?: (p: Pose) => void }) {
  const twin = model ?? BUILTIN_MODELS[twinKindFor(spec, parentLabel)];
  const anchor = toScene(spec.targetPoint2d ?? { x: 0.5, y: 0.5 }, aspect, mirrored);
  const place = twinPlacement(anchor, aspect);
  const a = useMemo(() => new THREE.Vector3(anchor.x, anchor.y, 0), [anchor.x, anchor.y]);
  const b = useMemo(() => new THREE.Vector3(place.x, place.y, 0), [place.x, place.y]);
  const key = `${spec.actionType}-${spec.targetObjectId}-${spec.stepIndex}-${spec.rotationSense}-${reverseThread}-${mode}`;

  return <div className="demo-overlay" role="img" aria-label={spec.caption || `${spec.actionType} demonstration`}>
    <div className="demo-frame" style={{ aspectRatio: String(aspect) }}>
      <Canvas orthographic dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
        <FrameCamera aspect={aspect} />
        <ambientLight intensity={1.1} />
        <directionalLight position={[2, 3, 4]} intensity={1.6} />
        <Anchor x={anchor.x} y={anchor.y} />
        <Tether a={a} b={b} />
        <group position={[place.x, place.y, 0]} scale={place.scale * 1.8}>
          <group rotation={mode === 'live' ? [0.15, -0.25, 0] : [0.35, -0.55, 0]}>
            <Twin key={key} spec={spec} model={twin} reverse={reverseThread} mode={mode} live={live} aspect={aspect} mirrored={mirrored} onPose={onPose} />
          </group>
        </group>
      </Canvas>
      <div className="demo-caption">
        {spec.stepCount > 1 && <span className="demo-step">Step {spec.stepIndex} of {spec.stepCount}</span>}
        <span>{mode === 'live' ? `Your hand controls the ${spec.targetLabel}: ${HINT[spec.actionType]}` : spec.caption || `${spec.actionType} the ${spec.targetLabel}`}</span>
      </div>
    </div>
  </div>;
}

const HINT: Record<ActionSpec['actionType'], string> = {
  twist: 'roll your wrist', press: 'move your fingertip down or toward the camera', pull: 'move your fingertip that way', push: 'move your fingertip that way',
  slide: 'slide your fingertip', lift: 'raise your fingertip', flip: 'roll your wrist', tilt: 'roll your wrist',
};
