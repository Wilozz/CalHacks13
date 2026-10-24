import { useEffect, useRef, useState } from 'react';
import { CallSession, type CallStatus } from './CallSession';
import { normalizeRoomCode, ROOM_PATTERN } from './callSignaling';
export function CallPanel({getCameraStream}:{getCameraStream:()=>MediaStream|null}) {
  const [status,setStatus]=useState<CallStatus>('idle');
  const [incoming,setIncoming]=useState('');
  const [room,setRoom]=useState('');
  const [relay,setRelay]=useState(false);
  const [route,setRoute]=useState('');
  const [error,setError]=useState('');
  const [hint,setHint]=useState('');
  const [muted,setMuted]=useState(false);
  const [cameraOff,setCameraOff]=useState(false);
  const [local,setLocal]=useState<MediaStream|null>(null);
  const [remote,setRemote]=useState<MediaStream|null>(null);
  const [playBlocked,setPlayBlocked]=useState(false);
  const selfVideo=useRef<HTMLVideoElement>(null);
  const friendVideo=useRef<HTMLVideoElement>(null);
  const session=useRef<CallSession|null>(null);
  useEffect(()=>{
    const leave=()=>session.current?.close();
    window.addEventListener('pagehide',leave);
    return ()=>{window.removeEventListener('pagehide',leave);session.current?.close();};
  },[]);
  useEffect(()=>{if(selfVideo.current)selfVideo.current.srcObject=local;},[local]);
  useEffect(()=>{
    const video=friendVideo.current;if(!video)return;
    video.srcObject=remote;
    if(remote)void video.play().then(()=>setPlayBlocked(false)).catch(()=>setPlayBlocked(true));
  },[remote]);
  function start(join=false) {
    session.current?.close();setError('');setHint('');setRoom('');setMuted(false);setCameraOff(false);setRoute('');
    const call=new CallSession({status:setStatus,room:(code,hasRelay)=>{setRoom(code);setRelay(hasRelay);},local:setLocal,remote:setRemote,ended:setHint,error:setError,route:relayed=>setRoute(relayed?'TURN relay':'Direct connection')},getCameraStream);
    session.current=call;call.connect(join?normalizeRoomCode(incoming):undefined);
  }
  const active=status!=='idle';
  return <section className="call-panel" aria-label="Video call">
    <div className="call-heading"><div><div className="eyebrow">GHOST CONNECT / TWO PEOPLE</div><h2>Call a friend</h2></div><span className="call-status" role="status">{status==='idle'?'Ready to call':status==='preparing'?'Preparing camera & microphone…':status==='waiting'?'Waiting for your friend…':status==='connecting'?'Connecting…':status==='disconnected'?'Reconnecting…':'Connected'}</span></div>
    <p className="call-intro">Create a room, share the six-character code, and your friend joins. No reply code. Use headphones to avoid echo.</p>
    <div className="call-videos"><div className="call-view"><video ref={selfVideo} autoPlay muted playsInline className="self-video"/>{(!local||cameraOff)&&<div className="call-placeholder">{cameraOff?'Your camera is off':'Your camera'}</div>}<span className="call-video-label">YOU {muted?' / MIC MUTED':''}</span></div><div className="call-view"><video ref={friendVideo} autoPlay playsInline/>{!remote&&<div className="call-placeholder">Your friend will appear here</div>}<span className="call-video-label">FRIEND</span>{playBlocked&&<button className="play-audio" onClick={()=>void friendVideo.current?.play().then(()=>setPlayBlocked(false)).catch(()=>setError('Playback was blocked. Check browser audio settings.'))}>Play friend’s audio & video</button>}</div></div>
    {error&&<p className="call-error" role="alert">{error}</p>}{hint&&<p className="call-hint" role="status">{hint}</p>}
    {!active&&<div className="call-setup"><div><h3>Start a call</h3><p>Share one short code with your friend.</p><button onClick={()=>start()}>Create room</button></div><form onSubmit={event=>{event.preventDefault();if(ROOM_PATTERN.test(normalizeRoomCode(incoming)))start(true);}}><label htmlFor="room-input">Have a room code?</label><input id="room-input" className="room-input" value={incoming} onChange={event=>setIncoming(normalizeRoomCode(event.target.value).slice(0,6))} placeholder="ABC234" maxLength={8} spellCheck={false} autoCapitalize="characters" autoComplete="off"/><button className="secondary" disabled={!ROOM_PATTERN.test(normalizeRoomCode(incoming))} type="submit">Join room</button></form></div>}
    {active&&room&&<div className="room-share"><div><span>ROOM CODE</span><strong data-testid="room-code">{room}</strong></div><button className="secondary" onClick={()=>void navigator.clipboard.writeText(room).then(()=>setHint('Room code copied. Send it to your friend.')).catch(()=>setHint(`Your room code is ${room}. Select and copy it manually.`))}>Copy code</button></div>}
    {active&&room&&<p className="call-hint">{status==='connected'?route||'Media connected':relay?'TURN relay configured':'Direct mode — TURN relay is not configured on this server.'}{status==='waiting'?' Take your time. Connection starts once both cameras and microphones are ready.':''}</p>}
    {active&&<div className="call-actions">{local&&<><button className="secondary" aria-pressed={muted} onClick={()=>{session.current?.mute(!muted);setMuted(!muted);}}>{muted?'Unmute microphone':'Mute microphone'}</button><button className="secondary" aria-pressed={cameraOff} onClick={()=>{session.current?.cameraOff(!cameraOff);setCameraOff(!cameraOff);}}>{cameraOff?'Turn camera on':'Turn camera off'}</button></>}<button className="end-call" onClick={()=>{session.current?.close();setHint('Call ended.');}}>{status==='preparing'?'Cancel':'End call'}</button></div>}
    <p className="call-note">Both laptops must use the same calling server. Camera and microphone are shared with the connected peer. Rooms expire after 30 minutes while waiting.</p>
  </section>;
}
