export interface CallCode { version: 1; description: RTCSessionDescriptionInit }
export function encodeCallCode(description: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify({version:1, description} satisfies CallCode));
}
export function decodeCallCode(code: string, expected: 'offer' | 'answer'): RTCSessionDescriptionInit {
  if(!code.trim() || code.length>100_000) throw new Error('Paste the complete connection code from your friend.');
  try {
    const data=JSON.parse(atob(code.replace(/\s/g,''))) as CallCode;
    if(data.version!==1 || data.description?.type!==expected || typeof data.description.sdp!=='string' || !data.description.sdp.startsWith('v=0') || data.description.sdp.length>80_000) throw new Error();
    return {type:expected,sdp:data.description.sdp};
  } catch { throw new Error(`This is not a valid ${expected==='offer'?'invitation':'reply'} code. Ask your friend to copy the entire code.`); }
}
export function waitForIce(pc: RTCPeerConnection, signal?: AbortSignal): Promise<void> {
  if(signal?.aborted) return Promise.reject(new Error('Call cancelled.'));
  if(pc.iceGatheringState==='complete') return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const finish=(error?:Error)=>{
      clearTimeout(timeout);
      pc.removeEventListener('icegatheringstatechange',changed);
      pc.removeEventListener('signalingstatechange',closed);
      signal?.removeEventListener('abort',aborted);
      error?reject(error):resolve();
    };
    const aborted=()=>finish(new Error('Call cancelled.'));
    const changed=()=>{if(pc.iceGatheringState==='complete')finish();};
    const closed=()=>{if(pc.signalingState==='closed')finish(new Error('Call cancelled.'));};
    const timeout=setTimeout(()=>finish(new Error('Network discovery timed out. Retry on another network or configure a TURN relay.')),20_000);
    signal?.addEventListener('abort',aborted,{once:true});
    pc.addEventListener('icegatheringstatechange',changed);
    pc.addEventListener('signalingstatechange',closed);
    if(pc.signalingState==='closed')closed();
    else changed();
  });
}
export function iceConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[]=[{urls:'stun:stun.l.google.com:19302'}];
  const turnUrl=import.meta.env.VITE_TURN_URL;
  if(turnUrl) iceServers.push({urls:turnUrl,username:import.meta.env.VITE_TURN_USERNAME,credential:import.meta.env.VITE_TURN_CREDENTIAL});
  return {iceServers};
}
