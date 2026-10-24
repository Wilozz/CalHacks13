import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {WebSocket} from 'ws';
import {createSignalingServer} from './index.mjs';
import {turnConfiguration} from './turn.mjs';
const origin='http://localhost:5173';
async function fixture(t,options={}) {
 const app=createSignalingServer({env:{},...options});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 t.after(()=>app.close());const port=app.server.address().port;
 async function client() {
  const socket=new WebSocket(`ws://127.0.0.1:${port}/signal`,{origin});
  const queue=[],waiters=[];
  socket.on('message',data=>{const message=JSON.parse(data);if(waiters.length)waiters.shift()(message);else queue.push(message);});
  await once(socket,'open');
  return {socket,send:message=>socket.send(JSON.stringify(message)),next:()=>queue.length?Promise.resolve(queue.shift()):new Promise(resolve=>waiters.push(resolve))};
 }
 return {...app,client,port};
}
test('short room joins automatically and only starts when both participants are ready',async t=>{
 const app=await fixture(t);const a=await app.client(),b=await app.client();
 a.send({type:'create'});const created=await a.next();assert.match(created.code,/^[A-HJ-NP-Z2-9]{6}$/);assert.equal(created.role,'host');
 a.send({type:'ready'});b.send({type:'join',code:created.code});const joined=await b.next();assert.equal(joined.role,'guest');
 assert.equal(app.rooms.get(created.code).started,false);
 b.send({type:'ready'});assert.deepEqual(await a.next(),{type:'peer-ready',initiator:true});assert.deepEqual(await b.next(),{type:'peer-ready',initiator:false});
 const offer={description:{type:'offer',sdp:'v=0\r\n'}};a.send({type:'signal',signal:offer});assert.deepEqual(await b.next(),{type:'signal',signal:offer});
 const candidate={candidate:{candidate:'candidate:1 1 UDP 1 127.0.0.1 9000 typ host',sdpMid:'0',sdpMLineIndex:0}};
 a.send({type:'signal',signal:candidate});assert.deepEqual(await b.next(),{type:'signal',signal:candidate});
 const answer={description:{type:'answer',sdp:'v=0\r\n'}};b.send({type:'signal',signal:answer});assert.deepEqual(await a.next(),{type:'signal',signal:answer});
 a.send({type:'leave'});assert.equal((await b.next()).type,'ended');assert.equal(app.rooms.size,0);
});
test('rooms reject missing codes and third participants, and remove disconnected hosts',async t=>{
 const app=await fixture(t);const a=await app.client(),b=await app.client(),c=await app.client();
 c.send({type:'join',code:'ABC234'});assert.match((await c.next()).message,/not found/);
 a.send({type:'create'});const {code}=await a.next();b.send({type:'join',code});await b.next();
 c.send({type:'join',code});assert.match((await c.next()).message,/two people/);
 a.socket.close();assert.equal((await b.next()).type,'ended');assert.equal(app.rooms.size,0);
});
test('room permissions wait does not start ICE and stale waiting rooms expire',async t=>{
 const app=await fixture(t,{roomTtl:50,heartbeatMs:20});const a=await app.client();
 a.send({type:'create'});await a.next();assert.equal([...app.rooms.values()][0].started,false);
 assert.match((await a.next()).message,/expired/);assert.equal(app.rooms.size,0);
});
test('rejects foreign origins and malformed protocol data',async t=>{
 const app=await fixture(t);const a=await app.client();a.send({type:'signal',signal:{}});assert.match((await a.next()).message,/first/);
 a.socket.send('not json');assert.match((await a.next()).message,/Invalid/);
 const bad=new WebSocket(`ws://127.0.0.1:${app.port}/signal`,{origin:'https://foreign.example'});
 bad.on('error',()=>{});const [response]=await once(bad,'unexpected-response');assert.equal(response.constructor.name,'ClientRequest');bad.terminate();
});
test('hosted server trusts its own Render URL as an origin',async t=>{
 const app=await fixture(t,{env:{ALLOWED_ORIGINS:'http://localhost:5173',RENDER_EXTERNAL_URL:'https://ghost.onrender.com'}});
 const hosted=new WebSocket(`ws://127.0.0.1:${app.port}/signal`,{origin:'https://ghost.onrender.com'});
 await once(hosted,'open');hosted.terminate();
});
test('TURN issues expiring HMAC credentials without exposing shared secret',()=>{
 const env={TURN_URLS:'turn:relay.example:3478?transport=udp,turns:relay.example:443?transport=tcp',TURN_SHARED_SECRET:'server-secret'};
 const config=turnConfiguration(env,1_000_000);const turn=config.iceServers[1];
 assert.equal(config.iceTransportPolicy,'relay');assert.equal(config.relayConfigured,true);
 assert.equal(Number(turn.username.split(':')[0]),1000+86400);
 assert.equal(turn.credential,createHmac('sha1','server-secret').update(turn.username).digest('base64'));
 assert.equal(JSON.stringify(config).includes('server-secret'),false);
 assert.equal(turnConfiguration({}).relayConfigured,false);
 assert.equal(turnConfiguration({...env,RELAY_ONLY:'false'}).iceTransportPolicy,'all');
 for(const bad of [{TURN_URLS:'https://bad'}, {TURN_URLS:'turn:example'}, {RELAY_ONLY:'true'}])assert.throws(()=>turnConfiguration(bad));
});

