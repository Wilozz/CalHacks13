import {test,expect,type Page} from '@playwright/test';
import {existsSync,readFileSync} from 'node:fs';
const localUrl=/^http:\/\/(127\.0\.0\.1|localhost):/;
const localBackend=localUrl.test(process.env.VITE_CONVEX_URL??'') || (existsSync('.env.local') && /^VITE_CONVEX_URL=http:\/\/(127\.0\.0\.1|localhost):/m.test(readFileSync('.env.local','utf8')));
test.skip(!localBackend,'Lesson tests save to Convex and require the LOCAL backend (npm run convex).');
const logs=(p:Page,name:string,out:string[])=>p.on('console',m=>{if(/\[lesson\]|\[call\]|Lesson not/.test(m.text())){out.push(m.text());console.log(`${name}: ${m.text()}`);}});
// Nothing pops up on screen any more: what happened is in the console.
const said=(out:string[],text:string)=>expect.poll(()=>out.some(l=>l.includes(text)),{timeout:15_000}).toBe(true);
// The fake camera shows no lanyard (and there is no AI server here), so it comes out from Hand tools → Saved for the demo.
test('the lanyard is up for both, and the lesson from when it came up until it was closed lands in both people’s Tutorials',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const learner=await a.newPage(),helper=await b.newPage(),ls:string[]=[],hs:string[]=[];
 logs(learner,'learner',ls);logs(helper,'helper',hs);
 await learner.goto('/');await helper.goto('/');
 await learner.getByRole('button',{name:'New call',exact:true}).click();
 await expect(learner.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/,{timeout:20_000});
 await helper.getByLabel('Join with a code').fill(await learner.getByTestId('room-code').innerText());
 await helper.getByRole('button',{name:'Join',exact:true}).click();
 for(const p of [learner,helper])await expect(p.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
 // One call screen: no preset objects, no hand skeleton over the video.
 for(const p of [learner,helper]){await expect(p.getByRole('button',{name:'Teddy bear'})).toHaveCount(0);await expect(p.locator('.hand-overlay')).toHaveCount(0);await expect(p.getByText(/lanyard up to your camera/)).toHaveCount(0);}
 await learner.getByRole('button',{name:'Hand tools'}).click();await learner.getByText('AI scan to 3D model').click();
 await learner.getByRole('group',{name:'Saved for the demo'}).getByRole('button',{name:'★ lanyard'}).click();
 await learner.getByRole('button',{name:'Close',exact:true}).click();
 await expect(learner.locator('.twin-box.stage')).toBeVisible(); // on the screen itself, not the grey box
 for(const p of [learner,helper])await expect(p.getByRole('complementary',{name:'3D copy of lanyard'})).toBeVisible({timeout:10_000});
 for(const p of [learner,helper])await expect(p.getByRole('button',{name:'Throw to your friend'})).toHaveCount(0); // nothing to throw: both can take it
 await said(ls,'lanyard is up, recording');
 await learner.waitForTimeout(3000); // both handle it (a lesson is at least 2 s)
 await learner.getByRole('button',{name:'Close 3D view'}).click(); // closing it ends the lesson
 for(const p of [learner,helper])await expect(p.locator('.twin-box')).toHaveCount(0);
 await said(ls,'Lesson saved to Tutorials');
 await said(hs,'Your friend’s lesson was saved to Tutorials');
 for(const p of [learner,helper])await expect(p.locator('.throw-toast, .hand-hint')).toHaveCount(0); // no pills on screen (the boxes to click are back once it is closed)
 // The call ends; the lesson is in the learner's Tutorials and plays.
 await learner.getByRole('button',{name:'End call'}).click();
 await learner.goto('/#tutorials');await learner.reload(); // the tab is read from the hash on load
 await learner.getByRole('button',{name:/lanyard lesson/}).first().click();
 await expect(learner.locator('.replay-player canvas')).toBeVisible({timeout:15_000});
 await a.close();await b.close();
});
