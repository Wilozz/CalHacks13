import {test,expect} from '@playwright/test';
test('a hologram tossed on the throwing prototype lands on the other caller',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const host=await a.newPage(),guest=await b.newPage();
 await host.goto('/#throw');await guest.goto('/#throw');
 await host.getByRole('button',{name:'New call',exact:true}).click();
 await expect(host.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/,{timeout:20_000});
 await guest.getByLabel('Room code').fill(await host.getByTestId('room-code').innerText());
 await guest.getByRole('button',{name:'Join',exact:true}).click();
 for(const p of [host,guest])await expect(p.getByTestId('call-state')).toHaveText('Reach through',{timeout:35_000});
 await host.getByRole('button',{name:'Mug',exact:true}).click();
 const toss=host.getByRole('button',{name:'Toss',exact:true});
 await expect(toss).toBeEnabled({timeout:5_000});
 await toss.click();
 await expect(guest.getByText('Your friend tossed you a mug',{exact:true})).toBeVisible({timeout:5_000});
 await expect(host.getByText('Tossed a mug to your friend',{exact:true})).toBeVisible();
 // Now the guest holds it and can throw it back.
 await expect(guest.getByRole('button',{name:'Toss',exact:true})).toBeEnabled({timeout:5_000});
 await expect(host.getByRole('button',{name:'Toss',exact:true})).toBeDisabled();
 await guest.getByRole('button',{name:'Toss',exact:true}).click();
 await expect(host.getByText('Your friend tossed you a mug',{exact:true})).toBeVisible({timeout:5_000});
 await a.close();await b.close();
});

test('a computer and a phone each keep their own objects and throw at the same moment',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']});
 const b=await browser.newContext({permissions:['camera','microphone'],viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
 const host=await a.newPage(),phone=await b.newPage();
 await host.goto('/#throw');await phone.goto('/#throw');
 await host.getByRole('button',{name:'New call',exact:true}).click();
 await expect(host.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/,{timeout:20_000});
 await phone.getByLabel('Room code').fill(await host.getByTestId('room-code').innerText());
 await phone.getByRole('button',{name:'Join',exact:true}).click();
 for(const p of [host,phone])await expect(p.getByTestId('call-state')).toHaveText('Reach through',{timeout:35_000});
 const chip=(p:typeof host,name:string)=>p.getByRole('button',{name,exact:true});
 await chip(host,'Mug').click();await chip(host,'Teddy bear').click();await chip(phone,'Pill bottle').click();
 for(const [p,n] of [[host,'Mug'],[host,'Teddy bear'],[phone,'Pill bottle']] as const)await expect(chip(p,n)).toHaveAttribute('aria-pressed','true');
 for(const p of [host,phone])await expect(p.locator('.throw-hint')).not.toContainText('Scanning',{timeout:5_000}); // Toss throws the newest finished object
 // Both throw at once: the host's newest (the bear) and the phone's pill bottle cross through the portal.
 await Promise.all([host,phone].map(p=>p.getByRole('button',{name:'Toss',exact:true}).click()));
 await expect(phone.getByText('Your friend tossed you a teddy bear',{exact:true})).toBeVisible({timeout:5_000});
 await expect(host.getByText('Your friend tossed you a pill bottle',{exact:true})).toBeVisible({timeout:5_000});
 // Catching never replaces what you already had: the host still has the mug, now with the pill bottle.
 await expect(chip(host,'Mug')).toHaveAttribute('aria-pressed','true');
 await expect(chip(host,'Pill bottle')).toHaveAttribute('aria-pressed','true');
 await expect(chip(host,'Teddy bear')).toHaveAttribute('aria-pressed','false');
 await expect(chip(phone,'Teddy bear')).toHaveAttribute('aria-pressed','true');
 await expect(chip(phone,'Pill bottle')).toHaveAttribute('aria-pressed','false');
 await a.close();await b.close();
});
