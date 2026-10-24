import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ModelSpec } from '../ai/types';
import { BONES } from '../coordinates';
import { OneEuro } from '../remote/oneEuro';
import { palmSize, pinchCloseness, PinchDetector } from '../remote/pinch';
import { releaseVelocity, TOSS_OBJECTS, type Sample, type Toss, type TossKind } from './toss';
import type { TrackedHand } from './useTracker';

export interface TossApi { spawn(kind: TossKind): void; flick(): void; receive(t: Toss): void }
export interface TossStatus { state: State | 'none'; label: string; hover: boolean; handSeen: boolean }
type State = 'spawn' | 'rest' | 'held' | 'drop' | 'out' | 'in';
type Input = 'hand' | 'pointer' | 'script';
interface Props { api: MutableRefObject<TossApi | null>; hand: MutableRefObject<TrackedHand>; mirrored: boolean; bottomInset: number; onToss: (t: Toss) => void; onStatus: (s: TossStatus) => void }

const V = THREE.Vector3;
const FAR = -28;           // where the friend "is": thrown objects fly into the screen to here, and arrive from here
const G = 20;
const GRAB_RADIUS = 1.15;  // × object height: generous, so a grab near the object still takes it
const THROW_SPEED = 1.5;   // × half screen height per second, sideways or up
const PUSH_RATE = 1.6;     // palm growing this fast (log size per second) = a push toward the screen
const LOST_GRACE = 250;    // ms: tracking drops during a fast flick; keep holding, then release with the last motion
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const clamp = THREE.MathUtils.clamp;
// Canvas runs `linear`, so colors are written as-is (sRGB values straight to the screen).
const raw = (hex: string) => { const n = parseInt(hex.slice(1), 16); return new THREE.Color().setRGB((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace); };
const CYAN = raw('#5ff2ff'), HOT = raw('#fff36b'), INK = raw('#0b1116');
// Glow adds light but never alpha: the canvas is transparent over the video, and added alpha turns faded glow into black specks.
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const;

const VERT = `
uniform vec3 uOrigin; uniform float uScale;
varying vec3 vN; varying vec3 vV; varying vec3 vObj;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vObj = (wp.xyz - uOrigin) / uScale;
  vec4 mv = viewMatrix * wp;
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
// Solid, lit object in its real colors, with a rim light (yellow while held), a bottom-up build (uScan) and a burn-away (uDissolve).
const FRAG = `
uniform float uTime; uniform float uDissolve; uniform float uScan; uniform float uHot; uniform vec3 uColor;
varying vec3 vN; varying vec3 vV; varying vec3 vObj;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  float cut = (vObj.y + 0.5) - uScan * 1.2;
  if (cut > 0.0) discard;
  float n = noise(vObj * 7.0) * 0.65 + noise(vObj * 19.0) * 0.35;
  float d = n - (uDissolve * 1.1 - 0.05);
  if (d < 0.0) discard;
  float burn = (1.0 - smoothstep(0.0, 0.08, d)) * step(0.001, uDissolve);
  float scanEdge = (1.0 - smoothstep(0.0, 0.04, -cut)) * step(uScan, 0.999);
  vec3 N = normalize(vN), V = normalize(vV), L = normalize(vec3(0.35, 0.85, 0.6));
  float diff = max(dot(N, L), 0.0), hemi = 0.5 + 0.5 * N.y;
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 28.0) * 0.4;
  float fres = pow(1.0 - abs(dot(N, V)), 2.5);
  vec3 cyan = vec3(0.37, 0.95, 1.0), rim = mix(cyan, vec3(1.0, 0.95, 0.42), uHot);
  vec3 col = uColor * (0.32 + 0.22 * hemi + 0.62 * diff) + spec + rim * fres * (0.45 + 0.55 * uHot) + cyan * (burn + scanEdge) * 1.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const soft = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const GEO = { cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1), box: new THREE.BoxGeometry(1, 1, 1), sphere: new THREE.SphereGeometry(0.5, 40, 28), cone: new THREE.ConeGeometry(0.5, 1, 48) };
const glowMat = (extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, ...ADD, depthWrite: false, opacity: 0, side: THREE.DoubleSide, ...extra });
const OUTLINE = 0.05; // model units; a dark shell behind each part keeps it readable on any video

