import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCallCode, encodeCallCode, waitForIce } from './callSignaling';
test('invitation/reply roundtrip and chat whitespace',()=>{
 for(const type of ['offer','answer'] as const) {
   const description={type,sdp:'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'};
   const code=encodeCallCode(description);
   assert.deepEqual(decodeCallCode(`\n${code.slice(0,20)}\n${code.slice(20)} `,type),description);
 }
});
test('rejects wrong role, malformed, oversized and unsupported codes',()=>{
 const offer=encodeCallCode({type:'offer',sdp:'v=0\r\n'});
 for(const code of [offer,'garbage','x'.repeat(100001),btoa(JSON.stringify({version:2,description:{type:'answer',sdp:'v=0'}})),btoa(JSON.stringify({version:1,description:{type:'answer',sdp:123}}))]) {
   assert.throws(()=>decodeCallCode(code,'answer'));
 }
});
class FakePeer extends EventTarget {
 iceGatheringState='gathering'; signalingState='stable';
 asPeer(){return this as unknown as RTCPeerConnection;}
}
test('waits for complete ICE gathering before exposing a connection code',async()=>{
 const pc=new FakePeer();let resolved=false;
 const gathering=waitForIce(pc.asPeer()).then(()=>{resolved=true;});
 await Promise.resolve();assert.equal(resolved,false);
 pc.iceGatheringState='complete';pc.dispatchEvent(new Event('icegatheringstatechange'));
 await gathering;assert.equal(resolved,true);
 await waitForIce(pc.asPeer());
});
test('cancelling a call rejects and cleans the ICE wait',async()=>{
 const pc=new FakePeer();const gathering=waitForIce(pc.asPeer());
 pc.signalingState='closed';pc.dispatchEvent(new Event('signalingstatechange'));
 await assert.rejects(gathering,/cancelled/);
});
test('abort releases the ICE wait even when close emits no browser event',async()=>{
 const pc=new FakePeer();const abort=new AbortController();
 const gathering=waitForIce(pc.asPeer(),abort.signal);
 abort.abort();await assert.rejects(gathering,/cancelled/);
 await assert.rejects(waitForIce(pc.asPeer(),abort.signal),/cancelled/);
});
