import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
// A mug photo (Wikimedia Commons) as the other object on the desk.
const MUG=`data:image/jpeg;base64,${readFileSync('tests/fixtures/mug.jpg').toString('base64')}`;
// The learner's camera is a canvas: a cluttered desk picture with the stored lanyard's reference picture held up in it.
// Nobody clicks anything: the on-device finder boxes the objects and brings the lanyard up by itself.
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
test('the lanyard held up to the camera is found on the device and comes up on both screens by itself',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const learner=await a.newPage(),helper=await b.newPage();
 await cameraShows(learner,['/demo/lanyard-ref.png',MUG]);
 learner.on('console',m=>{if(/\[find\] (on device|by Claude|models)|Object finder/.test(m.text()))console.log('learner:',m.text());});
 // The models load with the page (cached after the first visit), before anyone starts a call.
 const ready=new Promise<void>(r=>learner.on('console',m=>{if(/models ready/.test(m.text()))r();}));
 await learner.goto('/');await helper.goto('/');await ready;
 await learner.getByRole('button',{name:'New call',exact:true}).click();
 await expect(learner.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/,{timeout:20_000});
 await helper.getByLabel('Join with a code').fill(await learner.getByTestId('room-code').innerText());
 await helper.getByRole('button',{name:'Join',exact:true}).click();
 await expect(learner.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
 await learner.getByRole('button',{name:'Find the lanyard'}).click(); // every call starts with finding off
 const t0=Date.now();
 for(const p of [learner,helper])await expect(p.locator('.twin-box.stage')).toBeVisible({timeout:10_000});
 console.log(`lanyard up ${Date.now()-t0} ms after finding was switched on`);
 await expect(learner.locator('.scene-box, .throw-toast')).toHaveCount(0); // the boxes are found, not drawn
 await a.close();await b.close();
});

test('with finding switched off, nothing comes up whatever the camera sees; switched on, the lanyard does',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const learner=await a.newPage(),helper=await b.newPage();
 await cameraShows(learner,['/demo/lanyard-ref.png',MUG]);
 const ready=new Promise<void>(r=>learner.on('console',m=>{if(/models ready/.test(m.text()))r();}));
 await learner.goto('/');await helper.goto('/');await ready;
 await learner.getByRole('button',{name:'New call',exact:true}).click();
 await expect(learner.getByRole('button',{name:'Find the lanyard'})).toHaveAttribute('aria-pressed','false'); // off from the start
 await expect(learner.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/,{timeout:20_000});
 await helper.getByLabel('Join with a code').fill(await learner.getByTestId('room-code').innerText());
 await helper.getByRole('button',{name:'Join',exact:true}).click();
 await expect(learner.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
 await learner.waitForTimeout(3000);
 for(const p of [learner,helper])await expect(p.locator('.twin-box')).toHaveCount(0);
 await learner.getByRole('button',{name:'Find the lanyard'}).click();
 for(const p of [learner,helper])await expect(p.locator('.twin-box.stage')).toBeVisible({timeout:10_000});
 await a.close();await b.close();
});
