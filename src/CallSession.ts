import { signalingUrl, validateRoomCode } from './callSignaling';
export type CallStatus='idle'|'preparing'|'waiting'|'connecting'|'connected'|'disconnected';
export interface CallCallbacks {
  status:(status:CallStatus)=>void;
  room:(code:string,relay:boolean)=>void;
  local:(stream:MediaStream|null)=>void;
  remote:(stream:MediaStream|null)=>void;
  ended:(message:string)=>void;
  error:(message:string)=>void;
  route:(relay:boolean)=>void;
  /** Unreliable channel for hand landmarks; null when the call closes. */
  hand?:(channel:RTCDataChannel|null)=>void;
  /** Reliable, ordered channel for small JSON control messages (which object is being shown). */
  control?:(channel:RTCDataChannel|null)=>void;
}
export class CallSession {
  private socket:WebSocket|null=null;
  private peer:RTCPeerConnection|null=null;
  private media:MediaStream|null=null;
  private closed=false;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private queued:RTCIceCandidateInit[]=[];
  constructor(private callbacks:CallCallbacks,private camera:()=>MediaStream|null){}
  connect(code?:string) {
    try {
      if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)throw new Error('Open GHOST on localhost or trusted HTTPS to use the camera and microphone.');
      const room=code?validateRoomCode(code):undefined;
      this.callbacks.status('preparing');
      const socket=new WebSocket(signalingUrl());this.socket=socket;
      this.deadline(12_000,'Could not reach the calling server. Check that both laptops use the same running server.');
      socket.onopen=()=>this.send(room?{type:'join',code:room}:{type:'create'});
      let messages=Promise.resolve();
      socket.onmessage=event=>{
        messages=messages.then(async()=>{if(!this.closed)await this.receive(JSON.parse(event.data));}).catch(error=>this.fail(error));
      };
      socket.onerror=()=>this.fail(new Error('Calling server is unreachable. Check its URL and that it is running.'));
      socket.onclose=()=>{if(!this.closed)this.fail(new Error('Lost connection to the calling server. Create or join a new room.'));};
    }catch(error){this.fail(error);}
  }
  private send(data:unknown) {
    if(this.closed)return;
    if(this.socket?.readyState!==WebSocket.OPEN)throw new Error('Calling server disconnected.');
    this.socket.send(JSON.stringify(data));
  }
  private deadline(ms:number,message:string) {
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>this.fail(new Error(message)),ms);
  }
  private async receive(message:any) {
    if(message.type==='error')throw new Error(message.message);
    if(message.type==='ended'){this.close();this.callbacks.ended(message.message);return;}
    if(message.type==='joined') {
      clearTimeout(this.timer); // No network deadline while granting permissions / waiting for friend.
      this.callbacks.room(message.code,message.configuration.relayConfigured);
      const shared=this.camera()?.getVideoTracks().find(track=>track.readyState==='live');
      let media:MediaStream;
      if(shared) {
        const clone=shared.clone();this.media=new MediaStream([clone]);
        try {
          const audio=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
          media=new MediaStream([clone,...audio.getAudioTracks()]);
        }catch(error){clone.stop();throw error;}
      }else {
        media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}}});
      }
      if(this.closed){media.getTracks().forEach(track=>track.stop());return;}
      this.media=media;this.callbacks.local(media);
      const pc=new RTCPeerConnection(message.configuration);this.peer=pc;
      // Negotiated on both sides with a fixed id, so it needs no extra signaling and no offer/answer ordering.
      this.callbacks.hand?.(pc.createDataChannel('hand',{negotiated:true,id:1,ordered:false,maxRetransmits:0}));
      this.callbacks.control?.(pc.createDataChannel('control',{negotiated:true,id:2}));
      for(const track of media.getTracks()){
        pc.addTrack(track,media);
        track.onended=()=>this.fail(new Error('Camera or microphone stopped. Check permissions and start a new call.'));
      }
      const remote=new MediaStream();
      pc.ontrack=event=>{if(!this.closed){remote.addTrack(event.track);this.callbacks.remote(remote);}};
      pc.onicecandidate=event=>{
        if(event.candidate && !this.closed)try{this.send({type:'signal',signal:{candidate:event.candidate.toJSON()}});}catch(error){this.fail(error);}
      };
      pc.onconnectionstatechange=()=>{
        if(this.closed)return;
        if(pc.connectionState==='connected') {
          clearTimeout(this.timer);this.callbacks.status('connected');void this.reportRoute(pc);
        }else if(pc.connectionState==='disconnected') {
          this.callbacks.status('disconnected');this.deadline(20_000,'Connection was lost. Create a new room to retry.');
        }else if(pc.connectionState==='failed')this.fail(new Error('Media connection failed. Verify the TURN server is reachable and its credentials are valid, or try another network.'));
      };
      this.callbacks.status('waiting');this.send({type:'ready'});return;
    }
    const pc=this.peer;if(!pc || this.closed)return;
    if(message.type==='peer-ready') {
      this.callbacks.status('connecting');
      this.deadline(60_000,'Could not establish the call. Check the TURN relay configuration and network, then create a new room.');
      if(message.initiator) {
        await pc.setLocalDescription(await pc.createOffer());
        if(!this.closed)this.send({type:'signal',signal:{description:pc.localDescription}});
      }
      return;
    }
    if(message.type==='signal') {
      const signal=message.signal;
      if(signal.description) {
        await pc.setRemoteDescription(signal.description);
        if(this.closed)return;
        for(const candidate of this.queued.splice(0))await pc.addIceCandidate(candidate);
        if(signal.description.type==='offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          if(!this.closed)this.send({type:'signal',signal:{description:pc.localDescription}});
        }
      }else if(signal.candidate) {
        if(pc.remoteDescription)await pc.addIceCandidate(signal.candidate);
        else this.queued.push(signal.candidate);
      }
    }
  }
  private async reportRoute(pc:RTCPeerConnection) {
    try {
      const stats=await pc.getStats();
      if(this.closed)return;
      let pair:any;
      stats.forEach(report=>{if(report.type==='transport' && report.selectedCandidatePairId)pair=stats.get(report.selectedCandidatePairId);});
      if(!pair)stats.forEach(report=>{if(report.type==='candidate-pair'&&report.nominated&&report.state==='succeeded')pair=report;});
      if(pair){const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);this.callbacks.route(local?.candidateType==='relay'||remote?.candidateType==='relay');}
    }catch{/* Route display must not interrupt a working call. */}
  }
  mute(muted:boolean){this.media?.getAudioTracks().forEach(track=>{track.enabled=!muted;});}
  cameraOff(off:boolean){this.media?.getVideoTracks().forEach(track=>{track.enabled=!off;});}
  private fail(error:unknown) {
    if(this.closed)return;
    this.close();
    this.callbacks.error(error instanceof Error && error.name==='NotAllowedError'?'Camera or microphone permission was denied. Allow both in browser site settings and retry.':error instanceof Error?error.message:String(error));
  }
  close() {
    if(this.closed)return;
    try{this.send({type:'leave'});}catch{/* Connection may already be gone. */}
    this.closed=true;clearTimeout(this.timer);
    this.socket?.close();this.socket=null;
    this.peer?.close();this.peer=null;
    this.media?.getTracks().forEach(track=>{track.onended=null;track.stop();});this.media=null;
    this.queued=[];this.callbacks.local(null);this.callbacks.remote(null);this.callbacks.hand?.(null);this.callbacks.control?.(null);this.callbacks.status('idle');
  }
}
