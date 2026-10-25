import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
// A mug photo (Wikimedia Commons) as the other object on the desk.
const MUG=`data:image/jpeg;base64,${readFileSync('tests/fixtures/mug.jpg').toString('base64')}`;
// The learner's camera is a canvas: a desk picture with a mug and the lanyard held up in it.
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
// Claude's scan of that picture, as it reports a lanyard: the badge and the strap as separate objects, plus the mug.
const SCAN=[
 {objectId:'badge_1',label:'ID badge',bbox:[0.56,0.3,0.83,0.72],affordances:['lift'],confidence:0.9,seenAt:1},
 {objectId:'strap_1',label:'lanyard strap',bbox:[0.62,0.08,0.76,0.32],affordances:['lift'],confidence:0.8,seenAt:1},
 {objectId:'mug_1',label:'mug',bbox:[0.03,0.37,0.38,0.92],affordances:['lift'],confidence:0.9,seenAt:1,
  model:{parts:[{shape:'cylinder',size:[0.6,0.8,0.6],position:[0,0,0],color:'#d8d2c8',moving:false}],pivot:[0,0,0]}},
];
async function scanned(page:Page){
 let scans=0;
 // Matched on the path: a glob like **/ai/mesh** would also catch the app's own module /src/ai/mesh.ts.
 await page.route(u=>u.pathname==='/ai/scene',r=>{scans++;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(SCAN)});});
 await page.route(u=>u.pathname.startsWith('/ai/mesh'),r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"no FAL_KEY"}'}));
 return ()=>scans;
}
async function inCall(learner:Page,helper:Page){
 await learner.goto('/');await helper.goto('/');
 await learner.getByRole('button',{name:'New call',exact:true}).click();
 await expect(learner.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/,{timeout:20_000});
 await helper.getByLabel('Join with a code').fill(await learner.getByTestId('room-code').innerText());
 await helper.getByRole('button',{name:'Join',exact:true}).click();
 await expect(learner.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
 // The helper presses the helper button: both screens know who helps.
 await helper.getByRole('button',{name:'Become the helper'}).click();
 await expect(helper.getByTestId('helper-state')).toHaveText('You are helping');
 await expect(learner.getByTestId('helper-state')).toHaveText('Your friend is helping',{timeout:10_000});
 await expect(learner.getByRole('button',{name:'Your friend is helping'})).toBeDisabled(); // the helpee's helper button is greyed out
}
test('helper mode: Claude scans only the helpee\'s camera (the lanyard\'s pieces as one box); the helpee clicks it and it comes up on both; turning helper mode off takes it away',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const learner=await a.newPage(),helper=await b.newPage();
 await cameraShows(learner,['/demo/lanyard-ref.png',MUG]);
 const scans=await scanned(learner),helperScans=await scanned(helper);
 await inCall(learner,helper);
 const box=learner.locator('.scene-box',{hasText:'lanyard'});
 await expect(box).toHaveCount(1,{timeout:15_000});                         // badge and strap: one lanyard box
 await expect(learner.locator('.scene-box',{hasText:'ID badge'})).toHaveCount(0);
 for(const p of [learner,helper])await expect(p.locator('.twin-box')).toHaveCount(0); // seen, but not clicked: nothing up
 await box.click();
 for(const p of [learner,helper])await expect(p.locator('.twin-box.stage')).toBeVisible({timeout:10_000});
 const n=scans(); await learner.waitForTimeout(7000);
 expect(scans()).toBe(n);                                                     // scanning stops while it is up
 expect(helperScans()).toBe(0);                                               // and never ran on the helper's screen
 await helper.getByRole('button',{name:'Stop helping'}).click();
 for(const p of [learner,helper])await expect(p.locator('.twin-box')).toHaveCount(0,{timeout:10_000});
 await expect(learner.getByTestId('helper-state')).toHaveCount(0);
 await a.close();await b.close();
});

test('helper mode: the helpee\'s boxes show on the helper\'s screen too, and the helper can click one',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const learner=await a.newPage(),helper=await b.newPage();
 await cameraShows(learner,['/demo/lanyard-ref.png',MUG]);
 await scanned(learner); await scanned(helper);
 await inCall(learner,helper);
 const mug=helper.locator('.scene-box',{hasText:'mug'});
 await expect(mug).toHaveCount(1,{timeout:15_000});
 await mug.click();
 for(const p of [learner,helper])await expect(p.getByRole('complementary',{name:'3D copy of mug'})).toBeVisible({timeout:10_000});
 await a.close();await b.close();
});
