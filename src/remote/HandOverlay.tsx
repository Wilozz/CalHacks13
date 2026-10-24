import { useEffect, useRef, type MutableRefObject, type PointerEvent } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BONES } from '../coordinates';
import { FrameCamera } from '../render/DemoScene';
import { HandPlacer, type Placement } from './placement';
import type { RemoteHandState } from './remoteHand';

function Skeleton({ remote, placement, aspect }: { remote: MutableRefObject<RemoteHandState>; placement: MutableRefObject<Placement>; aspect: number }) {
  const group = useRef<THREE.Group>(null!);
  const joints = useRef<(THREE.Mesh | null)[]>([]);
  const bones = useRef<(THREE.Mesh | null)[]>([]);
  const halo = useRef<THREE.Mesh>(null!);
  const placer = useRef(new HandPlacer());
  const s = useRef({ pos: Array.from({ length: 21 }, () => new THREE.Vector3()), a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fresh: false });

  useFrame(({ clock }, dt) => {
    const frame = remote.current.current(performance.now());
    const pts = frame ? placer.current.place(frame, placement.current, aspect) : null;
    group.current.visible = !!pts;
    if (!pts) { s.current.fresh = false; placer.current.reset(); return; }
    // Smooth the jitter of monocular tracking, but snap on (re)acquisition so the hand never swoops in.
    const alpha = s.current.fresh ? 1 - Math.exp(-dt * 26) : 1;
    s.current.fresh = true;
    const { pos, a, b, up } = s.current;
    pts.forEach((p, i) => { pos[i].lerp(a.set(p[0], p[1], p[2]), alpha); joints.current[i]?.position.copy(pos[i]); });
    BONES.forEach(([i, j], n) => {
      const m = bones.current[n]; if (!m) return;
      a.copy(pos[i]); b.copy(pos[j]).sub(a);
      m.position.copy(a).addScaledVector(b, 0.5); m.scale.set(1, b.length(), 1); m.quaternion.setFromUnitVectors(up, b.normalize());
    });
    halo.current.position.copy(pos[8]);
    const pulse = 1 + 0.2 * Math.sin(clock.elapsedTime * 5);
    halo.current.scale.set(pulse, pulse, 1);
  });

  return <group ref={group} visible={false}>
    {Array.from({ length: 21 }, (_, i) => <mesh key={i} ref={el => { joints.current[i] = el; }}><sphereGeometry args={[i === 0 ? 0.014 : i === 8 ? 0.016 : 0.009, 12, 12]} /><meshBasicMaterial color={i === 8 ? '#ffffff' : i === 0 ? '#e7ffff' : '#64f5ed'} transparent opacity={0.95} depthTest={false} /></mesh>)}
    {BONES.map((_, i) => <mesh key={i} ref={el => { bones.current[i] = el; }}><cylinderGeometry args={[0.0045, 0.0045, 1, 8]} /><meshBasicMaterial color="#20d6e0" transparent opacity={0.85} depthTest={false} /></mesh>)}
    <mesh ref={halo}><ringGeometry args={[0.03, 0.036, 40]} /><meshBasicMaterial color="#83eedc" transparent opacity={0.9} depthTest={false} /></mesh>
  </group>;
}

/**
 * The helper's hand, drawn over the recipient's live camera view. Reads frames from RemoteHandState,
 * which is fed by a real data channel or, in the solo demo, a loopback of the local hand.
 * In pinned mode, tap the view to choose where the fingertip should land.
 */
export function HandOverlay({ remote, placement, aspect, onPin }: { remote: MutableRefObject<RemoteHandState>; placement: Placement; aspect: number; onPin: (p: { x: number; y: number }) => void }) {
  const ref = useRef(placement);
  useEffect(() => { ref.current = placement; }, [placement]);
  const pinning = placement.mode === 'pinned';
  const tap = (e: PointerEvent<HTMLDivElement>) => {
    if (!pinning) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPin({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
  };
  return <div className="demo-overlay hand-overlay" aria-hidden="true">
    <div className={`demo-frame ${pinning ? 'pinning' : ''}`} style={{ aspectRatio: String(aspect) }} onPointerDown={tap}>
      <Canvas orthographic dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
        <FrameCamera aspect={aspect} />
        <Skeleton remote={remote} placement={ref} aspect={aspect} />
      </Canvas>
      {pinning && placement.pin && <i className="pin-mark" style={{ left: `${placement.pin.x * 100}%`, top: `${placement.pin.y * 100}%` }} />}
    </div>
  </div>;
}
