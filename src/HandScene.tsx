import { Component, useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BONES, transformHand, type HandFrame } from './coordinates';
export interface LiveData {
  /** the main hand (the first of the two, else the second): what single-hand features use */
  frame: HandFrame | null;
  /** both hands, each kept in its own slot from frame to frame */
  hands?: [HandFrame | null, HandFrame | null];
  receivedAt: number; aspect: number; renderFps: number; mirrored: boolean;
}
function Skeleton({ live }: { live: MutableRefObject<LiveData> }) {
  const group = useRef<THREE.Group>(null!);
  const joints = useRef<(THREE.Mesh | null)[]>([]);
  const bones = useRef<(THREE.Mesh | null)[]>([]);
  const positions = useRef(Array.from({length:21}, () => new THREE.Vector3()));
  const scratch = useRef({ a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0,1,0), last: 0, count: 0, reset: true });
  useFrame((_, dt) => {
    const now = performance.now();
    const s = scratch.current;
    s.count++;
    if (now-s.last > 500) { live.current.renderFps = s.count*1000/(now-s.last); s.count=0; s.last=now; }
    const frame = live.current.frame;
    const visible = !!frame?.landmarks.length && now-live.current.receivedAt < 350;
    group.current.visible = visible;
    if (!visible || !frame) { s.reset=true; return; }
    const target = transformHand(frame, live.current.aspect, live.current.mirrored);
    const alpha = s.reset ? 1 : 1-Math.exp(-dt*24);
    target.forEach((p,i) => {
      positions.current[i].lerp(s.a.set(p.x,p.y,p.z), alpha);
      joints.current[i]?.position.copy(positions.current[i]);
    });
    BONES.forEach(([a,b],i) => {
      const mesh = bones.current[i]; if (!mesh) return;
      const start = positions.current[a], end = positions.current[b];
      mesh.position.copy(start).add(end).multiplyScalar(.5);
      s.b.subVectors(end,start);
      mesh.scale.set(1,s.b.length(),1);
      mesh.quaternion.setFromUnitVectors(s.up,s.b.normalize());
    });
    s.reset=false;
  });
  return <group ref={group} visible={false}>
    {Array.from({length:21}, (_,i) => <mesh key={i} ref={el => { joints.current[i]=el; }}><sphereGeometry args={[i===0?.045:.029,12,12]}/><meshBasicMaterial color={i===0?'#e7ffff':'#64f5ed'}/></mesh>)}
    {BONES.map((_,i) => <mesh key={i} ref={el => { bones.current[i]=el; }}><cylinderGeometry args={[.012,.012,1,8]}/><meshBasicMaterial color="#20bac9" transparent opacity={.85}/></mesh>)}
  </group>;
}
class SceneBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() { return this.state.failed ? <div className="scene-error">3D renderer unavailable. Enable WebGL and reload.</div> : this.props.children; }
}
// Demand rendering avoids a 120 Hz phone display driving an unnecessary 120 FPS loop.
function MobileFrames({ running }: { running: boolean }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    if(!running) { invalidate(); return; }
    let raf=0, last=0;
    const tick=(now:number) => {
      if(now-last>=1000/60-1) { invalidate(); last=now; }
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, invalidate]);
  return null;
}
export function HandScene({ live, mobile, running }: { live: MutableRefObject<LiveData>; mobile: boolean; running: boolean }) {
  return <SceneBoundary><Canvas camera={{position:[0,0,8],fov:43}} frameloop={mobile?'demand':'always'} dpr={mobile?1:[1,1.5]} gl={{antialias:true,alpha:true}} fallback={<div className="scene-error">WebGL is required for the 3D view.</div>}>
    {mobile && <MobileFrames running={running}/>}
    <Skeleton live={live}/>
    <gridHelper args={[20,40,'#16333c','#10222c']} position={[0,-2.25,0]}/>
  </Canvas></SceneBoundary>;
}
