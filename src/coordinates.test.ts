import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transformHand,cameraDepth,type HandFrame} from './coordinates';
const frame:HandFrame={timestamp:1,inferenceMs:1,handedness:'Left',landmarks:Array.from({length:21},()=>({x:.5,y:.5,z:0})),worldLandmarks:Array.from({length:21},(_,i)=>({x:i*.01,y:i*.02,z:i*-.005}))};
test('world geometry is wrist relative, mirrored, depth preserving, uniformly scaled',()=>{
 const points=transformHand(frame,4/3);
 assert.deepEqual(points[0],{x:0,y:-.1,z:0});
 assert.ok(Math.abs(points[1].x + .12)<1e-9);
 assert.ok(Math.abs(points[1].y + .34)<1e-9);
 assert.ok(Math.abs(points[1].z - .06)<1e-9);
 const shifted={...frame,worldLandmarks:frame.worldLandmarks.map(p=>({x:p.x+2,y:p.y+3,z:p.z+4}))};
 transformHand(shifted,4/3).forEach((p,i)=>{assert.ok(Math.abs(p.x-points[i].x)<1e-9);assert.ok(Math.abs(p.y-points[i].y)<1e-9);assert.ok(Math.abs(p.z-points[i].z)<1e-9);});
});
test('image fallback is finite and absent hands produce no skeleton',()=>{
 assert.equal(transformHand({...frame,worldLandmarks:[]},4/3).length,21);
 assert.deepEqual(transformHand({...frame,landmarks:[]},4/3),[]);
});

test('rear camera flips only screen X and preserves hand geometry/depth',()=>{
 const offCenter={...frame,landmarks:frame.landmarks.map(p=>({...p,x:.7}))};
 const front=transformHand(offCenter,3/4,true);
 const rear=transformHand(offCenter,3/4,false);
 front.forEach((p,i)=>{
   assert.ok(Math.abs(p.x+rear[i].x)<1e-9);
   assert.equal(p.y,rear[i].y);
   assert.equal(p.z,rear[i].z);
 });
 assert.ok(front[0].x<0 && rear[0].x>0);
});
test('rotation aspect changes screen anchor, not world finger proportions',()=>{
 const offCenter={...frame,landmarks:frame.landmarks.map(p=>({...p,x:.7}))};
 const portrait=transformHand(offCenter,3/4);
 const landscape=transformHand(offCenter,4/3);
 const distance=(points: ReturnType<typeof transformHand>)=>Math.hypot(points[8].x-points[5].x,points[8].y-points[5].y,points[8].z-points[5].z);
 assert.ok(Math.abs(distance(portrait)-distance(landscape))<1e-9);
});
test('apparent hand size moves the skeleton toward the camera, tilt does not',()=>{
 const world=Array.from({length:21},(_,i)=>({x:(i%5)*.02,y:Math.floor(i/5)*.02,z:0}));
 const at=(k:number,tilt=1):HandFrame=>({...frame,worldLandmarks:world.map(p=>({...p,y:p.y*tilt})),landmarks:world.map(p=>({x:.5+p.x*k/(4/3),y:.5+p.y*tilt*k,z:0}))});
 const far=cameraDepth(at(1.2),4/3), near=cameraDepth(at(4.8),4/3);
 assert.ok(near>far);
 assert.ok(Math.abs(cameraDepth(at(2.4),4/3))<1e-9);
 assert.ok(Math.abs(cameraDepth(at(2.4,.3),4/3))<1e-9);
 assert.equal(transformHand(at(4.8),4/3)[0].z,near);
});
