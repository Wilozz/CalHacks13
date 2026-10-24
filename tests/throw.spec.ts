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
