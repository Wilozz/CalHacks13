import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
// A mug photo (Wikimedia Commons) as the other object on the desk.
const MUG=`data:image/jpeg;base64,${readFileSync('tests/fixtures/mug.jpg').toString('base64')}`;
// The learner's camera is a canvas: a cluttered desk picture with the stored lanyard's reference picture held up in it.
// The on-device finder boxes the objects; the person clicks the one to bring up.
async function cameraShows(page:Page,images:string[]){
 await page.addInitScript(images=>{
  const real=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async c=>{
   const out=await real({audio:!!c?.audio,video:false});
   if(!c?.video)return out;
   const cv=Object.assign(document.createElement('canvas'),{width:640,height:480}),g=cv.getContext('2d')!;
   const imgs=await Promise.all(images.map(u=>new Promise<HTMLImageElement>(r=>{const i=new Image();i.onload=()=>r(i);i.src=u;})));
   const draw=()=>{g.fillStyle='#6b6f75';g.fillRect(0,0,640,480);g.drawImage(imgs[1],20,180,220,260);g.drawImage(imgs[0],360,40,170,300);requestAnimationFrame(draw);};draw();
   return new MediaStream([...cv.captureStream(30).getVideoTracks(),...out.getAudioTracks()]);
  };
 },images);
}
async function inCall(learner:Page,helper:Page){
 const ready=new Promise<void>(r=>learner.on('console',m=>{if(/models ready/.test(m.text()))r();}));
 await learner.goto('/');await helper.goto('/');await ready;
 await learner.getByRole('button',{name:'New call',exact:true}).click();
 await expect(learner.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/,{timeout:20_000});
 await helper.getByLabel('Join with a code').fill(await learner.getByTestId('room-code').innerText());
 await helper.getByRole('button',{name:'Join',exact:true}).click();
 await expect(learner.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
}
test('the objects on camera get boxes; nothing comes up by itself; clicking the lanyard brings it up on both screens',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const learner=await a.newPage(),helper=await b.newPage();
 await cameraShows(learner,['/demo/lanyard-ref.png',MUG]);
 learner.on('console',m=>{if(/\[find\]|Object finder/.test(m.text()))console.log('learner:',m.text());});
 await inCall(learner,helper);
 await expect(learner.getByRole('button',{name:'Find the lanyard'})).toHaveCount(0); // no finder switch any more
 const box=learner.locator('.scene-box',{hasText:'lanyard'});
 await expect(box).toBeVisible({timeout:10_000});
 await learner.waitForTimeout(2000);
 for(const p of [learner,helper])await expect(p.locator('.twin-box')).toHaveCount(0); // seen, but not clicked: nothing up
 const t0=Date.now();
 await box.click();
 for(const p of [learner,helper])await expect(p.locator('.twin-box.stage')).toBeVisible({timeout:10_000});
 console.log(`lanyard up ${Date.now()-t0} ms after the click`);
 await expect(learner.locator('.scene-box')).toHaveCount(0); // the boxes go once a copy is up
 await expect(learner.getByRole('button',{name:'Throw to your friend'})).toHaveCount(0);
 await a.close();await b.close();
});

test('clicking another object brings up a built-in shape for it',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const learner=await a.newPage(),helper=await b.newPage();
 await cameraShows(learner,['/demo/lanyard-ref.png',MUG]);
 await inCall(learner,helper);
 const other=learner.locator('.scene-box').filter({hasNotText:'lanyard'}).first();
 await expect(other).toBeVisible({timeout:10_000});
 const label=(await other.innerText()).trim();
 await other.click();
 for(const p of [learner,helper])await expect(p.getByRole('complementary',{name:`3D copy of ${label}`})).toBeVisible({timeout:10_000});
 await a.close();await b.close();
});
