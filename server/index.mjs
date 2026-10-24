import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { turnConfiguration } from './turn.mjs';
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE=/^[A-HJ-NP-Z2-9]{6}$/;
export function createSignalingServer({env=process.env,roomTtl=30*60_000,heartbeatMs=30_000,maxRooms=1000,staticDirectory=resolve('dist')}={}) {
  turnConfiguration(env); // Fail startup for invalid relay configuration.
  const rooms=new Map();
  const allowedOrigins=(env.ALLOWED_ORIGINS??`http://127.0.0.1:5173,http://localhost:5173,https://127.0.0.1:5173,https://localhost:5173,http://127.0.0.1:${env.PORT??8787},http://localhost:${env.PORT??8787}`).split(',').map(v=>v.trim());
  const upgrades=new Map();
  const send=(socket,data)=>{if(socket.readyState===WebSocket.OPEN){if(socket.bufferedAmount>256_000){socket.terminate();return;}socket.send(JSON.stringify(data));}};
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.url==='/health') {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,relayConfigured:!!env.TURN_URLS}));return;}
    if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const root=resolve(staticDirectory);
    try {
      let path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      if(path!==root && !path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
      try {if((await stat(path)).isDirectory())path=resolve(path,'index.html');} catch {if(!extname(path))path=resolve(root,'index.html');}
      const content=await readFile(path);
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json'};
      res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream'});res.end(req.method==='HEAD'?undefined:content);
    } catch {res.writeHead(404);res.end('Not found. Build the frontend first.');}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:80_000,perMessageDeflate:false});
  const destroyRoom=(room,reason,exclude)=>{
    if(!rooms.delete(room.code))return;
    for(const member of room.members){member.room=null;if(member!==exclude){send(member,{type:'ended',message:reason});member.close(1000,'Room ended');}}
  };
  server.on('upgrade',(req,socket,head)=>{
    const ip=req.socket.remoteAddress,now=Date.now();
    let budget=upgrades.get(ip);
    if(!budget || now-budget.start>60_000){budget={start:now,count:0};upgrades.set(ip,budget);}
    if(++budget.count>120){socket.destroy();return;}
    if(new URL(req.url,'http://localhost').pathname!=='/signal' || !allowedOrigins.includes(req.headers.origin)) {socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    if(wss.clients.size>=maxRooms*2){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',socket=>{
    socket.room=null;socket.alive=true;socket.ready=false;socket.windowStart=Date.now();socket.count=0;socket.created=Date.now();
    socket.on('error',()=>{});
    socket.on('pong',()=>{socket.alive=true;});
    socket.on('message',(raw,isBinary)=>{
      if(Date.now()-socket.windowStart>60_000){socket.windowStart=Date.now();socket.count=0;}
      if(++socket.count>600){socket.close(1008,'Too many messages');return;}
      const error=message=>send(socket,{type:'error',message});
      let message;
      try{if(isBinary)throw new Error();message=JSON.parse(raw.toString());if(!message||typeof message.type!=='string')throw new Error();}catch{error('Invalid signaling message.');return;}
      if(message.type==='create' || message.type==='join') {
        if(socket.room){error('Already in a room. End this call first.');return;}
        let room;
        if(message.type==='create') {
          if(rooms.size>=maxRooms){error('Server is busy. Try again shortly.');return;}
          let code;do {code=Array.from({length:6},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');}while(rooms.has(code));
          room={code,members:[],created:Date.now(),started:false};rooms.set(code,room);
        } else {
          if(typeof message.code!=='string'||!CODE.test(message.code)){error('Enter a valid six-character room code.');return;}
          room=rooms.get(message.code);
          if(!room){error('Room not found or expired. Both laptops must use the same calling server.');return;}
          if(room.members.length!==1 || room.started){error('This room already has two people.');return;}
        }
        socket.room=room;socket.ready=false;room.members.push(socket);
        send(socket,{type:'joined',code:room.code,role:room.members.length===1?'host':'guest',configuration:turnConfiguration(env)});
        return;
      }
      const room=socket.room;
      if(!room){error('Create or join a room first.');return;}
      if(message.type==='leave'){destroyRoom(room,'Your friend ended the call.',socket);socket.close(1000);return;}
      if(message.type==='ready') {
        socket.ready=true;
        if(room.members.length===2 && room.members.every(member=>member.ready) && !room.started) {
          room.started=true;
          for(const member of room.members)send(member,{type:'peer-ready',initiator:member===room.members[0]});
        }
        return;
      }
      if(message.type==='signal' && room.started) {
        const signal=message.signal;
        const host=socket===room.members[0];
        const description=signal?.description;
        const validDescription=description && description.type===(host?'offer':'answer') && typeof description.sdp==='string' && description.sdp.length<65_000 && description.sdp.startsWith('v=0');
        const candidate=signal?.candidate;
        const validCandidate=candidate && typeof candidate.candidate==='string' && candidate.candidate.length<4000 && (typeof candidate.sdpMid==='string'||Number.isInteger(candidate.sdpMLineIndex));
        if(!validDescription && !validCandidate){error('Invalid connection data.');return;}
        for(const member of room.members)if(member!==socket)send(member,{type:'signal',signal:validDescription?{description}:{candidate}});
        return;
      }
      error('Unexpected signaling message.');
    });
    socket.on('close',()=>{if(socket.room)destroyRoom(socket.room,'Your friend left the call.',socket);});
  });
  const sweep=setInterval(()=>{
    for(const [ip,budget] of upgrades)if(Date.now()-budget.start>60_000)upgrades.delete(ip);
    for(const room of rooms.values())if(!room.started && Date.now()-room.created>roomTtl)destroyRoom(room,'This room expired. Create a new room.');
    for(const socket of wss.clients){if(!socket.alive || (!socket.room&&Date.now()-socket.created>30_000)){socket.terminate();continue;}socket.alive=false;socket.ping();}
  },heartbeatMs);
  sweep.unref();
  return {server,rooms,async close(){clearInterval(sweep);for(const socket of wss.clients)socket.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  // Local .env is server-only; never prefix the shared TURN secret with VITE_.
  try{process.loadEnvFile('.env');}catch(error){if(error.code!=='ENOENT')throw error;}
  const app=createSignalingServer();
  app.server.listen(Number(process.env.PORT??8787),process.env.HOST??'127.0.0.1',()=>console.log(`GHOST calling server listening on port ${process.env.PORT??8787}; relay ${process.env.TURN_URLS?'configured':'not configured'}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
}
