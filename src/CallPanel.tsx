import { useEffect, useRef, useState } from 'react';
import { decodeCallCode, encodeCallCode, iceConfiguration, waitForIce } from './callSignaling';
type Status='idle'|'preparing'|'invitation'|'reply'|'connecting'|'connected'|'disconnected';
export function CallPanel({getCameraStream}:{getCameraStream:()=>MediaStream|null}) {
  const [status,setStatus]=useState<Status>('idle');
  const [incoming,setIncoming]=useState('');
  const [outgoing,setOutgoing]=useState('');
  const [error,setError]=useState('');
  const [hint,setHint]=useState('');
  const [muted,setMuted]=useState(false);
  const [cameraOff,setCameraOff]=useState(false);
  const [local,setLocal]=useState<MediaStream|null>(null);
  const [remote,setRemote]=useState<MediaStream|null>(null);
  const [playBlocked,setPlayBlocked]=useState(false);
  const selfVideo=useRef<HTMLVideoElement>(null);
  const friendVideo=useRef<HTMLVideoElement>(null);
  const session=useRef(0);
  const pendingIce=useRef<AbortController|null>(null);
  const peer=useRef<RTCPeerConnection|null>(null);
  const media=useRef<MediaStream|null>(null);
  const control=useRef<RTCDataChannel|null>(null);
  const connectionTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  function dispose() {
    session.current++;
    pendingIce.current?.abort();pendingIce.current=null;
    clearTimeout(connectionTimer.current);
    const pc=peer.current; peer.current=null;
    control.current?.close();control.current=null;
    pc?.close();
    media.current?.getTracks().forEach(track=>track.stop());media.current=null;
  }
  function end(message='Call ended.') {
    try {if(control.current?.readyState==='open') control.current.send('hangup');} catch { /* Peer may have closed between the check and send. */ }
    dispose();setLocal(null);setRemote(null);setOutgoing('');setIncoming('');
    setMuted(false);setCameraOff(false);setStatus('idle');setHint(message);
  }
  useEffect(()=>{
    const leave=()=>end();
    window.addEventListener('pagehide',leave);
    return ()=>{window.removeEventListener('pagehide',leave);dispose();};
  },[]);
  useEffect(()=>{if(selfVideo.current)selfVideo.current.srcObject=local;},[local]);
  useEffect(()=>{
    const video=friendVideo.current;
    if(!video)return;
    video.srcObject=remote;
    if(remote)void video.play().then(()=>setPlayBlocked(false)).catch(()=>setPlayBlocked(true));
  },[remote]);
  function networkTimeout(pc:RTCPeerConnection, delay=35_000) {
    clearTimeout(connectionTimer.current);
    connectionTimer.current=setTimeout(()=>{
      if(peer.current!==pc || pc.connectionState==='connected')return;
      end('Connection closed.');
      setError('Could not reach your friend. Event Wi-Fi may block direct calls. Try another network or configure a TURN relay on both laptops. Create fresh codes to retry.');
    },delay);
  }
  async function prepare():Promise<{pc:RTCPeerConnection;token:number}> {
    dispose();setLocal(null);setRemote(null);setOutgoing('');setIncoming('');setError('');setHint('');setMuted(false);setCameraOff(false);setStatus('preparing');
    const token=session.current;
    pendingIce.current=new AbortController();
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)throw new Error('Open GHOST on your own laptop using localhost, or use trusted HTTPS.');
    const shared=getCameraStream()?.getVideoTracks().find(track=>track.readyState==='live');
    let captured:MediaStream;
    if(shared) {
      const clone=shared.clone();
      media.current=new MediaStream([clone]);
      // Clone first so stopping hand tracking cannot stop the call's camera track.
      try {
        const audio=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
        captured=new MediaStream([clone,...audio.getAudioTracks()]);
      } catch(error) {clone.stop();throw error;}
    } else {
      captured=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}}});
    }
    if(token!==session.current) {captured.getTracks().forEach(track=>track.stop());throw new Error('Call cancelled.');}
    media.current=captured;setLocal(captured);
    const pc=new RTCPeerConnection(iceConfiguration());peer.current=pc;
    for(const track of captured.getTracks()) {
      pc.addTrack(track,captured);
      track.onended=()=>{if(peer.current===pc){end('Camera or microphone disconnected.');setError('Your camera or microphone stopped. Check permissions and start a new call.');}};
    }
    const remoteStream=new MediaStream();
    pc.ontrack=event=>{
      if(peer.current!==pc)return;
      remoteStream.addTrack(event.track);setRemote(remoteStream);
    };
    const setupChannel=(channel:RTCDataChannel)=>{
      control.current=channel;
      channel.onmessage=event=>{if(event.data==='hangup' && peer.current===pc)end('Your friend ended the call.');};
    };
    pc.ondatachannel=event=>setupChannel(event.channel);
    pc.onconnectionstatechange=()=>{
      if(peer.current!==pc)return;
      if(pc.connectionState==='connected') {clearTimeout(connectionTimer.current);setStatus('connected');setOutgoing('');setIncoming('');setHint('');}
      else if(pc.connectionState==='disconnected') {setStatus('disconnected');networkTimeout(pc,15_000);}
      else if(pc.connectionState==='failed') {end('Connection failed.');setError('The network blocked the call or the connection was lost. Try another network or a TURN relay, then create fresh codes.');}
    };
    return {pc,token};
  }
  function report(error:unknown) {
    end('');
    setError(error instanceof Error && error.name==='NotAllowedError'?'Camera or microphone permission was denied. Allow both in your browser’s site settings, then retry.':error instanceof Error?error.message:String(error));
  }
  async function createInvitation() {
    const operation=session.current+1;
    try {
      const {pc,token}=await prepare();
      control.current=pc.createDataChannel('call-control');
      control.current.onmessage=event=>{if(event.data==='hangup' && peer.current===pc)end('Your friend ended the call.');};
      await pc.setLocalDescription(await pc.createOffer());await waitForIce(pc,pendingIce.current?.signal);
      if(token!==session.current)return;
      setOutgoing(encodeCallCode(pc.localDescription!));setStatus('invitation');
    } catch(error) {if(operation===session.current)report(error);}
  }
  async function joinInvitation() {
    let description:RTCSessionDescriptionInit;
    try {description=decodeCallCode(incoming,'offer');}catch(error){setError((error as Error).message);return;}
    const operation=session.current+1;
    try {
      const {pc,token}=await prepare();
      await pc.setRemoteDescription(description);
      await pc.setLocalDescription(await pc.createAnswer());await waitForIce(pc,pendingIce.current?.signal);
      if(token!==session.current)return;
      setOutgoing(encodeCallCode(pc.localDescription!));setIncoming('');setStatus('reply');
      // Give the host time to receive and paste the reply before starting a deadline.
      networkTimeout(pc,120_000);
    } catch(error) {if(operation===session.current)report(error);}
  }
  async function connectReply() {
    const pc=peer.current,token=session.current;if(!pc)return;
    try {
      const reply=decodeCallCode(incoming,'answer');
      setStatus('connecting');
      await pc.setRemoteDescription(reply);
      if(token!==session.current)return;
      setStatus('connecting');setError('');networkTimeout(pc);
    } catch(error) {if(token===session.current){setStatus('invitation');setError((error as Error).message);}}
  }
  async function copyCode() {
    try {await navigator.clipboard.writeText(outgoing);setHint('Code copied. Send it to your friend.');}
    catch {setHint('Select the code below and copy it manually.');}
  }
  const inCall=status!=='idle';
  return <section className="call-panel" aria-label="Video call">
    <div className="call-heading"><div><div className="eyebrow">DIRECT CONNECTION / TWO PEOPLE</div><h2>Call a friend</h2></div><span className="call-status" role="status">{status==='idle'?'Ready to call':status==='preparing'?'Preparing camera & microphone…':status==='invitation'?'Waiting for reply':status==='reply'?'Send your reply code':status==='connecting'?'Connecting…':status==='disconnected'?'Reconnecting…':'Connected'}</span></div>
    <p className="call-intro">Both of you open GHOST on your own laptop. One creates an invitation; the other pastes it and sends a reply. Use headphones to avoid echo.</p>
    <div className="call-videos"><div className="call-view"><video ref={selfVideo} autoPlay muted playsInline className="self-video"/>{(!local || cameraOff)&&<div className="call-placeholder">{cameraOff?'Your camera is off':'Your camera'}</div>}<span className="call-video-label">YOU {muted?' / MIC MUTED':''}</span></div><div className="call-view"><video ref={friendVideo} autoPlay playsInline/>{!remote&&<div className="call-placeholder">Your friend will appear here</div>}<span className="call-video-label">FRIEND</span>{playBlocked&&<button className="play-audio" onClick={()=>void friendVideo.current?.play().then(()=>setPlayBlocked(false)).catch(()=>setError('Playback was blocked. Check your browser audio settings.'))}>Play friend’s audio & video</button>}</div></div>
    {error&&<p className="call-error" role="alert">{error}</p>}{hint&&<p className="call-hint" role="status">{hint}</p>}
    {status==='idle'&&<div className="call-setup"><div><h3>Start a new call</h3><p>Create a code and send it to your friend through your usual chat app.</p><button onClick={()=>void createInvitation()}>Create invitation</button></div><div><label htmlFor="call-incoming">Have an invitation? Paste it here</label><textarea id="call-incoming" value={incoming} onChange={e=>setIncoming(e.target.value)} placeholder="Paste your friend’s invitation code" spellCheck={false} autoCapitalize="off" autoComplete="off"/><button className="secondary" disabled={!incoming.trim()} onClick={()=>void joinInvitation()}>Join friend’s call</button></div></div>}
    {(status==='invitation'||status==='reply')&&outgoing&&<div className="call-code"><label htmlFor="call-outgoing">{status==='invitation'?'1. Send this invitation code to your friend':'Send this reply code back to the person who invited you'}</label><textarea id="call-outgoing" readOnly value={outgoing} onFocus={e=>e.target.select()} spellCheck={false}/><button className="secondary" onClick={()=>void copyCode()}>Copy {status==='invitation'?'invitation':'reply'} code</button></div>}
    {status==='invitation'&&<div className="call-code"><label htmlFor="call-reply">2. Paste your friend’s reply code</label><textarea id="call-reply" value={incoming} onChange={e=>setIncoming(e.target.value)} placeholder="Paste the reply code here" spellCheck={false} autoCapitalize="off"/><button disabled={!incoming.trim()} onClick={()=>void connectReply()}>Connect call</button></div>}
    {status==='reply'&&<p className="call-hint">Keep this page open. Your friend must paste your reply and click Connect call within two minutes.</p>}
    {inCall&&<div className="call-actions">{local&&<><button className="secondary" aria-pressed={muted} onClick={()=>{media.current?.getAudioTracks().forEach(t=>{t.enabled=muted;});setMuted(!muted);}}>{muted?'Unmute microphone':'Mute microphone'}</button><button className="secondary" aria-pressed={cameraOff} onClick={()=>{media.current?.getVideoTracks().forEach(t=>{t.enabled=cameraOff;});setCameraOff(!cameraOff);}}>{cameraOff?'Turn camera on':'Turn camera off'}</button></>}<button className="end-call" onClick={()=>end()}>{status==='preparing'?'Cancel':'End call'}</button></div>}
    <p className="call-note">Camera and microphone are shared only with the connected peer. Event Wi-Fi may require a TURN relay; connection codes alone cannot bypass network blocks.</p>
  </section>;
}
