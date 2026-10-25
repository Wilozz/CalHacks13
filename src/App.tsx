import {PageHeading} from './components/ui/page-heading';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useCall } from './CallPanel';
import { normalizeRoomCode, ROOM_PATTERN } from './callSignaling';
import { Icon } from './icons';
import { useMobileDevice } from './device';
import type { LiveData } from './HandScene';
import { BONES, type HandFrame } from './coordinates';
import { BUILTIN_MODELS, sanitizeModel } from './ai/modelSpec';
import { isPointingPose } from './ai/handHistory';
import { SceneCache } from './ai/sceneCache';
import { SceneOverlay, ScenePanel } from './render/SceneUi';
import { useSceneScan } from './useSceneScan';
import { httpAiClient } from './ai/client';
import type { SceneObject } from './ai/types';
import { VoiceAgent, type Heard } from './voice/agent';
import type { FocusDecision } from './voice/referent';
import { useVoice } from './voice/useVoice';
import { VoiceBar } from './voice/VoiceBar';
import { mapToFeed } from './remote/placement';
import { HandAdvanced, HandQuickControls } from './remote/HandOverlayPanel';
import { DEFAULT_PLACEMENT, type Placement } from './remote/placement';
import { LoopbackChannel, RemoteHandState, RtcHandChannel } from './remote/remoteHand';
import { HandSlots } from './remote/handSlots';
import { DemoPanel } from './render/DemoPanel';
import { TwinBox } from './render/TwinBox';
import { twinKindForLabel } from './render/motion';
import { isLanyard } from './remote/kitRig';
import { DEMO_BASE } from './render/useTwinMesh';
import { decodePose, decodeSay, decodeTwin, encodePose, encodeSay, encodeTwin, REST_POSE, type TwinInfo, type TwinPose } from './remote/twinWire';
import { captureFrame } from './useSceneScan';
import { MATCH, useObjectFinder } from './useObjectFinder';
import { ThrowLesson } from './replay/lesson';
import { keepSharedReplay, saveReplay } from './replay/Tutorials';
// The 3D copy changes hands: whoever holds it drives it, and throwing it gives it to the other screen.
const THROW = JSON.stringify({ type: 'twin-throw' });
// The id of a lesson just saved, so the other person keeps the same recording (with these hands in it).
const lessonId = (text: string) => { try { const m = text.length < 200 && JSON.parse(text); return m?.type === 'lesson' && typeof m.id === 'string' && m.id.length < 64 ? m.id as string : null; } catch { return null; } };
// In a call, the agent checks your camera for the lanyard this often (one check at a time) until it is out (README "The call").
const LOOK_MS = 1200;
const SLOTS = [0, 1] as const;
type Facing = 'user' | 'environment';
type Phase = 'idle' | 'loading' | 'running' | 'error';
export default function App({communitySession}:{communitySession?:{id:string;token:string}}) {
  const mobile = useMobileDevice();
  const [facing, setFacing] = useState<Facing>('user');
  const [notice, setNotice] = useState('');
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const video = useRef<HTMLVideoElement>(null!);
  const overlay = useRef<HTMLCanvasElement>(null!);
  const live = useRef<LiveData>({frame:null,receivedAt:0,aspect:4/3,renderFps:0,mirrored:true});
  const cleanup = useRef<() => void>(() => {});
  const debug = useRef(false); // landmark dots are a debug view; the cyan hand is the real output
  const generation = useRef(0);
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const [hoverId,setHoverId] = useState<string|null>(null);
  const inCallRef = useRef(false); // auto-select-by-pointing only makes sense when the object is in my own camera
  const sceneCache = useRef(new SceneCache(1e9));
  // Solo demo of the remote-hand path: local hand -> wire codec -> (simulated network) -> overlay on this feed.
  const myHand = useRef(new RemoteHandState());
  const loop = useRef<LoopbackChannel|null>(null);
  const [handOn,setHandOn] = useState(true);
  const [labOpen,setLabOpen] = useState(false);
  const [moreOpen,setMoreOpen] = useState(false);
  const [code,setCode] = useState('');
  const call = useCall(() => video.current?.srcObject instanceof MediaStream ? video.current.srcObject : null);
  useEffect(()=>{if(communitySession)call.start(undefined,communitySession);},[communitySession]);
  const handOnRef = useRef(true);
  const slots = useRef(new HandSlots());       // keeps each of the two hands in its own slot
  const slotSent = useRef([false, false]);     // whether a hand in that slot is currently being sent
  // In a call: my hand goes to the friend over the data channel, and theirs arrives in peerHand.
  const peerHand = useRef(new RemoteHandState());
  const rtc = useRef<RtcHandChannel|null>(null);
  const [friendAspect,setFriendAspect] = useState(4/3);
  const friendAspectRef = useRef(4/3); friendAspectRef.current = friendAspect;
  // While a friend's hand is arriving, their guidance is the point: show my own camera big, with their hand on it.
  const [guided,setGuided] = useState(false);
  const lastPeerHand = useRef(0);
  useEffect(() => {
    const dc = call.handChannel;
    if (!dc) { rtc.current = null; peerHand.current.reset(); return; }
    const ch = new RtcHandChannel(dc);
    ch.onMessage(buf => { peerHand.current.accept(buf, performance.now()); });
    rtc.current = ch;
    return () => { ch.close(); if (rtc.current === ch) rtc.current = null; };
  }, [call.handChannel]);
  useEffect(() => {
    const v = call.friendVideo.current; if (!v) return;
    const update = () => { if (v.videoWidth && v.videoHeight) setFriendAspect(v.videoWidth / v.videoHeight); };
    v.addEventListener('loadedmetadata', update); v.addEventListener('resize', update);
    return () => { v.removeEventListener('loadedmetadata', update); v.removeEventListener('resize', update); };
  }, [call.friendVideo]);
  const [placement,setPlacement] = useState<Placement>(DEFAULT_PLACEMENT);
  useEffect(() => {
    const ch = new LoopbackChannel();
    ch.onMessage(buf => { myHand.current.accept(buf, performance.now()); });
    loop.current = ch;
    return () => { ch.close(); loop.current = null; };
  }, []);
  useEffect(() => { handOnRef.current = handOn; if (!handOn) { myHand.current.reset(); rtc.current?.send(null); } }, [handOn]);
  // The listening agent: hears the conversation, follows what is pointed at, decides which object to show.
  const aiClient = useRef(httpAiClient()).current;
  const agent = useRef<VoiceAgent|null>(null);
  const objectsRef = useRef<SceneObject[]>([]);
  const placementRef = useRef<Placement>(DEFAULT_PLACEMENT);
  const helperRef = useRef(false);
  const [focusInfo,setFocusInfo] = useState<FocusDecision|null>(null);
  const [topic,setTopic] = useState('');
  const [heard,setHeard] = useState<Heard|null>(null);
  const [phase,setPhase] = useState<Phase>('idle');
  const [message,setMessage] = useState('');
  const [showOverlay,setShowOverlay] = useState(false);
  const [stats,setStats] = useState({fps:0,latency:0,inference:0,tracked:false,hand:'',world:false});
  useEffect(() => {
    const timer = window.setInterval(() => {
      const {frame,receivedAt,renderFps} = live.current;
      // Whose hand is pointing: mine when I am showing it, otherwise the friend's, as it arrives.
      const nowPt = performance.now();
      const pf = (!inCallRef.current || helperRef.current) ? (live.current.frame && nowPt-receivedAt<350 ? live.current.frame : null) : (peerHand.current.current(nowPt, 0) ?? peerHand.current.current(nowPt, 1));
      let hover: string|null = null;
      if (pf && isPointingPose(pf.landmarks)) {
        // In a call the fingertip is mapped into the other camera's frame; alone it shares the camera's frame.
        const tip = inCallRef.current ? mapToFeed(pf.landmarks[8], placementRef.current) : pf.landmarks[8];
        hover = sceneCache.current.candidatesAt(tip,0.03,1)[0]?.object.objectId ?? null;
      }
      agent.current?.point(hover); agent.current?.tick();
      setHoverId(hover);
      const nowMs = performance.now();
      if (peerHand.current.current(nowMs, 0) || peerHand.current.current(nowMs, 1)) lastPeerHand.current = nowMs;
      setGuided(nowMs - lastPeerHand.current < 2500 && lastPeerHand.current > 0);
      setStats({fps:Math.round(renderFps),latency:frame ? Math.round(receivedAt-frame.timestamp):0,inference:Math.round(frame?.inferenceMs ?? 0),tracked:!!frame?.landmarks.length && performance.now()-receivedAt<350,hand:frame?.handedness ?? '',world:!!frame?.worldLandmarks.length});
    },250);
    return () => { clearInterval(timer); generation.current++; cleanup.current(); };
  },[]);
  useEffect(() => {
    const visibility = () => {
      setPageVisible(!document.hidden);
      if (document.hidden) live.current.frame = null;
    };
    // Safari may preserve the page in its back/forward cache: release the camera first.
    const pagehide = () => stop();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
    };
  }, []);
  function stop() {
    generation.current++; cleanup.current(); live.current.frame=null; live.current.hands=[null,null]; slots.current.reset(); myHand.current.reset(); rtc.current?.send(null,0); rtc.current?.send(null,1);
    setPhase('idle'); setMessage('');
  }
  /** from: the call's own stream, so tracking shares the call's camera (a clone of its track) instead of opening it twice. */
  async function start(requestedFacing: Facing = facing, from?: MediaStream) {
    cleanup.current();
    live.current.frame=null;
    setNotice('');
    const token=++generation.current;
    let stream: MediaStream | undefined;
    let worker: Worker | undefined;
    let raf=0, busy=false, lastVideoTime=-1, lastSent=0;
    let cancelled=false;
    let modelTimeout: number | undefined;
    let removeResize = () => {};
    let removeEnded = () => {};
    const capture = document.createElement('canvas');
    let useCanvasCapture = mobile;
    const dispose = () => {
      cancelled=true; removeResize(); removeEnded(); clearTimeout(modelTimeout); cancelAnimationFrame(raf); worker?.terminate();
      stream?.getTracks().forEach(track=>track.stop());
      if(video.current) video.current.srcObject=null;
      overlay.current?.getContext('2d')?.clearRect(0,0,overlay.current.width,overlay.current.height);
    };
    cleanup.current=dispose;
    const fail=(error:unknown) => {
      if(token!==generation.current || cancelled) return;
      dispose(); live.current.frame=null; setPhase('error');
      const name=error instanceof Error ? error.name : '';
      setMessage(name==='NotAllowedError' ? 'Camera access was denied. Allow camera access in your browser’s site settings, then retry.' : name==='NotFoundError' ? 'No camera found. Connect a webcam and retry.' : name==='NotReadableError' ? 'Camera is unavailable or in use by another app. Close that app and retry.' : `Could not start tracking. Check your camera and internet connection, then retry. ${error instanceof Error ? error.message : String(error)}`);
    };
    setPhase('loading'); setMessage('Requesting camera access…');
    try {
      if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Open Handoff over trusted HTTPS on your phone. A laptop’s HTTP LAN address cannot access your camera. Localhost only works on the device serving the app.');
      const shared = from?.getVideoTracks().find(t => t.readyState==='live');
      stream=shared ? new MediaStream([shared.clone()]) : await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:requestedFacing},width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:mobile?30:60}}});
      if(cancelled) { stream.getTracks().forEach(t=>t.stop()); return; }
      const track = stream.getVideoTracks()[0];
      const ended = () => fail(new Error('The camera was disconnected or access was revoked. Tap Enable camera to reconnect.'));
      track.addEventListener('ended', ended);
      removeEnded = () => track.removeEventListener('ended', ended);
      const actualFacing = track.getSettings().facingMode;
      const selectedFacing = actualFacing === 'environment' ? 'environment' : actualFacing === 'user' ? 'user' : requestedFacing;
      setFacing(selectedFacing);
      live.current.mirrored = selectedFacing === 'user';
      if (actualFacing && actualFacing !== requestedFacing) setNotice('The requested camera is unavailable. Using the available camera.');
      video.current.srcObject=stream;
      await video.current.play();
      if(cancelled) return;
      const resize = () => {
        const v = video.current;
        if (!v.videoWidth || !v.videoHeight) return;
        live.current.aspect=v.videoWidth/v.videoHeight;
        // Mobile browsers may change video dimensions when the phone rotates.
        overlay.current.width=v.videoWidth;
        overlay.current.height=v.videoHeight;
        live.current.frame=null;
      };
      resize();
      video.current.addEventListener('resize', resize);
      removeResize = () => video.current?.removeEventListener('resize', resize);
      setMessage('Loading hand tracking model…');
      worker=new Worker(`${import.meta.env.BASE_URL}tracking.worker.js`);
      worker.onerror=()=>fail(new Error('Tracking worker failed to load. Try a recent iOS Safari or Android/desktop Chrome browser.'));
      worker.onmessage=({data})=>{
        if(cancelled) return;
        if(data.type==='error') { fail(new Error(data.message)); return; }
        if(data.type==='ready') { clearTimeout(modelTimeout); setPhase('running'); setMessage(''); raf=requestAnimationFrame(tick); }
        if(data.type==='result') {
          busy=false;
          if(Math.abs(data.aspect-live.current.aspect)>.01) return;
          // Up to two hands, each held in its own slot so they never swap. `frame` stays the main hand for everything single-handed.
          const found = ((data.frames as HandFrame[] | undefined) ?? [data.frame as HandFrame]).filter(f => f.landmarks.length === 21);
          const both = slots.current.update(found, performance.now());
          const frame = (both[0] ?? both[1] ?? data.frame) as HandFrame;
          if(document.hidden) return;
          live.current.frame=frame; live.current.hands=both; live.current.receivedAt=performance.now();
          lesson.current?.tick(performance.now(), both.filter((h): h is HandFrame => !!h), performance.now(), [], lastPose.current);
          if(handOnRef.current) SLOTS.forEach(sl => { const h = both[sl]; if (h || slotSent.current[sl]) { loop.current?.send(h, sl); rtc.current?.send(h, sl); slotSent.current[sl] = !!h; } });
          const canvas=overlay.current, ctx=canvas.getContext('2d');
          ctx?.clearRect(0,0,canvas.width,canvas.height);
          if(ctx && debug.current && frame.landmarks.length) {
            ctx.strokeStyle='#40e9df'; ctx.fillStyle='#d4fffc'; ctx.lineWidth=2;
            for(const [a,b] of BONES) { const p=frame.landmarks[a],q=frame.landmarks[b]; ctx.beginPath(); ctx.moveTo(p.x*canvas.width,p.y*canvas.height); ctx.lineTo(q.x*canvas.width,q.y*canvas.height); ctx.stroke(); }
            frame.landmarks.forEach(p=>{ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,3,0,Math.PI*2);ctx.fill();});
          }
        }
      };
      function tick(now:number) {
        if(cancelled) return;
        raf=requestAnimationFrame(tick);
        const v=video.current;
        if(document.hidden || busy || v.readyState<2 || v.currentTime===lastVideoTime || now-lastSent<1000/(mobile?30:60)-(mobile?1:0)) return;
        busy=true; lastVideoTime=v.currentTime; lastSent=now;
        async function snapshot() {
          if (!useCanvasCapture) {
            try { return await createImageBitmap(v); }
            catch { useCanvasCapture=true; } // Safari video-to-bitmap fallback.
          }
          // Keep the actual aspect ratio; cap capture resolution for mobile thermals.
          const scale=Math.min(1,640/Math.max(v.videoWidth,v.videoHeight));
          const width=Math.max(1,Math.round(v.videoWidth*scale));
          const height=Math.max(1,Math.round(v.videoHeight*scale));
          if(capture.width!==width || capture.height!==height) { capture.width=width; capture.height=height; }
          const ctx=capture.getContext('2d');
          if(!ctx) throw new Error('Canvas frame capture is unavailable in this browser.');
          ctx.drawImage(v,0,0,width,height);
          return createImageBitmap(capture);
        }
        snapshot().then(bitmap=>{
          if(cancelled) {bitmap.close();return;}
          worker!.postMessage({type:'frame',bitmap,timestamp:now,aspect:bitmap.width/bitmap.height},[bitmap]);
        }).catch(fail);
      }
      modelTimeout=window.setTimeout(()=>fail(new Error('Model loading timed out. Check that model downloads are allowed by your network.')),45000);
      worker.postMessage({type:'init', numHands:2});
    } catch(error) { fail(error); }
  }
  const active=phase==='running';
  const screen = call.status==='idle' ? 'home' : call.status==='connected'||call.status==='disconnected' ? 'incall' : 'calling';
  // Whoever is showing a hand drives the copy; the other screen displays what they send.
  const helperMode = handOn && active && !guided;
  helperRef.current = helperMode; placementRef.current = placement;

  if (!agent.current) agent.current = new VoiceAgent({
    client: aiClient, now: () => performance.now(), getObjects: () => objectsRef.current,
    onFocus: d => { setFocusInfo(d); if (d.objectId && objectsRef.current.some(o => o.objectId===d.objectId && isLanyard(`${o.label} ${o.parentLabel ?? ''}`))) setSelectedId(d.objectId); },
    onTopic: setTopic, onHeard: setHeard,
  });
  useEffect(() => () => agent.current?.dispose(), []);

  // What I say goes to my agent and, as text only, to my friend's.
  const sayRef = useRef<(text:string)=>void>(() => {});
  const voice = useVoice({
    client: aiClient,
    // In a call the call's own microphone is used, so muting the call also stops the transcript.
    getStream: async () => {
      const mic = call.local?.getAudioTracks().filter(t => t.readyState==='live') ?? [];
      return mic.length ? { stream: new MediaStream(mic), owned: false }
        : { stream: await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }), owned: true };
    },
    onFinal: text => { agent.current?.hear('me', text); sayRef.current(text); },
  });

  const scene = useSceneScan(video, active, {
    // While listening, look again whenever the view changes; helpers watch their friend's camera, everyone else their own.
    watch: voice.state==='listening' && (active || screen==='incall'),
    getSource: () => (inCallRef.current && helperRef.current ? call.friendVideo.current : video.current),
    beforeScan: src => { const friend = !!src && src===call.friendVideo.current; scanAspect.current = friend ? friendAspectRef.current : live.current.aspect; setScannedFrom(friend ? 'friend' : 'mine'); },
  });
  useEffect(() => {
    objectsRef.current = scene.objects;
    sceneCache.current.clear(); sceneCache.current.update(scene.objects, performance.now()/1000);
    setSelectedId(id => scene.objects.some(o => o.objectId===id) ? id : null);
  }, [scene.objects]);
  const selected = scene.objects.find(o => o.objectId===selectedId) ?? null;
  function switchCamera() {
    const next=facing==='user'?'environment':'user';
    if(phase==='running') void start(next);
    else { setFacing(next); live.current.mirrored=next==='user'; }
  }
  function setLandmarks(on:boolean) {
    setShowOverlay(on); debug.current=on;
    if(!on) overlay.current.getContext('2d')?.clearRect(0,0,overlay.current.width,overlay.current.height);
  }
  const cameraOn = phase==='loading' || active;
  // In a call without the tracking camera, the call's own stream is the self-view.
  const selfFromCall = screen!=='home' && !cameraOn;
  inCallRef.current = screen!=='home';

  // The helper's guidance lives in a small box: a 3D copy of the object with their hand on it. Both screens show it.
  const [twin,setTwin] = useState<TwinInfo|null>(null);
  const twinRef = useRef<TwinInfo|null>(null); twinRef.current = twin;
  // Who holds the copy: whoever brought it out, until they throw it. The holder drives it; the other screen shows their pose.
  const [holder,setHolder] = useState<'me'|'friend'>('me');
  const lastPose = useRef<TwinPose>(REST_POSE); // my latest pose of the copy, for the lesson
  const [toasts,setToasts] = useState<{id:number;text:string}[]>([]);
  const show = (text:string) => { const id = Math.random(); setToasts(t => [...t.slice(-2), {id,text}]); window.setTimeout(() => setToasts(t => t.filter(x => x.id!==id)), 2600); };
  // Lessons record themselves, silently: from catching the copy until you throw it back. Saved, then sent to your friend too.
  const lesson = useRef<ThrowLesson|null>(null);
  if (!lesson.current) lesson.current = new ThrowLesson(r => {
    // [lesson] logs: each step of saving and sharing, to find where a shared lesson goes missing (both people's consoles).
    console.info(`[lesson] recorded ${r.label}: ${r.durationMs} ms, ${r.hands.filter(x => x.hands.length).length} frames with hands, ${r.twinPoses.length} poses`);
    saveReplay(r, `${r.label} lesson`).then(id => {
      show('Lesson saved to Tutorials');
      const dc = controlRef.current, open = dc?.readyState==='open';
      console.info(`[lesson] saved ${id} on ${import.meta.env.VITE_CONVEX_URL}; ${open ? 'sent to friend' : 'call closed, not shared'}`);
      if (open) dc!.send(JSON.stringify({ type:'lesson', id }));
    }, e => { console.warn('Lesson not saved:', e); show('Lesson could not be saved'); });
  });
  const lessonRef = lesson.current;
  useEffect(() => () => lessonRef.end(performance.now()), [lessonRef]);
  const controlRef = useRef<RTCDataChannel|null>(null);
  const remotePose = useRef<TwinPose>(REST_POSE); // where the helper has moved the copy
  const scanAspect = useRef(4/3);
  const [scannedFrom,setScannedFrom] = useState<'mine'|'friend'>('mine'); // outlines only make sense over the camera that was scanned
  const prevSelected = useRef<string|null>(null);
  sayRef.current = text => { const dc = controlRef.current; if (dc?.readyState==='open') dc.send(encodeSay(text)); };
  const sendPose = (p:TwinPose) => { lastPose.current = p; lesson.current?.posed(performance.now(), p); const dc = controlRef.current; if (dc?.readyState==='open') dc.send(encodePose(p)); };
  const sendTwin = (t:TwinInfo|null) => { const dc = controlRef.current; if (dc?.readyState==='open') dc.send(encodeTwin(t)); };
  useEffect(() => {
    const dc = call.controlChannel; controlRef.current = dc;
    if (!dc) return;
    dc.onmessage = e => {
      if (typeof e.data !== 'string') return;
      const said = decodeSay(e.data); if (said) { agent.current?.hear('friend', said); return; }
      const pose = decodePose(e.data); if (pose) { remotePose.current = pose; return; }
      if (e.data===THROW) { const t = twinRef.current; if (!t) return;
        // Caught: it is mine to handle now, and the lesson starts.
        console.info(`[lesson] caught ${t.label}, recording`);
        setHolder('me'); show(`Your friend threw you the ${t.label}`);
        lesson.current!.caught(t.objectId, t.label, t.model, live.current.aspect, performance.now(), t); return; }
      const shared = lessonId(e.data);
      if (shared) { console.info(`[lesson] friend shared ${shared}; keeping it on ${import.meta.env.VITE_CONVEX_URL}`); keepSharedReplay(shared).then(() => { console.info('[lesson] kept friend’s lesson'); show('Your friend’s lesson was saved to Tutorials'); }, err => { console.warn('Lesson not kept:', err); show('Your friend’s lesson could not be saved here'); }); return; }
      const t = decodeTwin(e.data); if (t !== undefined) { remotePose.current = REST_POSE; setTwin(t); setHolder('friend'); if (!t) lesson.current!.end(performance.now()); }
    };
    const onOpen = () => { if (twinRef.current) dc.send(encodeTwin(twinRef.current)); };
    dc.addEventListener('open', onOpen);
    return () => { dc.onmessage = null; dc.removeEventListener('open', onOpen); if (controlRef.current === dc) controlRef.current = null; };
  }, [call.controlChannel]);
  useEffect(() => {
    if (selectedId === prevSelected.current) return;
    prevSelected.current = selectedId;
    // A lanyard is the demo's two-piece kit: it uses the kit's own model, and its box covers the card, clasp and strap
    // together (Claude may list them separately), so a SAM 3D scan takes in the whole thing.
    const lanyard = !!selected && isLanyard(`${selected.label} ${selected.parentLabel ?? ''}`);
    const kitBox = (): [number,number,number,number] => { const bs = scene.objects.filter(o => isLanyard(`${o.label} ${o.parentLabel ?? ''}`)).map(o => o.bbox); return [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))]; };
    const t: TwinInfo|null = selected ? { objectId: selected.objectId, label: lanyard ? 'lanyard' : selected.label, bbox: lanyard ? kitBox() : selected.bbox, feedAspect: scanAspect.current,
      model: lanyard ? sanitizeModel(BUILTIN_MODELS.lanyard)! : selected.model ?? sanitizeModel(BUILTIN_MODELS[twinKindForLabel(selected.label, selected.parentLabel)])! } : null;
    setTwin(t); sendTwin(t); setHolder('me');
  }, [selectedId, selected]);
  useEffect(() => { if (screen==='home' && !selectedId) setTwin(null); }, [screen]);
  // Objects saved for the demo ship with the app (public/demo): open one without scanning. ?demo=lanyard opens it on load.
  const [saved,setSaved] = useState<{key:string;label:string}[]>([]);
  const openSaved = async (key:string) => {
    try {
      const m = await (await fetch(`${DEMO_BASE}${key}.json`)).json();
      const t = decodeTwin(JSON.stringify({ ...m.twin, type:'twin' }));
      if (t) { setSelectedId(null); prevSelected.current = null; setTwin(t); sendTwin(t); setHolder('me'); return true; }
    } catch { /* not saved after all */ }
    return false;
  };
  // The lanyard, where it was seen (bbox), as the model saved for the demo or else the built-in one.
  const showLanyard = async (bbox: [number,number,number,number] = [0.3,0.2,0.7,0.85]) => {
    let model = sanitizeModel(BUILTIN_MODELS.lanyard)!;
    try { const m = await (await fetch(`${DEMO_BASE}lanyard.json`)).json(); const saved = decodeTwin(JSON.stringify({ ...m.twin, type:'twin' })); if (saved) model = saved.model; } catch { /* not saved: the built-in one */ }
    const t: TwinInfo = { objectId: 'lanyard', label: 'lanyard', bbox, feedAspect: live.current.aspect, model };
    setSelectedId(null); prevSelected.current = null; setTwin(t); sendTwin(t); setHolder('me');
  };
  const throwTwin = () => {
    const t = twinRef.current, dc = controlRef.current;
    if (!t || dc?.readyState!=='open') return;
    dc.send(THROW); remotePose.current = lastPose.current; setHolder('friend'); show(`Threw the ${t.label} to your friend`);
    lesson.current!.thrown(t.objectId, performance.now());
  };
  useEffect(() => {
    fetch(`${DEMO_BASE}index.json`).then(r => r.ok ? r.json() : []).then(l => setSaved(Array.isArray(l) ? l.filter(x => typeof x?.key==='string' && typeof x?.label==='string') : [])).catch(() => setSaved([]));
    const want = new URLSearchParams(location.search).get('demo');
    if (want && /^[a-z0-9-]{1,40}$/.test(want)) void openSaved(want);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Finding the lanyard, in a call until it is out. On this device: every object boxed ~8 times a second, the most
  // lanyard-like one picked at once (useObjectFinder). Alongside, Claude's check (a small frame, one yes/no, ~1/s) is
  // the backup; what it finds is kept as a real picture, so next time the device finds it at once.
  const looking = screen==='incall' && (phase==='loading' || active) && !twin; // the camera is on: no need to wait for hand tracking
  const finder = useObjectFinder(video, looking, () => live.current.hands ?? [], bbox => { console.info('[find] on device'); void showLanyard(bbox); });
  // Every object boxed on my camera while looking (tap one to say "that is the lanyard"); hand regions only when they match.
  const seen = finder.boxes.filter(b => b.label!=='in hand' || b.sim>=MATCH);
  useEffect(() => {
    if (!looking) return;
    let live = true, timer = 0;
    const look = async () => {
      let wait = LOOK_MS;
      const shot = captureFrame(video.current, 448, 0.6);
      if (shot) try {
        const r = await aiClient.findLanyard({ imageBase64: shot.imageBase64, mediaType: 'image/jpeg' });
        if (live && r.found) { console.info('[find] by Claude'); if (r.bbox) finder.learn(r.bbox); void showLanyard(r.bbox ?? undefined); return; }
      } catch (e) { wait = 5000; console.warn('Lanyard check failed:', e); } // no AI server or key: try again later, quietly
      if (live) timer = window.setTimeout(look, wait);
    };
    timer = window.setTimeout(look, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [looking]); // eslint-disable-line react-hooks/exhaustive-deps
  const wasInCall = useRef(false);
  useEffect(() => {
    if (screen!=='home') { wasInCall.current = true; return; }
    lesson.current!.end(performance.now()); setHolder('me');
    if (wasInCall.current) { wasInCall.current = false; stop(); } // the call is over: the camera goes off with it
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tracking starts with the call (the hands are how you hold the lanyard), on the call's own camera.
  const begin = (room?:string) => call.start(room);
  useEffect(() => { if (screen!=='home' && call.local && phase==='idle') void start(facing, call.local); }, [call.local, screen]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseObject = (id:string|null) => { setSelectedId(id); if (id) agent.current?.tracker.mention(id, 1, performance.now()); };
  const scanMine = () => { void scene.scan(video.current); };
  const scanFriend = () => { void scene.scan(call.friendVideo.current); };
  const closeTwin = () => { setTwin(null); setSelectedId(null); sendTwin(null); setHolder('me'); lesson.current!.end(performance.now()); };
  // App re-renders every 250 ms for stats, which also ticks this clock.
  const elapsed = call.connectedAt ? Math.floor((Date.now()-call.connectedAt)/1000) : 0;
  const clock = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
  const validCode = ROOM_PATTERN.test(normalizeRoomCode(code));
  const callStatus = call.status==='preparing' ? 'Getting camera and microphone ready…' : call.status==='connecting' ? 'Connecting…' : 'Waiting for your friend…';
  return <main className={`app ${mobile?'phone':'mac'} ${screen} ${guided && !twin && screen==='incall' ? 'guided' : ''}`}>
    <div className="remote">
      <video ref={call.friendVideo} className="friend-video" autoPlay playsInline/>
      {screen==='incall' && !call.remote && <p className="remote-wait">Waiting for video…</p>}
      {call.playBlocked && <button className="pill-button play-audio" onClick={call.retryPlay}>Play friend’s audio and video</button>}
    </div>
    <div className={`self ${selfFromCall?'from-call':''}`}>
      <div className={`camera-stage ${facing==='user'?'mirrored':''}`} style={{'--ar':live.current.aspect} as CSSProperties}>
        <video ref={video} autoPlay playsInline muted/><canvas ref={overlay} className={showOverlay?'':'hidden'}/>
        {looking && <SceneOverlay objects={seen.map((b,i) => ({ objectId:String(i), label: b.sim>=MATCH ? 'lanyard' : b.label, bbox:b.bbox, affordances:[], confidence:b.score, seenAt:0 }))}
          selectedId={seen.findIndex(b => b.sim>=MATCH) >= 0 ? String(seen.findIndex(b => b.sim>=MATCH)) : null} hoverId={null} aspect={live.current.aspect} mirrored={facing==='user'}
          onSelect={id => { const b = seen[+id]; if (b) { finder.learn(b.bbox); void showLanyard(b.bbox); } }}/>}
        {screen==='home' && active && scannedFrom==='mine' && <SceneOverlay objects={scene.objects} selectedId={selectedId} hoverId={hoverId} aspect={live.current.aspect} mirrored={facing==='user'} onSelect={chooseObject}/>}
      </div>
      <video ref={call.selfVideo} className="self-video" autoPlay muted playsInline/>
      {screen==='home' && !active && <div className="camera-empty">
        <p role={phase==='error'?'alert':'status'}>{phase==='idle' ? 'Your camera and hand tracking turn on when the call starts.' : message}</p>
        {phase!=='loading' && <button className="pill-button" onClick={() => void start()}>{phase==='error'?'Try again':'Turn on camera'}</button>}
      </div>}
      {screen==='home' && active && <span className="self-label">{stats.tracked ? 'Hand tracked' : 'Looking for your hand'}</span>}
      {screen==='home' && cameraOn && <div className="preview-actions">
        <button className="round small" disabled={phase==='loading'} onClick={switchCamera} aria-label={`Switch to ${facing==='user'?'rear':'front'} camera`}><Icon name="flip" size={20}/></button>
        <button className="pill-button" onClick={stop}>{phase==='loading'?'Cancel':'Turn off camera'}</button>
      </div>}
      {screen!=='home' && call.cameraOff && <p className="self-off">Camera off</p>}
    </div>
    {screen!=='calling' && <VoiceBar state={voice.state} engine={voice.engine} partial={voice.partial} error={voice.error} heard={heard} objects={scene.objects} focus={focusInfo} topic={topic}
      onToggle={() => voice.state==='listening' ? voice.stop() : voice.start()} onChoose={chooseObject} onAccept={voice.accept} onDecline={voice.decline}/>}
    {twin && (screen==='home' || screen==='incall') && <TwinBox twin={twin} mirror={screen==='home'} hand={holder==='me' ? myHand : peerHand} drive={holder==='me' ? 'local' : 'remote'} remotePose={remotePose} onPose={sendPose} placement={placement} posFlip={screen==='home' ? false : placement.flipX} onClose={closeTwin} onThrow={screen==='incall' ? throwTwin : undefined} stage={screen==='incall'} frame={holder==='me' && scene.objects.some(o => o.objectId===twin.objectId) ? scene.frame.current : null}/>}
    {toasts.length > 0 && <div className="throw-toasts">{toasts.map(t => <p key={t.id} className="throw-toast" role="status">{t.text}</p>)}</div>}
    {screen==='home' && <section className="home-panel" aria-label="Start a call">
      <PageHeading compact eyebrow="Handoff LIVE" title={<>A hand.<br/><span className="gradient-text">From anywhere.</span></>} description="Show someone what to do with your hands."/>
      <button className="primary" onClick={() => begin()}><Icon name="video" size={20}/>New call</button>
      <form className="join" onSubmit={e => { e.preventDefault(); if(validCode) begin(code); }}>
        <label htmlFor="room-input">Join with a code</label>
        <div><input id="room-input" value={code} onChange={e => setCode(normalizeRoomCode(e.target.value).slice(0,6))} placeholder="ABC234" maxLength={8} spellCheck={false} autoCapitalize="characters" autoComplete="off" enterKeyHint="go"/><button type="submit" disabled={!validCode}>Join</button></div>
      </form>
      {call.error && <p className="banner error" role="alert">{call.error}</p>}
      {call.hint && <p className="banner" role="status">{call.hint}</p>}
      {notice && <p className="banner" role="status">{notice}</p>}
      <button className="text-button" onClick={() => setMoreOpen(true)}>Hand tools and lab</button>
      <p className="fine">Hand tracking runs on this device. Your friend gets your video and voice only.</p>
    </section>}
    {screen==='calling' && <section className="calling-info" aria-label="Calling">
      <p className="code" data-testid="room-code">{call.room || '······'}</p>
      <p className="call-status" role="status">{callStatus}</p>
      {call.room && <button className="pill-button" onClick={call.share}><Icon name="share" size={16}/>Share code</button>}
      {call.hint && <p className="fine" role="status">{call.hint}</p>}
      {call.room && !call.relay && <p className="fine">No TURN relay on this server, so calls across networks may fail.</p>}
    </section>}
    {screen==='incall' && !twin && !active && phase!=='loading' && <p className="hand-hint" role="status">Tap the hand button to turn on hand tracking</p>}
    {screen==='incall' && <div className="call-pill" role="status"><b data-testid="room-code">{call.room}</b><span data-testid="call-state">{call.status==='connected' ? clock : 'Reconnecting…'}</span>{call.route && <span>{call.route}</span>}</div>}
    {screen!=='home' && <div className="controls">
      <button className="round" disabled={!call.local} aria-pressed={call.muted} aria-label={call.muted?'Unmute microphone':'Mute microphone'} onClick={call.toggleMute}><Icon name={call.muted?'micOff':'mic'}/></button>
      <button className="round" disabled={!call.local} aria-pressed={call.cameraOff} aria-label={call.cameraOff?'Turn camera on':'Turn camera off'} onClick={call.toggleCamera}><Icon name={call.cameraOff?'videoOff':'video'}/></button>
      <button className="round" aria-pressed={handOn && active} aria-label="Show my hand" onClick={() => { if(!cameraOn) { setHandOn(true); void start(); } else setHandOn(v => !v); }}><Icon name="hand"/></button>
      <button className="round" aria-label="Hand tools" onClick={() => setMoreOpen(true)}><Icon name="more"/></button>
      <button className="round end" aria-label={call.status==='preparing'?'Cancel':'End call'} onClick={call.end}><Icon name="end" size={26}/></button>
    </div>}
    {moreOpen && <div className="sheet-backdrop" onClick={e => { if(e.target===e.currentTarget) setMoreOpen(false); }}>
      <aside className="sheet" role="dialog" aria-label="Hand tools" onKeyDown={e => { if(e.key==='Escape') setMoreOpen(false); }}>
        <div className="sheet-head"><h2>Hand tools</h2><button className="round small" aria-label="Close" autoFocus onClick={() => setMoreOpen(false)}><Icon name="close" size={18}/></button></div>
        <HandQuickControls placement={placement} onPlacement={setPlacement} cameraOn={active} tracked={stats.tracked}/>
        <details className="more"><summary>Tune the hand <small>size, reach, mirroring, network test</small></summary><HandAdvanced enabled={handOn} onEnabled={setHandOn} placement={placement} onPlacement={setPlacement} remote={myHand} loop={loop}/></details>
        <details className="more"><summary>AI scan to 3D model <small>needs the AI server</small></summary>
          <ScenePanel objects={scene.objects} selectedId={selectedId} onSelect={chooseObject} cameraOn={active} inCall={screen==='incall'} scanning={scene.scanning} error={scene.error} auto={scene.auto} onAuto={scene.setAuto} onScan={scanMine} onScanFriend={scanFriend} lastMs={scene.lastMs} saved={saved} onOpenSaved={key => void openSaved(key)}/>
          <DemoPanel/>
        </details>
      </aside>
    </div>}
  </main>;
}