function makeTwin(model: ModelSpec, height: number) {
  const root = new THREE.Group(), body = new THREE.Group();
  body.scale.setScalar(height); root.add(body);
  const u = { uTime: { value: 0 }, uDissolve: { value: 0 }, uScan: { value: 1 }, uHot: { value: 0 }, uOrigin: { value: new V() }, uScale: { value: height } };
  const mats: THREE.Material[] = [];
  const outline = new THREE.MeshBasicMaterial({ color: INK.clone(), side: THREE.BackSide, transparent: true, depthWrite: false });
  for (const p of model.parts) {
    const c = raw(p.color);
    const mat = new THREE.ShaderMaterial({ uniforms: { ...u, uColor: { value: new V(c.r, c.g, c.b) } }, vertexShader: VERT, fragmentShader: FRAG });
    const m = new THREE.Mesh(GEO[p.shape], mat);
    m.position.fromArray(p.position); m.scale.fromArray(p.size); body.add(m); mats.push(mat);
    const shell = new THREE.Mesh(GEO[p.shape], outline);
    shell.position.fromArray(p.position); shell.scale.set(p.size[0] + OUTLINE, p.size[1] + OUTLINE, p.size[2] + OUTLINE); body.add(shell);
  }
  mats.push(outline);
  return {
    root,
    set(time: number, dissolve: number, scan: number, hot: number) {
      u.uTime.value = time; u.uDissolve.value = dissolve; u.uScan.value = scan; u.uHot.value = hot; u.uOrigin.value.copy(root.position);
      outline.opacity = dissolve > 0 || scan < 1 ? 0 : 0.85 + hot * 0.15;
      outline.color.copy(INK).lerp(HOT, hot * 0.9);
    },
    dispose() { mats.forEach(m => m.dispose()); },
  };
}
type Twin = ReturnType<typeof makeTwin>;

class Particles {
  readonly points: THREE.Points;
  private i = 0;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private life: Float32Array; private max: Float32Array; private base: Float32Array;
  constructor(private n = 700) {
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1); this.base = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.09, map: soft, vertexColors: true, transparent: true, ...ADD, depthWrite: false }));
    this.points.frustumCulled = false;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    const i = this.i = (this.i + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.max[i] = life; this.base[i] = 0.5 + Math.random() * 0.7;
  }
  update(dt: number) {
    const drag = Math.exp(-dt * 2.4);
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      if (this.life[i] <= 0) { this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
      this.life[i] -= dt;
      for (let a = 0; a < 3; a++) { this.vel[j + a] *= drag; this.pos[j + a] += this.vel[j + a] * dt; }
      const k = Math.max(this.life[i] / this.max[i], 0) * this.base[i];
      this.col[j] = CYAN.r * k; this.col[j + 1] = CYAN.g * k; this.col[j + 2] = CYAN.b * k;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = true;
  }
  dispose() { this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose(); }
}

/** Your tracked hand drawn on the screen, so you can see where you are reaching: bones, joints and a grip ring at the palm. */
function makeHandGlyph(scene: THREE.Scene) {
  const bones = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3)), new THREE.LineBasicMaterial({ color: CYAN, transparent: true, ...ADD, depthWrite: false, opacity: 0 }));
  const joints = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3)), new THREE.PointsMaterial({ color: raw('#e8ffff'), size: 0.16, map: soft, transparent: true, ...ADD, depthWrite: false, opacity: 0 }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 64), glowMat());
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), glowMat());
  for (const o of [bones, joints, ring, fill]) { o.frustumCulled = false; scene.add(o); }
  return {
    show(pts: THREE.Vector3[] | null, palm: THREE.Vector3, grip: number, holding: boolean, hover: boolean, size: number) {
      const vis = pts ? 1 : 0;
      (bones.material as THREE.LineBasicMaterial).opacity = 0.55 * vis; (joints.material as THREE.PointsMaterial).opacity = 0.9 * vis;
      const rm = ring.material as THREE.MeshBasicMaterial, fm = fill.material as THREE.MeshBasicMaterial;
      rm.opacity = vis * (holding ? 0 : hover ? 0.95 : 0.6); rm.color.copy(hover ? HOT : CYAN);
      fm.opacity = vis * (holding ? 0 : grip * 0.3); fm.color.copy(hover ? HOT : CYAN);
      if (!pts) return;
      const r = size * (holding ? 0.22 : 0.42 - 0.18 * grip);
      ring.position.copy(palm); ring.scale.setScalar(r); fill.position.copy(palm); fill.scale.setScalar(r * 0.8);
      const b = bones.geometry.attributes.position as THREE.BufferAttribute, j = joints.geometry.attributes.position as THREE.BufferAttribute;
      BONES.forEach(([p, q], i) => { b.setXYZ(i * 2, pts[p].x, pts[p].y, pts[p].z); b.setXYZ(i * 2 + 1, pts[q].x, pts[q].y, pts[q].z); });
      pts.forEach((p, i) => j.setXYZ(i, p.x, p.y, p.z));
      b.needsUpdate = j.needsUpdate = true;
    },
  };
}

