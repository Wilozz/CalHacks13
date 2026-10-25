import {test,expect,type Page} from '@playwright/test';
import {existsSync,readFileSync} from 'node:fs';
const localBackend=existsSync('.env.local') && /^VITE_CONVEX_URL=http:\/\/(127\.0\.0\.1|localhost):/m.test(readFileSync('.env.local','utf8'));
test.skip(!localBackend,'Lesson tests save to Convex and require the LOCAL backend (npm run convex).');
const logs=(p:Page,name:string,out:string[])=>p.on('console',m=>{if(/\[lesson\]|Lesson not/.test(m.text()))out.push(`${name}: ${m.text()}`);});
test('the helper’s lesson (their hands) is saved to the learner’s Tutorials too',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const learner=await a.newPage(),helper=await b.newPage(),seen:string[]=[];
 logs(learner,'learner',seen);logs(helper,'helper',seen);
 await learner.goto('/#throw');await helper.goto('/#throw');
 await learner.getByRole('button',{name:'New call',exact:true}).click();
 await expect(learner.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/,{timeout:20_000});
 await helper.getByLabel('Room code').fill(await learner.getByTestId('room-code').innerText());
 await helper.getByRole('button',{name:'Join',exact:true}).click();
 for(const p of [learner,helper])await expect(p.getByTestId('call-state')).toHaveText('Reach through',{timeout:35_000});
 await learner.getByRole('button',{name:'Mug',exact:true}).click();
 await expect(learner.getByRole('button',{name:'Toss',exact:true})).toBeEnabled({timeout:5_000});
 await learner.getByRole('button',{name:'Toss',exact:true}).click();
 await expect(helper.getByText('Your friend tossed you a mug',{exact:true})).toBeVisible({timeout:5_000});
 await helper.waitForTimeout(3000); // the helper demonstrates (a lesson is at least 2 s)
 await helper.getByRole('button',{name:'Toss',exact:true}).click();
 await expect(helper.getByText('Lesson saved to Tutorials',{exact:true})).toBeVisible({timeout:15_000});
 await expect(learner.getByText('Your friend’s lesson was saved to Tutorials',{exact:true})).toBeVisible({timeout:15_000});
 console.log(seen.join('\n'));
 await learner.goto('/#tutorials');await learner.reload(); // the tab is read from the hash on load
 await learner.getByRole('button',{name:/Mug lesson \(from your friend\)/}).click();
 await expect(learner.locator('.replay-player canvas')).toBeVisible({timeout:15_000});
 await a.close();await b.close();
});
