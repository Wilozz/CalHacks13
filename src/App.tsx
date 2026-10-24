import { useEffect, useRef, useState } from 'react';
import { CallPanel } from './CallPanel';
import { useMobileDevice } from './device';
import { HandScene, type LiveData } from './HandScene';
import { BONES, type HandFrame } from './coordinates';
type Facing = 'user' | 'environment';
type Phase = 'idle' | 'loading' | 'running' | 'error';
export default function App() {
  const mobile = useMobileDevice();
  const [facing, setFacing] = useState<Facing>('user');
  const [notice, setNotice] = useState('');
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const video = useRef<HTMLVideoElement>(null!);
  const overlay = useRef<HTMLCanvasElement>(null!);
  const live = useRef<LiveData>({frame:null,receivedAt:0,aspect:4/3,renderFps:0,mirrored:true});
  const cleanup = useRef<() => void>(() => {});
  const debug = useRef(true);
  const generation = useRef(0);
  const [phase,setPhase] = useState<Phase>('idle');
  const [message,setMessage] = useState('');
  const [showOverlay,setShowOverlay] = useState(true);
  const [stats,setStats] = useState({fps:0,latency:0,inference:0,tracked:false,hand:'',world:false});
  useEffect(() => {
    const timer = window.setInterval(() => {
      const {frame,receivedAt,renderFps} = live.current;
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
    generation.current++; cleanup.current(); live.current.frame=null;
    setPhase('idle'); setMessage('');
  }
  async function start(requestedFacing: Facing = facing) {
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
      if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Open GHOST over trusted HTTPS on your phone. A laptop’s HTTP LAN address cannot access your camera. Localhost only works on the device serving the app.');
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:requestedFacing},width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:mobile?30:60}}});
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
          const frame=data.frame as HandFrame;
          if(document.hidden) return;
          live.current.frame=frame; live.current.receivedAt=performance.now();
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
      worker.postMessage({type:'init'});
    } catch(error) { fail(error); }
  }
  const active=phase==='running';
  function switchCamera() {
    const next=facing==='user'?'environment':'user';
    if(phase==='running') void start(next);
    else { setFacing(next); live.current.mirrored=next==='user'; }
  }
  return <main>
    <header><a className="brand" href="#" aria-label="GHOST home"><span className="brand-icon">◈</span> GHOST<span className="badge">PROTOTYPE 01</span></a><span className="local"><i/> ON-DEVICE PROCESSING</span></header>
    <CallPanel getCameraStream={() => video.current?.srcObject instanceof MediaStream ? video.current.srcObject : null}/>
    <section className="intro"><div className="eyebrow">SPATIAL COMPUTING / HAND TRACKING LAB</div><h1>Your movement.<br/><span>A new dimension.</span></h1><p>One camera. Twenty-one landmarks. Your hand, translated into space.</p></section>
    <div className="toolbar"><div className="session"><i className={stats.tracked?'lit':''}/>{phase==='loading'?'INITIALIZING':active?(stats.tracked?'HAND TRACKED':'SEARCHING FOR HAND'):'SESSION OFFLINE'}</div><div className="camera-controls"><button className="secondary switch-camera" disabled={phase==='loading'} onClick={switchCamera} aria-label={`Switch to ${facing==='user'?'rear':'front'} camera`}>⇄ <span>Switch camera</span></button><button className={active||phase==='loading'?'secondary':''} onClick={() => active||phase==='loading'?stop():void start()}>{phase==='loading'?'Cancel':active?'Stop camera':'Enable camera'} <span>↗</span></button></div></div>
    {notice && <p className="camera-notice" role="status">{notice}</p>}
    <section className="workspace" aria-label="Hand tracking workspace">
      <article className="panel"><div className="panel-heading"><span><b>01</b> CAMERA INPUT</span><span className="muted">{facing==='user'?'FRONT / MIRRORED':'REAR / NATURAL'}</span></div>
        <div className={`camera-stage stage ${facing==='user'?'mirrored':''}`}><video ref={video} autoPlay playsInline muted/><canvas ref={overlay} className={showOverlay?'':'hidden'}/>
          {!active && <div className={`empty ${phase==='error'?'has-error':''}`}><span className="reticle">⌖</span><h2>{phase==='loading'?'Connecting to your world':phase==='error'?'Connection interrupted':'Start with a single hand'}</h2><p role={phase==='error'?'alert':'status'}>{phase==='loading'?message:phase==='error'?message:'Enable your camera, then hold your hand in view.'}</p>{phase==='error' && <button onClick={() => void start()}>Retry camera</button>}</div>}
          {active && <div className="corner-label"><i/> CAMERA LIVE</div>}
        </div><div className="panel-footer"><label><input type="checkbox" checked={showOverlay} onChange={e=>{setShowOverlay(e.target.checked);debug.current=e.target.checked; if(!e.target.checked)overlay.current.getContext('2d')?.clearRect(0,0,overlay.current.width,overlay.current.height);}}/> 2D landmark overlay</label><span>21 POINTS</span></div>
      </article>
      <article className="panel"><div className="panel-heading"><span><b>02</b> SPATIAL OUTPUT</span><span className="cyan">ESTIMATED 3D</span></div><div className="scene-stage stage"><HandScene live={live} mobile={mobile} running={active && pageVisible}/>{!stats.tracked && <div className="scene-wait"><span className="reticle">✧</span><p>{active?'Waiting for your hand':'Space for your next move'}</p><small>Live landmarks will appear here</small></div>}<div className="axis"><span>Y ↑</span><span>↙ Z　 X →</span></div><div className="scene-label">{stats.tracked?`${stats.hand.toUpperCase()} HAND / ${stats.world?'WORLD':'IMAGE'} LANDMARKS`:'NO SIGNAL'}</div></div><div className="panel-footer"><span><i className="dot"/> CYAN SKELETON</span><span>REAL-TIME VIEW</span></div></article>
    </section>
    <section className="metrics" aria-label="Performance metrics"><div><span>RENDER RATE</span><strong>{active?stats.fps:'—'}<small> FPS</small></strong></div><div><span>APPROX. PIPELINE LATENCY</span><strong>{active?stats.latency:'—'}<small> ms</small></strong></div><div><span>MODEL INFERENCE</span><strong>{active?stats.inference:'—'}<small> ms</small></strong></div><div><span>TRACKING STATUS</span><strong className="status-text" aria-live="polite">{stats.tracked?'Hand detected':active?'Searching…':'Standby'}</strong></div></section>
    <footer><p><span>↳</span> Open your palm. Point a finger. Rotate your wrist.</p><p>Monocular depth is an estimate. Occlusion and fast movement can reduce accuracy.</p></footer>
  </main>;
}