test('production server serves frontend/runtime with correct MIME and exposes safe health',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ghost-static-'));
 await writeFile(join(root,'index.html'),'<!doctype html><title>GHOST</title>');
 await writeFile(join(root,'worker.js'),'self.onmessage = () => {};');
 await writeFile(join(root,'runtime.wasm'),new Uint8Array([0,97,115,109]));
 const app=await fixture(t,{staticDirectory:root});const base=`http://127.0.0.1:${app.port}`;
 const html=await fetch(base);assert.equal(html.status,200);assert.match(html.headers.get('content-type'),/text\/html/);assert.match(await html.text(),/GHOST/);
 const js=await fetch(base+'/worker.js');assert.equal(js.status,200);assert.equal(js.headers.get('content-type'),'text/javascript');
 const wasm=await fetch(base+'/runtime.wasm');assert.equal(wasm.headers.get('content-type'),'application/wasm');await wasm.arrayBuffer();
 const health=await fetch(base+'/health');assert.deepEqual(await health.json(),{ok:true,relayConfigured:false});
 assert.equal((await fetch(base+'/%2e%2e%2fpackage.json')).status,403);
 const missing=await fetch(base+'/missing.js');assert.equal(missing.status,404);
});

test('managed TURN credentials are supported and incomplete/mixed authentication is rejected',()=>{
 const env={TURN_URLS:'turns:managed.example:443?transport=tcp',TURN_USERNAME:'provider-user',TURN_PASSWORD:'provider-password'};
 const config=turnConfiguration(env);
 assert.equal(config.iceTransportPolicy,'relay');
 assert.deepEqual(config.iceServers[1],{urls:[env.TURN_URLS],username:'provider-user',credential:'provider-password'});
 for(const bad of [{...env,TURN_PASSWORD:''},{...env,TURN_USERNAME:''},{...env,TURN_SHARED_SECRET:'mixed'}])assert.throws(()=>turnConfiguration(bad));
});
test('community rooms require server-side membership and reject manual room-code bypass',async t=>{
 const events=[];const community={async authorize(id,token){if(id!=='session-test'||!['A','B'].includes(token))throw new Error('denied');return {sessionId:id,userId:token,roomCode:'ZABC23'};},async event(socket,event){events.push(event);}};
 const app=await fixture(t,{community});const a=await app.client(),b=await app.client(),c=await app.client();
 c.send({type:'join',code:'ZABC23'});assert.match((await c.next()).message,/authenticated/);
 c.send({type:'community',sessionId:'session-test',token:'intruder'});assert.match((await c.next()).message,/Not authorized/);
 a.send({type:'community',sessionId:'session-test',token:'A'});assert.equal((await a.next()).code,'ZABC23');
 c.send({type:'community',sessionId:'session-test',token:'A'});assert.match((await c.next()).message,/already/);
 b.send({type:'community',sessionId:'session-test',token:'B'});assert.equal((await b.next()).code,'ZABC23');
 a.send({type:'ready'});b.send({type:'ready'});await a.next();await b.next();assert.ok(events.includes('connected'));
 a.send({type:'leave'});assert.equal((await b.next()).type,'ended');assert.ok(events.includes('complete'));
});
test('community authorization is rechecked while a room is open',async t=>{
 let revoked=false;const community={async authorize(id,token){return {sessionId:id,userId:token,roomCode:'ZABC24'};},async event(){},async check(){if(revoked)throw new Error('ended');}};
 const app=await fixture(t,{community,heartbeatMs:20});const a=await app.client();
 a.send({type:'community',sessionId:'session-check',token:'member'});await a.next();revoked=true;
 assert.match((await a.next()).message,/authorization expired/);assert.equal(app.rooms.size,0);
});
