import { useEffect, useRef, useState } from 'react';
import { CallSession, type CallStatus } from './CallSession';
import { normalizeRoomCode } from './callSignaling';
/** Call state for the FaceTime-style screens in App. The <video> elements stay mounted so refs never go stale. */
export function useCall(getCameraStream:()=>MediaStream|null) {
  const [status,setStatus]=useState<CallStatus>('idle');
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
  const [connectedAt,setConnectedAt]=useState(0);
  const [handChannel,setHandChannel]=useState<RTCDataChannel|null>(null);
  const [controlChannel,setControlChannel]=useState<RTCDataChannel|null>(null);
  const [poseChannel,setPoseChannel]=useState<RTCDataChannel|null>(null);
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
  useEffect(()=>{if(status==='connected')setConnectedAt(t=>t||Date.now());else if(status==='idle')setConnectedAt(0);},[status]);
  function start(code?:string,community?:{id:string;token:string}) {
    session.current?.close();setError('');setHint('');setRoom('');setMuted(false);setCameraOff(false);setRoute('');
    const call=new CallSession({status:setStatus,room:(code,hasRelay)=>{setRoom(code);setRelay(hasRelay);},local:setLocal,remote:setRemote,ended:setHint,error:setError,hand:setHandChannel,control:setControlChannel,pose:setPoseChannel,route:relayed=>setRoute(relayed?'TURN relay':'Direct')},getCameraStream);
    session.current=call;call.connect(code?normalizeRoomCode(code):undefined,community);
  }
  return {status,room,relay,route,error,hint,muted,cameraOff,local,remote,playBlocked,connectedAt,handChannel,controlChannel,poseChannel,selfVideo,friendVideo,start,
    end:()=>{session.current?.close();setHint('Call ended.');},
    toggleMute:()=>{session.current?.mute(!muted);setMuted(!muted);},
    toggleCamera:()=>{session.current?.cameraOff(!cameraOff);setCameraOff(!cameraOff);},
    share:()=>{
      const copy=()=>navigator.clipboard.writeText(room).then(()=>setHint('Code copied. Send it to your friend.')).catch(()=>setHint(`Your code is ${room}.`));
      if(navigator.share)void navigator.share({text:`Join my Handoff call with code ${room}`}).catch(()=>{});else void copy();
    },
    retryPlay:()=>void friendVideo.current?.play().then(()=>setPlayBlocked(false)).catch(()=>setError('Playback was blocked. Check browser audio settings.'))};
}
