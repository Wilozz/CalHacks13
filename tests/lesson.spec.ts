import {test,expect,type Page} from '@playwright/test';
import {existsSync,readFileSync} from 'node:fs';
const localUrl=/^http:\/\/(127\.0\.0\.1|localhost):/;
const localBackend=localUrl.test(process.env.VITE_CONVEX_URL??'') || (existsSync('.env.local') && /^VITE_CONVEX_URL=http:\/\/(127\.0\.0\.1|localhost):/m.test(readFileSync('.env.local','utf8')));
test.skip(!localBackend,'Lesson tests save to Convex and require the LOCAL backend (npm run convex).');
const logs=(p:Page,name:string,out:string[])=>p.on('console',m=>{if(/\[lesson\]|Lesson not/.test(m.text()))console.log(`${name}: ${m.text()}`);});
// The fake camera shows no lanyard (and there is no AI server here), so the lanyard comes out with the "Show lanyard" button.
test('the lanyard is thrown to the helper and back, and the helper’s lesson lands in both people’s Tutorials',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const learner=await a.newPage(),helper=await b.newPage(),seen:string[]=[];
 logs(learner,'learner',seen);logs(helper,'helper',seen);
 await learner.goto('/');await helper.goto('/');
 await learner.getByRole('button',{name:'New call',exact:true}).click();
 await expect(learner.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/,{timeout:20_000});
 await helper.getByLabel('Join with a code').fill(await learner.getByTestId('room-code').innerText());
 await helper.getByRole('button',{name:'Join',exact:true}).click();
 for(const p of [learner,helper])await expect(p.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
 // One call screen: no preset objects, no hand skeleton over the video.
 for(const p of [learner,helper]){await expect(p.getByRole('button',{name:'Teddy bear'})).toHaveCount(0);await expect(p.locator('.hand-overlay')).toHaveCount(0);}
 await learner.getByRole('button',{name:'Show lanyard',exact:true}).click();
 for(const p of [learner,helper])await expect(p.getByRole('complementary',{name:'3D copy of lanyard'})).toBeVisible({timeout:10_000});
 await expect(helper.getByRole('button',{name:'Throw to your friend'})).toHaveCount(0); // only the holder can throw
 await learner.getByRole('button',{name:'Throw to your friend'}).click();
 await expect(helper.getByText('Your friend threw you the lanyard',{exact:true})).toBeVisible({timeout:5_000});
 await expect(learner.getByRole('button',{name:'Throw to your friend'})).toHaveCount(0);
 await helper.waitForTimeout(3000); // the helper unclips and clips it (a lesson is at least 2 s)
 await helper.getByRole('button',{name:'Throw to your friend'}).click();
 await expect(learner.getByText('Your friend threw you the lanyard',{exact:true})).toBeVisible({timeout:5_000});
 await expect(helper.getByText('Lesson saved to Tutorials',{exact:true})).toBeVisible({timeout:15_000});
 await expect(learner.getByText('Your friend’s lesson was saved to Tutorials',{exact:true})).toBeVisible({timeout:15_000});
 // The call ends; the lesson is in the learner's Tutorials and plays.
 await learner.getByRole('button',{name:'End call'}).click();
 await learner.goto('/#tutorials');await learner.reload(); // the tab is read from the hash on load
 await learner.getByRole('button',{name:/lanyard lesson \(from your friend\)/}).click();
 await expect(learner.locator('.replay-player canvas')).toBeVisible({timeout:15_000});
 await a.close();await b.close();
});
