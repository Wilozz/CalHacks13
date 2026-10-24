import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ModelSpec } from '../ai/types';
import { BONES, type HandFrame } from '../coordinates';
import { OneEuro } from '../remote/oneEuro';
import { palmSize, pinchCloseness, PinchDetector } from '../remote/pinch';
import { palmQuat } from '../remote/quat';
import { isThrow, MAX_SCALE, MIN_SCALE, releaseVelocity, TOSS_OBJECTS, type Sample, type Toss, type TossKind } from './toss';
import type { TrackedHand } from './useTracker';

export interface TossApi { spawn(kind: TossKind): void; flick(): void; receive(t: Toss): void }
/** state/label: the object in focus (held, else newest). labels: every object on this screen. busy: one is passing through the portal. */
export interface TossStatus { state: State | 'none'; label: string; hover: boolean; handSeen: boolean; labels: string[]; canToss: boolean; busy: boolean }
type State = 'spawn' | 'rest' | 'held' | 'drop' | 'out' | 'in';
type Input = 'hand' | 'pointer' | 'script';
interface Props { api: MutableRefObject<TossApi | null>; hand: MutableRefObject<TrackedHand>; mirrored: boolean; bottomInset: number; onToss: (t: Toss) => void; onStatus: (s: TossStatus) => void }

const V = THREE.Vector3;
const PORTAL_Z = -4;       // the portal opens over the friend's video, a little into the screen
const G = 20;
const GRAB_RADIUS = 1.15;  // × object height: generous, so a grab near the object still takes it
const THROW_SPEED = 1.5;   // × half screen height per second, up-and-forward (see isThrow)
const LOST_HOLD = 700;     // ms: tracking drops (fast moves, hands close). Freeze and keep the grip; only then drop, never throw
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

// The portal: a spiralling cyan-violet rim around a dark hole. uOpen scales it from nothing to full size.
const PORTAL_FRAG = `
uniform float uTime; uniform float uOpen; varying vec2 vUv;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * 1.3;
  float r = length(p) / max(uOpen, 0.001), a = atan(p.y, p.x);
  float rim = exp(-pow((r - 1.0) * 8.0, 2.0));
  float arms = 0.5 + 0.5 * sin(a * 5.0 - r * 10.0 + uTime * 6.0);
  float inner = smoothstep(1.05, 0.1, r) * arms * 0.6, halo = step(1.0, r) * exp(-(r - 1.0) * 7.0) * 0.35;
  vec3 c = mix(vec3(0.37, 0.95, 1.0), vec3(0.72, 0.5, 1.0), arms * smoothstep(0.3, 1.0, r));
  float edge = smoothstep(1.3, 1.1, length(p)); // fades out before the quad's edge, so no square shows
  if (edge <= 0.0) discard;
  gl_FragColor = vec4(c * (rim * 1.5 + inner + halo) * min(uOpen * 3.0, 1.0) * edge, 1.0);
}`;
function makePortal(scene: THREE.Scene) {
  const u = { uTime: { value: 0 }, uOpen: { value: 0 } };
  const root = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ map: soft, color: raw('#01060a'), transparent: true, depthWrite: false, opacity: 0 }));
  const swirl = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.ShaderMaterial({ uniforms: u, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: PORTAL_FRAG, transparent: true, ...ADD, depthWrite: false }));
  swirl.position.z = 0.01; root.add(core, swirl); root.visible = false; scene.add(root);
  let open = 0;
  return {
    root, target: 0,
    /** Open (1) or close (0) at `at`, sized `radius`. */
    to(v: number, at?: THREE.Vector3, radius?: number) { this.target = v; if (at) root.position.copy(at); if (radius) root.scale.setScalar(radius); },
    update(dt: number, T: number) {
      open += (this.target - open) * Math.min(1, dt * (this.target > open ? 9 : 6));
      root.visible = open > 0.01; u.uOpen.value = open; u.uTime.value = T; swirl.rotation.z = -T * 0.6;
      (core.material as THREE.MeshBasicMaterial).opacity = 0.8 * open; core.scale.setScalar(Math.max(open, 1e-3) * 1.15);
    },
    dispose() { core.geometry.dispose(); swirl.geometry.dispose(); (core.material as THREE.Material).dispose(); (swirl.material as THREE.Material).dispose(); },
  };
}

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
    set(time: number, dissolve: number, scan: number, hot: number, scale = 1) {
      u.uTime.value = time; u.uScale.value = height * scale; u.uDissolve.value = dissolve; u.uScan.value = scan; u.uHot.value = hot; u.uOrigin.value.copy(root.position);
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
  twin: Twin; shadow: THREE.Mesh; label: string; model: ModelSpec; state: State; age: number;
  pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; dissolve: number; scan: number; hot: number;
  /** by: what holds it. holders: hand slots (by 'hand') or pointer ids (by 'pointer'); the first one moves and turns it. */
  hist: Sample[]; by: Input | null; holders: number[]; offset: { x: number; y: number }; target: { x: number; y: number };
  squash: number; squashAmp: number; sent: boolean; heldAt: number; handled: boolean;
  rot: THREE.Quaternion; turn: { palm: THREE.Quaternion; rot: THREE.Quaternion } | null;
  /** User size (1 = normal). resize: baseline while a second hand or finger stretches it. */
  scale: number; resize: { d0: number; s0: number } | null;
  path: { p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; dur: number } | null;
  script: { from: { x: number; y: number }; wind: { x: number; y: number }; flick: { x: number; y: number } } | null;
}