interface Obj {
  twin: Twin; label: string; model: ModelSpec; state: State; age: number;
  pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; dissolve: number; scan: number; hot: number;
  hist: Sample[]; by: Input | null; offset: { x: number; y: number }; target: { x: number; y: number };
  squash: number; squashAmp: number; sent: boolean;
  path: { p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; dur: number; arc: number } | null;
  script: { from: { x: number; y: number }; wind: { x: number; y: number }; flick: { x: number; y: number } } | null;
}

function World({ api, hand, mirrored, bottomInset, onToss, onStatus }: Props) {
  const { scene, size, gl } = useThree();
  const kit = useMemo(() => {
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const m = new THREE.Mesh(geo, mat); scene.add(m); return m; };
    const ring = new THREE.RingGeometry(0.84, 1, 72), plane = new THREE.PlaneGeometry(1, 1);
    const particles = new Particles(); scene.add(particles.points);
    const scanLine = mesh(plane, glowMat({ map: soft, opacity: 0.9 })); scanLine.visible = false;
    return {
      particles, scanLine,
      shadow: mesh(plane, new THREE.MeshBasicMaterial({ map: soft, color: 0x000000, transparent: true, depthWrite: false, opacity: 0 })),
      portals: [mesh(ring, glowMat()), mesh(ring, glowMat())],
      ripple: mesh(ring, glowMat()),
      glyph: makeHandGlyph(scene),
      dispose() { scene.clear(); particles.dispose(); ring.dispose(); plane.dispose(); },
    };
  }, [scene]);
  useEffect(() => () => kit.dispose(), [kit]);

  const s = useRef({
    obj: null as Obj | null, T: 0, fx: [] as { t: number; dur: number; fn: (k: number) => void }[],
    grip: new PinchDetector({ fist: true }), fx1: new OneEuro(), fy1: new OneEuro(),
    lastAt: 0, wasGrip: false, target: new V(), cursor: new V(), seen: false, lostAt: 0,
    skeleton: Array.from({ length: 21 }, () => new V()), sizes: [] as Sample[],
    pointerId: null as number | null, statusKey: '',
  });
  const cb = useRef({ onToss, onStatus, mirrored, bottomInset }); cb.current = { onToss, onStatus, mirrored, bottomInset };

  // World units: the camera sees ±halfH vertically at z = 0.
  const halfH = Math.tan(THREE.MathUtils.degToRad(20)) * 10;
  const dims = () => {
    const halfW = halfH * size.width / size.height, S = Math.min(halfH * 0.42, halfW * 0.6);
    const floorY = -halfH + (cb.current.bottomInset / size.height) * 2 * halfH + S * 0.15;
    return { halfW, S, floorY, restY: floorY + S / 2 };
  };
  const toWorld = (u: number, v: number) => { const { halfW } = dims(); return { x: (u * 2 - 1) * halfW, y: (1 - v * 2) * halfH }; };
  const clampHeld = (p: { x: number; y: number }) => { const { halfW, S, restY } = dims(); return { x: clamp(p.x, -halfW + S * 0.3, halfW - S * 0.3), y: clamp(p.y, restY, halfH - S * 0.4) }; };
  const anim = (dur: number, fn: (k: number) => void) => s.current.fx.push({ t: 0, dur, fn });
  const near = (o: Obj, p: { x: number; y: number }) => Math.hypot(p.x - o.pos.x, p.y - o.pos.y) < dims().S * GRAB_RADIUS;
  const grabbable = (o: Obj | null): o is Obj => !!o && !o.by && (o.state === 'rest' || o.state === 'drop' || o.state === 'spawn');
  const setState = (o: Obj, st: State) => { o.state = st; o.age = 0; };
  const clear = () => { const o = s.current.obj; if (o) { scene.remove(o.twin.root); o.twin.dispose(); } s.current.obj = null; kit.scanLine.visible = false; };
  const newObj = (model: ModelSpec, label: string, state: State, pos: THREE.Vector3): Obj => {
    clear(); // shortcut: one object per screen; a catch while holding replaces it. Keep a list if both sides should keep theirs.
    const twin = makeTwin(model, dims().S); scene.add(twin.root);
    const o: Obj = { twin, label, model, state, age: 0, pos, vel: new V(), spin: new V(), dissolve: 0, scan: 1, hot: 0, hist: [], by: null, offset: { x: 0, y: 0 }, target: { x: pos.x, y: pos.y }, squash: 0, squashAmp: 0, sent: false, path: null, script: null };
    s.current.obj = o; return o;
  };
  // Grabbing keeps the object where it is (no jump); with a hand it then eases into the palm.
  const grab = (o: Obj, by: Input, at: { x: number; y: number }) => {
    if (o.state === 'spawn') o.scan = 1;
    o.by = by; o.hist = []; o.offset = { x: o.pos.x - at.x, y: o.pos.y - at.y }; o.target = { x: o.pos.x, y: o.pos.y }; o.vel.set(0, 0, 0);
    setState(o, 'held');
  };

  function release(o: Obj) {
    const { S, restY } = dims(), by = o.by;
    const [vx, vy] = releaseVelocity(o.hist);
    const [push] = by === 'hand' ? releaseVelocity(s.current.sizes) : [0];
    o.by = null; o.script = null;
    const speed = Math.hypot(vx, vy);
    if (speed > halfH * THROW_SPEED || push > PUSH_RATE) {
      // Thrown: keep the flick's momentum, then curve into the screen toward the friend.
      const k = Math.min(1, 22 / Math.max(speed, 1e-6)), dur = 0.65;
      const p0 = o.pos.clone(), p1 = p0.clone().add(new V(vx * k, vy * k, 0).multiplyScalar(dur / 2)), p2 = new V(0, halfH * 0.18, FAR);
      o.path = { p0, p1, p2, dur, arc: 0 }; o.sent = false; o.dissolve = 0;
      o.spin.set(-vy * 0.5 + rnd(2), vx * 0.5 + rnd(3), rnd(4));
      setState(o, 'out');
    } else {
      o.vel.set(vx * 0.4, vy * 0.4, 0);
      if (o.pos.y <= restY + S * 0.05) o.vel.y = 0;
      setState(o, 'drop');
    }
  }
  const squash = (o: Obj, amp: number) => { o.squash = 0.4; o.squashAmp = amp; };

  function land(o: Obj) {
    const { S, floorY } = dims(), end = o.path!.p2;
    o.pos.copy(end); o.dissolve = 0; o.path = null; squash(o, 1); setState(o, 'rest');
    anim(0.65, k => { kit.ripple.position.set(end.x, floorY, -0.1); const r = S * (0.3 + k * 1.4); kit.ripple.scale.set(r, r * 0.22, 1); (kit.ripple.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.75; });
    const n = reduce ? 8 : 28;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; kit.particles.spawn(end.x + Math.cos(a) * S * 0.3, floorY + 0.05, Math.sin(a) * 0.3, Math.cos(a) * 3.6, 0.6 + Math.random(), Math.sin(a) * 1.4, 0.55); }
  }

  api.current = {
    spawn(kind) {
      const { label, model } = TOSS_OBJECTS[kind];
      newObj(model, label, 'spawn', new V(0, dims().restY, 0)).scan = 0;
    },
    flick() {
      const o = s.current.obj;
      if (!grabbable(o) || o.state === 'spawn') return;
      const { S, restY } = dims(), from = { x: o.pos.x, y: o.pos.y }, wind = { x: o.pos.x * 0.5, y: restY + S * 0.7 };
      o.script = { from, wind, flick: { x: wind.x * 0.4, y: wind.y + halfH * 0.9 } };
      grab(o, 'script', from);
    },
    receive(t) {
      const { halfW, restY, S } = dims();
      const p0 = new V(rnd(halfW * 0.15), halfH * 0.18, FAR), p2 = new V(rnd(halfW * 0.35), restY, 0);
      const o = newObj(t.model, t.label, 'in', p0.clone());
      o.path = { p0, p1: p0, p2, dur: 1.0, arc: halfH * 0.55 }; o.dissolve = 1;
      o.spin.set(...t.spin); o.twin.root.rotation.set(rnd(1), rnd(2), rnd(1));
      // Two rings open where the friend's video is, then the object comes out of them.
      kit.portals.forEach((ring, i) => anim(0.8 + i * 0.18, k => {
        const q = Math.max(0, (k * (0.8 + i * 0.18) - i * 0.18) / 0.8);
        ring.position.copy(p0); ring.scale.setScalar(0.3 + q * S * 6); ring.rotation.z = q * 2;
        (ring.material as THREE.MeshBasicMaterial).opacity = q > 0 && q < 1 ? (1 - q) * 0.9 : 0;
      }));
    },
  };

  // Mouse or finger on the screen: same grab, carry and flick as the hand.
  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = 'none';
    const at = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return toWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); };
    const down = (e: PointerEvent) => {
      const o = s.current.obj, p = at(e);
      if (!grabbable(o) || !near(o, p)) return;
      el.setPointerCapture(e.pointerId); s.current.pointerId = e.pointerId; grab(o, 'pointer', p); el.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      const o = s.current.obj, p = at(e);
      if (o?.by === 'pointer' && e.pointerId === s.current.pointerId) {
        o.target = clampHeld({ x: p.x + o.offset.x, y: p.y + o.offset.y });
        o.hist.push({ t: e.timeStamp / 1000, x: o.target.x, y: o.target.y }); if (o.hist.length > 60) o.hist.shift();
      } else el.style.cursor = grabbable(o) && near(o, p) ? 'grab' : '';
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== s.current.pointerId) return;
      s.current.pointerId = null; el.style.cursor = '';
      const o = s.current.obj; if (o?.by === 'pointer') release(o);
    };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  });

  /** One new tracker frame: filter the palm, update the grip, grab or release. Runs at camera rate, not render rate. */
  function onHandFrame(frame: NonNullable<TrackedHand['frame']>, camAspect: number) {
    const st = s.current, t = frame.timestamp / 1000, lm = frame.landmarks;
    // Same placement as the camera video drawn full screen with object-fit: cover, so the drawn hand sits on your real hand.
    const screenAspect = size.width / size.height, sx = Math.max(1, camAspect / screenAspect), sy = Math.max(1, screenAspect / camAspect);
    const map = (p: { x: number; y: number }) => toWorld(0.5 + ((cb.current.mirrored ? 1 - p.x : p.x) - 0.5) * sx, 0.5 + (p.y - 0.5) * sy);
    // The palm centre does not move when the fingers close, so grabbing and letting go never jolt the object.
    const palm = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + lm[i].x / 5, y: a.y + lm[i].y / 5 }), { x: 0, y: 0 });
    const c = map(palm), fx = st.fx1.filter(c.x, t), fy = st.fy1.filter(c.y, t);
    st.target.set(fx, fy, 0);
    if (!st.seen) st.cursor.copy(st.target);
    st.seen = true; st.lostAt = 0;
    const z = dims().S * 0.8;
    lm.forEach((p, i) => { const w = map(p); st.skeleton[i].set(w.x + fx - c.x, w.y + fy - c.y, z); });
    const ps = palmSize(frame);
    if (ps) { st.sizes.push({ t, x: Math.log(ps), y: 0 }); while (st.sizes.length && t - st.sizes[0].t > 0.4) st.sizes.shift(); }

    const grip = st.grip.update(frame), o = st.obj;
    if (grip && !st.wasGrip && grabbable(o) && near(o, st.target)) grab(o, 'hand', st.target);
    if (o?.by === 'hand') {
      if (grip) { o.hist.push({ t, x: fx, y: fy }); if (o.hist.length > 40) o.hist.shift(); }
      else release(o);
    }
    st.wasGrip = grip;
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05), st = s.current, now = performance.now();
    st.T += dt;
    const { S, floorY, restY } = dims();

    const { frame, at, aspect } = hand.current;
    const fresh = !!frame && frame.landmarks.length === 21 && now - at < 350;
    if (fresh && frame && at !== st.lastAt) { st.lastAt = at; onHandFrame(frame, aspect); }
    if (!fresh && st.seen) {
      st.seen = false; st.grip.reset(); st.wasGrip = false; st.fx1.reset(); st.fy1.reset(); st.sizes = [];
      if (st.obj?.by === 'hand') st.lostAt = now;
    }
    if (st.lostAt && now - st.lostAt > LOST_GRACE) { st.lostAt = 0; if (st.obj?.by === 'hand') release(st.obj); }
    // Draw between camera frames (30/s) so the hand and what it holds glide at the display rate.
    const glide = 1 - Math.exp(-dt * 40);
    st.cursor.lerp(st.target, glide);
    const o0 = st.obj, holding = o0?.by === 'hand', hover = fresh && grabbable(o0) && near(o0, st.cursor);
    kit.glyph.show(fresh ? st.skeleton : null, new V(st.cursor.x, st.cursor.y, S * 0.8), pinchCloseness(st.grip.ratio) || (st.grip.pinching ? 1 : 0), holding, hover, S);
    if (holding && o0) {
      o0.offset.x *= Math.exp(-dt * 12); o0.offset.y *= Math.exp(-dt * 12);
      o0.target = clampHeld({ x: st.cursor.x + o0.offset.x, y: st.cursor.y + o0.offset.y });
    }

    const o = st.obj;
    if (o) { o.hot += ((o.by ? 1 : hover ? 0.5 : 0) - o.hot) * Math.min(1, dt * 14); stepObj(o, dt, S, floorY, restY); }
    st.fx = st.fx.filter(f => { f.t += dt; const k = Math.min(f.t / f.dur, 1); f.fn(k); return k < 1; });
    kit.particles.update(dt);

    const cur = st.obj;
    const status: TossStatus = { state: cur?.state ?? 'none', label: cur?.label ?? '', hover, handSeen: fresh };
    const key = `${status.state}|${status.label}|${hover}|${fresh}`;
    if (key !== st.statusKey) { st.statusKey = key; cb.current.onStatus(status); }
  });

  function stepObj(o: Obj, dt: number, S: number, floorY: number, restY: number) {
    const st = s.current, r = o.twin.root, T = st.T;
    const damp = (k: number) => { r.rotation.x *= Math.exp(-dt * k); r.rotation.z *= Math.exp(-dt * k); };
    o.age += dt;
    if (o.state === 'spawn') {
      o.scan = Math.min(o.age / 1.4, 1); o.pos.set(o.pos.x, restY, 0); r.rotation.y += dt * 0.6;
      kit.scanLine.visible = o.scan < 1;
      kit.scanLine.position.set(o.pos.x, restY - S * 0.5 + Math.min(o.scan * 1.2, 1) * S, 0.9); kit.scanLine.scale.set(S * 1.5, 0.06, 1);
      if (o.scan >= 1) setState(o, 'rest');
    } else if (o.state === 'rest') {
      o.pos.y += (restY + (reduce ? 0 : Math.sin(T * 2.2) * 0.04) - o.pos.y) * Math.min(1, dt * 10);
      r.rotation.y += dt * 0.35; damp(4);
    } else if (o.state === 'held') {
      kit.scanLine.visible = false;
      if (o.script) {
        const sc = o.script, a = o.age, ease = (t: number) => t * t * (3 - 2 * t);
        const mix = (p: { x: number; y: number }, q: { x: number; y: number }, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        o.target = a < 0.4 ? mix(sc.from, sc.wind, ease(a / 0.4)) : a < 0.55 ? sc.wind : a < 0.67 ? mix(sc.wind, sc.flick, (a - 0.55) / 0.12) : sc.flick;
        o.hist.push({ t: performance.now() / 1000, x: o.target.x, y: o.target.y }); if (o.hist.length > 40) o.hist.shift();
      }
      const a = 1 - Math.exp(-dt * 30), px = o.pos.x, py = o.pos.y;
      o.pos.x += (o.target.x - px) * a; o.pos.y += (o.target.y - py) * a;
      const vx = (o.pos.x - px) / dt, vy = (o.pos.y - py) / dt;
      r.rotation.z += (clamp(-vx * 0.02, -0.45, 0.45) - r.rotation.z) * Math.min(1, dt * 12);
      r.rotation.x += (clamp(vy * 0.015, -0.35, 0.35) - r.rotation.x) * Math.min(1, dt * 12);
      r.rotation.y += dt * 0.4;
      if (o.script && o.age >= 0.67) release(o);
    } else if (o.state === 'drop') {
      const { halfW } = dims();
      o.vel.y -= G * dt; o.pos.addScaledVector(o.vel, dt); o.vel.x *= Math.exp(-dt * 3);
      o.pos.x = clamp(o.pos.x, -halfW + S * 0.3, halfW - S * 0.3);
      if (o.pos.y <= restY) {
        o.pos.y = restY;
        if (o.vel.y < -3) { squash(o, Math.min(1, -o.vel.y / 14)); o.vel.y *= -0.28; } else { o.vel.set(0, 0, 0); setState(o, 'rest'); }
      }
      damp(3);
    } else if (o.state === 'out' && o.path) {
      const { p0, p1, p2, dur } = o.path, k = Math.min(o.age / dur, 1), q = 1 - k;
      o.pos.set(0, 0, 0).addScaledVector(p0, q * q).addScaledVector(p1, 2 * q * k).addScaledVector(p2, k * k);
      r.rotation.x += o.spin.x * dt; r.rotation.y += o.spin.y * dt; r.rotation.z += o.spin.z * dt;
      o.dissolve = clamp((k - 0.35) / 0.6, 0, 1);
      if (o.dissolve > 0) for (let i = 0; i < (reduce ? 2 : 8); i++) kit.particles.spawn(o.pos.x + rnd(S * 0.3), o.pos.y + rnd(S * 0.4), o.pos.z + rnd(S * 0.2), rnd(1.5), rnd(1.5) + 0.5, rnd(1.5), 0.45 + Math.random() * 0.5);
      if (k >= 0.4 && !o.sent) { o.sent = true; cb.current.onToss({ id: Math.random().toString(36).slice(2, 10), label: o.label, model: o.model, spin: o.spin.toArray() as [number, number, number] }); }
      if (k >= 1) { clear(); return; }
    } else if (o.state === 'in' && o.path) {
      const { p0, p2, dur, arc } = o.path, k = Math.min(o.age / dur, 1);
      o.pos.lerpVectors(p0, p2, k); o.pos.y += arc * 4 * k * (1 - k);
      r.rotation.x += o.spin.x * dt * (1 - k); r.rotation.y += o.spin.y * dt * (1 - k); r.rotation.z += o.spin.z * dt * (1 - k);
      damp(k * 6);
      o.dissolve = Math.max(0, 1 - k / 0.3);
      if (o.dissolve > 0) for (let i = 0; i < (reduce ? 2 : 9); i++) {
        const off = new V(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar(S * (0.7 + Math.random() * 0.5));
        kit.particles.spawn(o.pos.x + off.x, o.pos.y + off.y, o.pos.z + off.z, -off.x * 3, -off.y * 3, -off.z * 3, 0.3);
      }
      if (k >= 1) land(o);
    }
    r.position.copy(o.pos);
    const lift = 1 + 0.08 * o.hot;
    if (o.squash > 0) {
      o.squash = Math.max(0, o.squash - dt);
      const amt = Math.sin((1 - o.squash / 0.4) * Math.PI) * 0.2 * o.squashAmp;
      r.scale.set(1 + amt * 0.6, 1 - amt, 1 + amt * 0.6); r.position.y -= amt * S * 0.5;
    } else r.scale.setScalar(lift);
    o.twin.set(T, o.dissolve, o.scan, o.hot);
    const up = 1 - Math.min(Math.max(0, o.pos.y - restY) / (halfH * 1.2), 0.85);
    const vis = o.state === 'spawn' ? o.scan : o.state === 'out' ? 1 - o.dissolve : o.state === 'in' ? (1 - o.dissolve) * Math.min(1, o.age / 0.7) : 1;
    kit.shadow.position.set(o.pos.x, floorY, o.pos.z - 0.3);
    kit.shadow.scale.set(S * 1.1 * (0.55 + 0.45 * up), S * 0.24 * (0.55 + 0.45 * up), 1);
    (kit.shadow.material as THREE.MeshBasicMaterial).opacity = 0.7 * up * vis;
  }

  return null;
}

/** Full-screen overlay: the tossable object, your tracked hand, and the portal it leaves and arrives through. */
export function TossScene(props: Props) {
  return <div className="toss-layer">
    <Canvas linear flat dpr={[1, 2]} camera={{ fov: 40, position: [0, 0, 10], near: 0.1, far: 100 }} gl={{ alpha: true, antialias: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
      <World {...props} />
    </Canvas>
  </div>;
}