/** One tracked hand. Up to two: hands are matched to slots by position, not MediaPipe's left/right label (it swaps). */
interface Slot {
  grip: PinchDetector; fx: OneEuro; fy: OneEuro; target: THREE.Vector3; cursor: THREE.Vector3; img: { x: number; y: number } | null;
  seen: boolean; lostAt: number; wasGrip: boolean; palm: THREE.Quaternion | null; skeleton: THREE.Vector3[]; sizes: Sample[];
  glyph: ReturnType<typeof makeHandGlyph>;
}

const MAX_OBJS = 4;
const palmImg = (lm: { x: number; y: number }[]) => [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + lm[i].x / 5, y: a.y + lm[i].y / 5 }), { x: 0, y: 0 });

function World({ api, hand, mirrored, bottomInset, onToss, onStatus }: Props) {
  const { scene, size, gl } = useThree();
  const kit = useMemo(() => {
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const m = new THREE.Mesh(geo, mat); scene.add(m); return m; };
    const ring = new THREE.RingGeometry(0.84, 1, 72), plane = new THREE.PlaneGeometry(1, 1);
    const particles = new Particles(); scene.add(particles.points);
    const scanLine = mesh(plane, glowMat({ map: soft, opacity: 0.9 })); scanLine.visible = false;
    return {
      particles, scanLine, plane,
      portal: makePortal(scene),
      ripple: mesh(ring, glowMat()),
      glyphs: [makeHandGlyph(scene), makeHandGlyph(scene)],
      dispose() { scene.clear(); particles.dispose(); this.portal.dispose(); ring.dispose(); plane.dispose(); },
    };
  }, [scene]);
  useEffect(() => () => kit.dispose(), [kit]);

  const s = useRef({
    objs: [] as Obj[], T: 0, fx: [] as { t: number; dur: number; fn: (k: number) => void }[], lastAt: 0,
    slots: kit.glyphs.map((glyph): Slot => ({
      grip: new PinchDetector({ fist: true }), fx: new OneEuro(), fy: new OneEuro(), target: new V(), cursor: new V(), img: null,
      seen: false, lostAt: 0, wasGrip: false, palm: null, skeleton: Array.from({ length: 21 }, () => new V()), sizes: [], glyph,
    })),
    pointers: new Map<number, { x: number; y: number }>(), statusKey: '',
  });
  const cb = useRef({ onToss, onStatus, mirrored, bottomInset }); cb.current = { onToss, onStatus, mirrored, bottomInset };

  // World units: the camera sees ±halfH vertically at z = 0.
  const halfH = Math.tan(THREE.MathUtils.degToRad(20)) * 10;
  const PORTAL_AT = new V(0, halfH * 0.2, PORTAL_Z); // over the friend's face in their full-screen video
  const dims = () => {
    const halfW = halfH * size.width / size.height, S = Math.min(halfH * 0.42, halfW * 0.6);
    const floorY = -halfH + (cb.current.bottomInset / size.height) * 2 * halfH + S * 0.15;
    return { halfW, S, floorY };
  };
  const restY = (o: Obj) => { const { S, floorY } = dims(); return floorY + S * o.scale / 2; };
  const toWorld = (u: number, v: number) => { const { halfW } = dims(); return { x: (u * 2 - 1) * halfW, y: (1 - v * 2) * halfH }; };
  const clampX = (o: Obj, x: number) => { const { halfW, S } = dims(), m = Math.min(halfW * 0.95, S * o.scale * 0.45); return clamp(x, -halfW + m, halfW - m); }; // keeps the whole object on screen
  const clampHeld = (o: Obj, p: { x: number; y: number }) => ({ x: clampX(o, p.x), y: clamp(p.y, restY(o), Math.max(restY(o), halfH - dims().S * o.scale * 0.4)) });
  const anim = (dur: number, fn: (k: number) => void) => s.current.fx.push({ t: 0, dur, fn });
  const dist = (o: Obj, p: { x: number; y: number }) => Math.hypot(p.x - o.pos.x, p.y - o.pos.y);
  const near = (o: Obj, p: { x: number; y: number }) => dist(o, p) < dims().S * o.scale * GRAB_RADIUS;
  const grabbable = (o: Obj) => !o.by && (o.state === 'rest' || o.state === 'drop' || o.state === 'spawn');
  /** The closest object within reach that `ok` accepts. */
  const nearest = (p: { x: number; y: number }, ok: (o: Obj) => boolean) =>
    s.current.objs.filter(o => ok(o) && near(o, p)).sort((a, b) => dist(a, p) - dist(b, p))[0] ?? null;
  /** A new hand or finger closing at p: the closest of "something free" and "something held by one, to stretch". */
  const pick = (p: { x: number; y: number }, by: Input) => {
    const free = nearest(p, grabbable), held = nearest(p, o => o.by === by && o.holders.length === 1);
    return !held || (free && dist(free, p) < dist(held, p)) ? { o: free, join: false } : { o: held, join: true };
  };
  const heldBy = (by: Input, id: number) => s.current.objs.find(o => o.by === by && o.holders.includes(id)) ?? null;
  const pointOf = (o: Obj, id: number) => o.by === 'hand' ? s.current.slots[id].target : s.current.pointers.get(id) ?? null;
  const setState = (o: Obj, st: State) => { o.state = st; o.age = 0; };

  /** A spot on the floor with room for one more: the first of centre, left, right that is clear, else the emptiest. */
  const freeX = () => {
    const { halfW, S } = dims(), xs = s.current.objs.filter(o => o.state !== 'out').map(o => o.pos.x);
    const room = (x: number) => Math.min(99, ...xs.map(o => Math.abs(o - x)));
    const spots = [0, -0.5, 0.5].map(f => f * halfW);
    return spots.find(x => room(x) >= S * 0.95) ?? spots.reduce((a, b) => room(b) > room(a) ? b : a);
  };
  const remove = (o: Obj) => {
    const st = s.current; scene.remove(o.twin.root); scene.remove(o.shadow); o.twin.dispose(); (o.shadow.material as THREE.Material).dispose();
    st.objs = st.objs.filter(x => x !== o);
  };
  const newObj = (model: ModelSpec, label: string, state: State, pos: THREE.Vector3, scale = 1): Obj => {
    const st = s.current;
    // Room for a few at once; the oldest one nobody is holding makes way.
    if (st.objs.length >= MAX_OBJS) { const old = st.objs.find(o => !o.by && o.state !== 'out' && o.state !== 'in') ?? st.objs.find(o => !o.by); if (old) remove(old); }
    const twin = makeTwin(model, dims().S); scene.add(twin.root);
    const shadow = new THREE.Mesh(kit.plane, new THREE.MeshBasicMaterial({ map: soft, color: 0x000000, transparent: true, depthWrite: false, opacity: 0 })); scene.add(shadow);
    const o: Obj = { twin, shadow, label, model, state, age: 0, pos, vel: new V(), spin: new V(), dissolve: 0, scan: 1, hot: 0, hist: [], by: null, holders: [], offset: { x: 0, y: 0 }, target: { x: pos.x, y: pos.y }, squash: 0, squashAmp: 0, sent: false, heldAt: 0, handled: false, rot: new THREE.Quaternion(), turn: null, scale, resize: null, path: null, script: null };
    st.objs.push(o); return o;
  };
  // Grabbing keeps the object where it is (no jump); with a hand it then eases into the palm.
  const grab = (o: Obj, by: Input, at: { x: number; y: number }, id: number) => {
    if (o.state === 'spawn') { o.scan = 1; kit.scanLine.visible = false; }
    o.by = by; o.holders = [id]; o.hist = []; o.offset = { x: o.pos.x - at.x, y: o.pos.y - at.y }; o.target = { x: o.pos.x, y: o.pos.y }; o.vel.set(0, 0, 0);
    o.heldAt = performance.now() / 1000; o.handled = true; o.rot.copy(o.twin.root.quaternion); o.turn = null; o.resize = null;
    setState(o, 'held');
  };
  /** A second hand or finger on something already held: stretch or shrink it by the distance between the two. */
  const join = (o: Obj, id: number) => {
    const a = pointOf(o, o.holders[0]), b = o.by === 'hand' ? s.current.slots[id].target : s.current.pointers.get(id);
    if (!a || !b) return;
    o.holders = [o.holders[0], id];
    o.resize = { d0: Math.max(Math.hypot(a.x - b.x, a.y - b.y), dims().S * 0.15), s0: o.scale };
  };
  const stretch = (o: Obj) => {
    const a = pointOf(o, o.holders[0]), b = pointOf(o, o.holders[1]);
    if (!a || !b || !o.resize) return;
    o.scale = clamp(o.resize.s0 * Math.hypot(a.x - b.x, a.y - b.y) / o.resize.d0, MIN_SCALE, MAX_SCALE);
  };
  /** One holder lets go. With another still holding it stays held (no throw); the last one releases it. */
  const letGo = (o: Obj, id: number, gentle = false) => {
    if (o.holders.length < 2) { if (o.holders.includes(id)) release(o, gentle); return; }
    o.holders = o.holders.filter(h => h !== id); o.resize = null; o.hist = []; o.turn = null;
    const p = pointOf(o, o.holders[0]);
    if (p) o.offset = { x: o.pos.x - p.x, y: o.pos.y - p.y };
  };

  /** gentle: let go with no momentum (tracking was lost), so it can only drop. */
  function release(o: Obj, gentle = false) {
    const st = s.current, { S } = dims(), by = o.by, slot = by === 'hand' ? st.slots[o.holders[0]] : null;
    const v = gentle ? [0, 0] as [number, number] : releaseVelocity(o.hist), [vx, vy] = v;
    const [push] = slot && !gentle ? releaseVelocity(slot.sizes) : [0];
    o.by = null; o.holders = []; o.script = null; o.turn = null; o.resize = null;
    const speed = Math.hypot(vx, vy);
    if (isThrow(performance.now() / 1000 - o.heldAt, v, push, halfH * THROW_SPEED)) {
      // Thrown: a portal opens over the friend's video and the object, keeping the flick's momentum, curves into it.
      const k = Math.min(1, 22 / Math.max(speed, 1e-6)), dur = 0.7;
      const p0 = o.pos.clone(), p1 = p0.clone().add(new V(vx * k, vy * k, 0).multiplyScalar(dur / 2));
      kit.portal.to(1, PORTAL_AT, S * 0.95);
      o.path = { p0, p1, p2: PORTAL_AT.clone(), dur }; o.sent = false; o.dissolve = 0;
      o.spin.set(-vy * 0.5 + rnd(2), vx * 0.5 + rnd(3), rnd(4));
      setState(o, 'out');
    } else {
      o.vel.set(vx * 0.4, vy * 0.4, 0);
      if (o.pos.y <= restY(o) + S * 0.05) o.vel.y = 0;
      setState(o, 'drop');
    }
  }
  const squash = (o: Obj, amp: number) => { o.squash = 0.4; o.squashAmp = amp; };

  function land(o: Obj) {
    const { S, floorY } = dims(), end = o.path!.p2;
    o.pos.copy(end); o.dissolve = 0; o.path = null; squash(o, 1); setState(o, 'rest');
    anim(0.65, k => { kit.ripple.position.set(end.x, floorY, -0.1); const r = S * o.scale * (0.3 + k * 1.4); kit.ripple.scale.set(r, r * 0.22, 1); (kit.ripple.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.75; });
    const n = reduce ? 8 : 28;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; kit.particles.spawn(end.x + Math.cos(a) * S * 0.3, floorY + 0.05, Math.sin(a) * 0.3, Math.cos(a) * 3.6, 0.6 + Math.random(), Math.sin(a) * 1.4, 0.55); }
  }

  api.current = {
    spawn(kind) {
      const { label, model } = TOSS_OBJECTS[kind];
      const o = newObj(model, label, 'spawn', new V(0, 0, 0));
      o.pos.set(freeX(), restY(o), 0); o.scan = 0;
    },
    flick() {
      // The newest object at rest gets thrown for you.
      const o = [...s.current.objs].reverse().find(x => grabbable(x) && x.state !== 'spawn');
      if (!o) return;
      const { S } = dims(), from = { x: o.pos.x, y: o.pos.y }, wind = { x: o.pos.x * 0.5, y: restY(o) + S * 0.7 };
      o.script = { from, wind, flick: { x: wind.x * 0.4, y: wind.y + halfH * 0.9 } };
      grab(o, 'script', from, -1);
    },
    receive(t) {
      const { S } = dims();
      // A portal opens over the friend's video; the object flies out of it toward you, then lands on a free spot.
      const o = newObj(t.model, t.label, 'in', PORTAL_AT.clone(), t.scale);
      const p2 = new V(freeX(), restY(o), 0);
      o.path = { p0: PORTAL_AT.clone(), p1: new V(p2.x * 0.5, halfH * 0.45, 3.5), p2, dur: 1.05 }; o.dissolve = 1;
      o.spin.set(...t.spin); o.twin.root.rotation.set(rnd(1), rnd(2), rnd(1));
      kit.portal.to(1, PORTAL_AT, S * 0.95);
    },
  };

  // Mouse or fingers on the screen: one finger grabs, carries and flicks like a hand; a second finger on the same
  // object pinches it bigger or smaller (iPhone). The mouse wheel resizes too.
  useEffect(() => {
    const el = gl.domElement, st = s.current;
    el.style.touchAction = 'none';
    const at = (e: PointerEvent | WheelEvent) => { const r = el.getBoundingClientRect(); return toWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); };
    const down = (e: PointerEvent) => {
      const p = at(e);
      const { o, join: stretchIt } = pick(p, 'pointer');
      if (!o) return;
      st.pointers.set(e.pointerId, p);
      if (stretchIt) join(o, e.pointerId); else { grab(o, 'pointer', p, e.pointerId); el.style.cursor = 'grabbing'; }
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const p = at(e);
      if (!st.pointers.has(e.pointerId)) { el.style.cursor = nearest(p, grabbable) ? 'grab' : ''; return; }
      st.pointers.set(e.pointerId, p);
      const o = heldBy('pointer', e.pointerId);
      if (!o) return;
      if (o.holders.length === 2) stretch(o);
      if (o.holders[0] === e.pointerId) {
        o.target = clampHeld(o, { x: p.x + o.offset.x, y: p.y + o.offset.y });
        o.hist.push({ t: e.timeStamp / 1000, x: o.target.x, y: o.target.y }); if (o.hist.length > 60) o.hist.shift();
      }
    };
    const up = (e: PointerEvent) => {
      if (!st.pointers.has(e.pointerId)) return;
      const o = heldBy('pointer', e.pointerId);
      if (o) letGo(o, e.pointerId, e.type === 'pointercancel');
      st.pointers.delete(e.pointerId); if (!st.pointers.size) el.style.cursor = '';
    };
    const wheel = (e: WheelEvent) => {
      const o = nearest(at(e), x => grabbable(x) || x.by === 'pointer');
      if (!o) return;
      e.preventDefault(); o.scale = clamp(o.scale * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
    };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel); };
  });

  /** A hand slot lost its hand: the object it holds freezes (grip kept) until LOST_HOLD passes. */
  const lose = (i: number, now: number) => {
    const sl = s.current.slots[i];
    if (!sl.seen) return;
    sl.seen = false; sl.fx.reset(); sl.fy.reset(); sl.sizes = [];
    if (heldBy('hand', i)) sl.lostAt = now;
  };

  /** One new tracker result: match each hand to a slot, then filter, grip, grab, turn, stretch or release. Camera rate. */
  function onHandFrames(frames: HandFrame[], camAspect: number, now: number) {
    const st = s.current;
    // Same placement as the camera video drawn full screen with object-fit: cover, so the drawn hand sits on your real hand.
    const screenAspect = size.width / size.height, sx = Math.max(1, camAspect / screenAspect), sy = Math.max(1, screenAspect / camAspect);
    const map = (p: { x: number; y: number }) => toWorld(0.5 + ((cb.current.mirrored ? 1 - p.x : p.x) - 0.5) * sx, 0.5 + (p.y - 0.5) * sy);
    // Nearest-first matching to where each slot's hand was last seen (slots holding something are kept for their hand).
    const palms = frames.map(f => palmImg(f.landmarks)), pairs: [number, number, number][] = [];
    palms.forEach((p, f) => st.slots.forEach((sl, i) => pairs.push([f, i, sl.img ? Math.hypot(p.x - sl.img.x, p.y - sl.img.y) : 10 + (heldBy('hand', i) ? 1 : 0) + i])));
    pairs.sort((a, b) => a[2] - b[2]);
    const usedF = new Set<number>(), usedS = new Set<number>();
    for (const [f, i] of pairs) if (!usedF.has(f) && !usedS.has(i)) { usedF.add(f); usedS.add(i); slotFrame(i, frames[f], palms[f], map); }
    st.slots.forEach((_, i) => { if (!usedS.has(i)) lose(i, now); });
  }

  function slotFrame(i: number, frame: HandFrame, palm: { x: number; y: number }, map: (p: { x: number; y: number }) => { x: number; y: number }) {
    const st = s.current, sl = st.slots[i], t = frame.timestamp / 1000, lm = frame.landmarks;
    // The palm centre does not move when the fingers close, so grabbing and letting go never jolt the object.
    const c = map(palm), fx = sl.fx.filter(c.x, t), fy = sl.fy.filter(c.y, t);
    sl.target.set(fx, fy, 0); sl.img = palm;
    if (!sl.seen) sl.cursor.copy(sl.target);
    const held0 = heldBy('hand', i);
    if (sl.lostAt && held0) { // back after a dropout: the jump is not a flick, a turn or a stretch
      held0.hist = []; held0.turn = null;
      if (held0.holders.length === 2) join(held0, held0.holders[1]);
    }
    sl.seen = true; sl.lostAt = 0;
    const z = dims().S * 0.8;
    lm.forEach((p, k) => { const w = map(p); sl.skeleton[k].set(w.x + fx - c.x, w.y + fy - c.y, z); });
    const ps = palmSize(frame);
    if (ps) { sl.sizes.push({ t, x: Math.log(ps), y: 0 }); while (sl.sizes.length && t - sl.sizes[0].t > 0.4) sl.sizes.shift(); }
    // Palm orientation (palmQuat) from the 3D landmarks, in screen space: x mirrored like the video, y up, z toward you.
    const wl = frame.worldLandmarks, dir = cb.current.mirrored ? -1 : 1;
    const q = wl.length === 21 ? palmQuat(wl.map(p => [dir * p.x, -p.y, -p.z] as [number, number, number])) : null;
    sl.palm = q ? (sl.palm ?? new THREE.Quaternion()).set(q[0], q[1], q[2], q[3]) : null;

    const grip = sl.grip.update(frame);
    if (grip && !sl.wasGrip && !heldBy('hand', i)) {
      // Closing on something the other hand holds = both hands on it, to stretch it; on something free = take it.
      const { o, join: stretchIt } = pick(sl.target, 'hand');
      if (o && stretchIt) join(o, i); else if (o) grab(o, 'hand', sl.target, i);
    }
    const o = heldBy('hand', i);
    if (o) {
      if (grip) {
        if (o.holders.length === 2) stretch(o);
        if (o.holders[0] === i) {
          o.hist.push({ t, x: fx, y: fy }); if (o.hist.length > 40) o.hist.shift();
          // Turn with the hand: the change in palm orientation since the grab, applied to how the object was held.
          if (sl.palm) {
            if (!o.turn) o.turn = { palm: sl.palm.clone(), rot: o.rot.clone() };
            o.rot.copy(sl.palm).multiply(o.turn.palm.clone().invert()).multiply(o.turn.rot);
          }
        }
      } else letGo(o, i);
    }
    sl.wasGrip = grip;
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05), st = s.current, now = performance.now();
    st.T += dt;
    const { S, floorY } = dims();

    const { frame, frames, at, aspect } = hand.current;
    const all = frames.length ? frames : frame && frame.landmarks.length === 21 ? [frame] : [];
    const fresh = all.length > 0 && now - at < 350;
    if (fresh && at !== st.lastAt) { st.lastAt = at; onHandFrames(all, aspect, now); }
    if (!fresh) st.slots.forEach((_, i) => lose(i, now));
    st.slots.forEach((sl, i) => {
      if (sl.lostAt && now - sl.lostAt > LOST_HOLD) {
        sl.lostAt = 0; sl.grip.reset(); sl.wasGrip = false;
        const o = heldBy('hand', i); if (o) letGo(o, i, true);
      }
    });

    // Draw between camera frames (30/s) so the hands and what they hold glide at the display rate.
    const glide = 1 - Math.exp(-dt * 40);
    let anyHover = false;
    st.slots.forEach((sl, i) => {
      sl.cursor.lerp(sl.target, glide);
      const held = heldBy('hand', i), hover = sl.seen && !held && !!nearest(sl.cursor, o => grabbable(o) || (o.by === 'hand' && o.holders.length === 1));
      anyHover ||= hover;
      sl.glyph.show(sl.seen ? sl.skeleton : null, new V(sl.cursor.x, sl.cursor.y, S * 0.8), pinchCloseness(sl.grip.ratio) || (sl.grip.pinching ? 1 : 0), !!held, hover, S);
      if (held && held.holders[0] === i) {
        held.offset.x *= Math.exp(-dt * 12); held.offset.y *= Math.exp(-dt * 12);
        held.target = clampHeld(held, { x: sl.cursor.x + held.offset.x, y: sl.cursor.y + held.offset.y });
      }
    });

    for (const o of [...st.objs]) { o.hot += ((o.by ? 1 : 0) - o.hot) * Math.min(1, dt * 14); stepObj(o, dt, S, floorY); }
    separate(dt);
    // The portal stays open while anything is going into it or still coming out of it.
    kit.portal.target = st.objs.some(o => o.state === 'out' || (o.state === 'in' && o.age < 0.25 + (o.path?.dur ?? 1) * 0.5)) ? 1 : 0;
    st.fx = st.fx.filter(f => { f.t += dt; const k = Math.min(f.t / f.dur, 1); f.fn(k); return k < 1; });
    kit.particles.update(dt); kit.portal.update(dt, st.T);

    const focus = st.objs.find(o => o.by) ?? st.objs[st.objs.length - 1] ?? null;
    const status: TossStatus = {
      state: focus?.state ?? 'none', label: focus?.label ?? '', hover: anyHover, handSeen: st.slots.some(sl => sl.seen),
      labels: st.objs.filter(o => o.state !== 'out').map(o => o.label), canToss: st.objs.some(o => grabbable(o) && o.state !== 'spawn'),
      busy: st.objs.some(o => o.state === 'out' || o.state === 'in'),
    };
    const key = JSON.stringify(status);
    if (key !== st.statusKey) { st.statusKey = key; cb.current.onStatus(status); }
  });

  /** Objects on the floor nudge each other apart instead of overlapping. */
  function separate(dt: number) {
    const { S } = dims(), floor = s.current.objs.filter(o => !o.by && (o.state === 'rest' || o.state === 'drop' || o.state === 'spawn'));
    for (let a = 0; a < floor.length; a++) for (let b = a + 1; b < floor.length; b++) {
      const A = floor[a], B = floor[b], dx = B.pos.x - A.pos.x, gap = S * (A.scale + B.scale) * 0.42 - Math.abs(dx);
      if (gap <= 0) continue;
      const push = gap * Math.min(1, dt * 8) / 2, sgn = dx === 0 ? 1 : Math.sign(dx);
      A.pos.x = clampX(A, A.pos.x - push * sgn); B.pos.x = clampX(B, B.pos.x + push * sgn);
    }
  }

  function stepObj(o: Obj, dt: number, S: number, floorY: number) {
    const st = s.current, r = o.twin.root, T = st.T, rest = restY(o);
    const damp = (k: number) => { r.rotation.x *= Math.exp(-dt * k); r.rotation.z *= Math.exp(-dt * k); };
    o.age += dt;
    if (o.state === 'spawn') {
      o.scan = Math.min(o.age / 1.4, 1); o.pos.y = rest; r.rotation.y += dt * 0.6;
      kit.scanLine.visible = o.scan < 1;
      kit.scanLine.position.set(o.pos.x, rest - S * 0.5 + Math.min(o.scan * 1.2, 1) * S, 0.9); kit.scanLine.scale.set(S * 1.5, 0.06, 1);
      if (o.scan >= 1) setState(o, 'rest');
    } else if (o.state === 'rest') {
      o.pos.y += (rest + (reduce ? 0 : Math.sin(T * 2.2 + o.pos.x) * 0.04) - o.pos.y) * Math.min(1, dt * 10);
      if (o.handled) r.quaternion.slerp(o.rot, Math.min(1, dt * 10)); // letting go keeps the turn you gave it
      else { r.rotation.y += dt * 0.35; damp(4); }
    } else if (o.state === 'held') {
      if (o.script) {
        const sc = o.script, a = o.age, ease = (t: number) => t * t * (3 - 2 * t);
        const mix = (p: { x: number; y: number }, q: { x: number; y: number }, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        o.target = a < 0.4 ? mix(sc.from, sc.wind, ease(a / 0.4)) : a < 0.55 ? sc.wind : a < 0.67 ? mix(sc.wind, sc.flick, (a - 0.55) / 0.12) : sc.flick;
        o.hist.push({ t: performance.now() / 1000, x: o.target.x, y: o.target.y }); if (o.hist.length > 40) o.hist.shift();
      }
      const a = 1 - Math.exp(-dt * 30), px = o.pos.x, py = o.pos.y;
      o.pos.x += (o.target.x - px) * a; o.pos.y += (o.target.y - py) * a;
      const vx = (o.pos.x - px) / dt, vy = (o.pos.y - py) / dt;
      if (o.by === 'hand') r.quaternion.slerp(o.rot, 1 - Math.exp(-dt * 20)); // follows the palm, smoothed between camera frames
      else {
        r.rotation.z += (clamp(-vx * 0.02, -0.45, 0.45) - r.rotation.z) * Math.min(1, dt * 12);
        r.rotation.x += (clamp(vy * 0.015, -0.35, 0.35) - r.rotation.x) * Math.min(1, dt * 12);
        r.rotation.y += dt * 0.4; o.rot.copy(r.quaternion);
      }
      if (o.script && o.age >= 0.67) release(o);
    } else if (o.state === 'drop') {
      o.vel.y -= G * dt; o.pos.addScaledVector(o.vel, dt); o.vel.x *= Math.exp(-dt * 3);
      o.pos.x = clampX(o, o.pos.x);
      if (o.pos.y <= rest) {
        o.pos.y = rest;
        if (o.vel.y < -3) { squash(o, Math.min(1, -o.vel.y / 14)); o.vel.y *= -0.28; } else { o.vel.set(0, 0, 0); setState(o, 'rest'); }
      }
      if (o.handled) r.quaternion.slerp(o.rot, Math.min(1, dt * 10)); else damp(3);
    } else if (o.state === 'out' && o.path) {
      const { p0, p1, p2, dur } = o.path, k = Math.min(o.age / dur, 1), q = 1 - k;
      o.pos.set(0, 0, 0).addScaledVector(p0, q * q).addScaledVector(p1, 2 * q * k).addScaledVector(p2, k * k);
      r.rotation.x += o.spin.x * dt; r.rotation.y += o.spin.y * dt; r.rotation.z += o.spin.z * dt;
      o.dissolve = clamp((k - 0.6) / 0.4, 0, 1);
      // Sucked in: sparks stream from the object into the portal's centre.
      if (o.dissolve > 0) for (let i = 0; i < (reduce ? 2 : 10); i++) {
        const sx = o.pos.x + rnd(S * 0.3), sy = o.pos.y + rnd(S * 0.4), sz = o.pos.z + rnd(S * 0.2);
        kit.particles.spawn(sx, sy, sz, (p2.x - sx) * 3 + rnd(0.6), (p2.y - sy) * 3 + rnd(0.6), (p2.z - sz) * 3, 0.35 + Math.random() * 0.25);
      }
      if (k >= 0.4 && !o.sent) { o.sent = true; cb.current.onToss({ id: Math.random().toString(36).slice(2, 10), label: o.label, model: o.model, spin: o.spin.toArray() as [number, number, number], scale: o.scale }); }
      if (k >= 1) { remove(o); return; }
    } else if (o.state === 'in' && o.path) {
      // Waits a beat for the portal to open, then flies out of it toward the viewer and down to land.
      const { p0, p1, p2, dur } = o.path, k = clamp((o.age - 0.25) / dur, 0, 1), q = 1 - k;
      p2.x = clampX(o, p2.x); p2.y = rest;
      o.pos.set(0, 0, 0).addScaledVector(p0, q * q).addScaledVector(p1, 2 * q * k).addScaledVector(p2, k * k);
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
    const lift = (1 + 0.08 * o.hot) * o.scale;
    if (o.squash > 0) {
      o.squash = Math.max(0, o.squash - dt);
      const amt = Math.sin((1 - o.squash / 0.4) * Math.PI) * 0.2 * o.squashAmp;
      r.scale.set(o.scale * (1 + amt * 0.6), o.scale * (1 - amt), o.scale * (1 + amt * 0.6)); r.position.y -= amt * S * o.scale * 0.5;
    } else r.scale.setScalar(lift * (o.state === 'out' && o.path ? 1 - 0.75 * Math.min(o.age / o.path.dur, 1) ** 2 : o.state === 'in' ? 0.25 + 0.75 * clamp((o.age - 0.25) / 0.5, 0, 1) : 1));
    o.twin.set(T, o.dissolve, o.scan, o.hot, o.scale);
    const up = 1 - Math.min(Math.max(0, o.pos.y - rest) / (halfH * 1.2), 0.85);
    const vis = o.state === 'spawn' ? o.scan : o.state === 'out' ? 1 - o.dissolve : o.state === 'in' ? (1 - o.dissolve) * clamp((o.age - 0.25) / 0.7, 0, 1) : 1;
    o.shadow.position.set(o.pos.x, floorY, o.pos.z - 0.3);
    o.shadow.scale.set(S * o.scale * 1.1 * (0.55 + 0.45 * up), S * o.scale * 0.24 * (0.55 + 0.45 * up), 1);
    (o.shadow.material as THREE.MeshBasicMaterial).opacity = 0.7 * up * vis;
  }

  return null;
}

/** Full-screen overlay: the tossable objects, your tracked hands, and the portal they leave and arrive through. */
export function TossScene(props: Props) {
  return <div className="toss-layer">
    <Canvas linear flat dpr={[1, 2]} camera={{ fov: 40, position: [0, 0, 10], near: 0.1, far: 100 }} gl={{ alpha: true, antialias: true }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
      <World {...props} />
    </Canvas>
  </div>;
}
