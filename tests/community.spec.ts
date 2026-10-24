import {test,expect,type Page} from '@playwright/test';
import {existsSync,readFileSync} from 'node:fs';
const localBackend=existsSync('.env.local') && /^VITE_CONVEX_URL=http:\/\/(127\.0\.0\.1|localhost):/m.test(readFileSync('.env.local','utf8'));
test.skip(!localBackend,'Community browser tests require the configured LOCAL Convex backend and auth keys.');
async function signUp(page:Page,name:string){
 await page.goto('/#community');
 await page.getByRole('button',{name:'New here? Sign up',exact:true}).click();
 await page.getByLabel('Display name',{exact:true}).fill(name);
 await page.getByLabel('Email',{exact:true}).fill(`${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
 await page.getByLabel('Password',{exact:true}).fill('Ghost-local-test-123!');
 await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Help requests',exact:true})).toBeVisible({timeout:20000});
 await expect(page.getByRole('button',{name:'Request Help',exact:true})).toBeEnabled();
}
test('two authenticated members reactively match and join the protected GHOST call',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const host=await a.newPage(),helper=await b.newPage();
 await signUp(host,'Requester');await signUp(helper,'Helper');
 await helper.getByRole('checkbox').check();
 const title=`Repair guidance ${Date.now()}`;
 await host.getByRole('button',{name:'Request Help',exact:true}).click();
 await host.getByLabel('Title',{exact:true}).fill(title);await host.getByLabel('Description',{exact:true}).fill('Please help tighten the hinge on my cabinet.');
 await host.getByRole('button',{name:'Send request',exact:true}).click();
 const card=helper.getByRole('heading',{name:title,exact:true}).locator('..');
 await expect(card).toBeVisible({timeout:15000});await expect(helper.getByRole('status').filter({hasText:`New help request: ${title}`})).toBeVisible();
 await card.getByRole('button',{name:'Accept Help',exact:true}).click();
 await expect(helper.getByRole('heading',{name:'Messages & Friends',exact:true})).toBeVisible();
 await expect(host.getByRole('status').filter({hasText:'Helper offered to help. Open Messages to accept their call invitation.'})).toBeVisible({timeout:15000});
 await host.reload();
 await host.getByRole('button',{name:'Activity',exact:true}).click();
 await host.getByRole('button',{name:'Open messages',exact:true}).click();
 await expect(host.getByText("Hey, I'm here to help! Want to join my call?",{exact:true})).toBeVisible();
 await host.getByRole('button',{name:'Accept call',exact:true}).click();
 await expect(host.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35000});await expect(helper.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/);
 const code=await host.getByTestId('room-code').innerText();expect(code).toMatch(/^Z/);expect(await helper.getByTestId('room-code').innerText()).toBe(code);
 const outsider=await browser.newContext({permissions:['camera','microphone']}),third=await outsider.newPage();await third.goto('/');await third.getByLabel('Join with a code').fill(code);await third.getByRole('button',{name:'Join',exact:true}).click();await expect(third.getByRole('alert')).toContainText('authenticated Join Session');
 await host.getByRole('button',{name:'End call',exact:true}).click();
 await helper.getByRole('button',{name:'Activity',exact:true}).click();await host.getByRole('button',{name:'Activity',exact:true}).click();
 await expect(host.getByRole('heading',{name:title,exact:true}).locator('..').getByText('completed',{exact:true})).toBeVisible();
 await host.reload();await expect(host.getByRole('heading',{name:title,exact:true}).locator('..').getByText('completed',{exact:true})).toBeVisible();
 await host.getByLabel('Rate your helper',{exact:true}).selectOption('4');await host.getByRole('button',{name:'Submit rating',exact:true}).click();await expect(host.getByText('Rated 4/5',{exact:true})).toBeVisible();
 await host.getByRole('button',{name:'Messages',exact:true}).click();await host.locator('.conversation-link').filter({hasText:'Helper'}).click();await host.getByRole('button',{name:"View Helper's profile",exact:true}).click();const profile=host.getByRole('dialog',{name:'Member profile'});await expect(profile.getByText('4.0',{exact:false})).toBeVisible();await expect(profile.getByText('1 review',{exact:true})).toBeVisible();
 await a.close();await b.close();await outsider.close();
});
test('private requests support real-time decline and public requests can be cancelled',async({browser})=>{
 const a=await browser.newContext(),b=await browser.newContext();const host=await a.newPage(),helper=await b.newPage();
 await signUp(host,'PrivateRequester');await signUp(helper,'PrivateHelper');await helper.getByRole('checkbox').check();
 await helper.getByRole('button',{name:'Profile',exact:true}).click();
 await host.getByRole('button',{name:'Helpers',exact:true}).click();
 const helperCard=host.getByRole('article').filter({has:host.getByRole('heading',{name:'PrivateHelper',exact:true})});
 await expect(helperCard.getByRole('button',{name:'Request help',exact:true})).toBeVisible();await helperCard.getByRole('button',{name:'Request help',exact:true}).click();
 const title=`Private repair ${Date.now()}`;await host.getByLabel('Title',{exact:true}).fill(title);await host.getByLabel('Description',{exact:true}).fill('I need a private demonstration for my drawer.');await host.getByRole('button',{name:'Send request',exact:true}).click();
 await expect(helper.getByRole('status').filter({hasText:'PrivateRequester requested your help.'})).toBeVisible();
 await helper.getByRole('button',{name:'Activity',exact:true}).click();
 const activity=helper.getByRole('heading',{name:title,exact:true}).locator('..').locator('..');await activity.getByRole('button',{name:'Decline',exact:true}).click();
 await expect(host.getByRole('status').filter({hasText:'Your direct request was declined.'})).toBeVisible();
 await host.getByRole('button',{name:'Request Help',exact:true}).click();await host.getByLabel('Title',{exact:true}).fill(title+' public');await host.getByLabel('Description',{exact:true}).fill('Please show me how to tighten this screw.');await host.getByRole('button',{name:'Send request',exact:true}).click();
 await host.getByRole('button',{name:'Activity',exact:true}).click();await host.getByRole('button',{name:'Cancel request',exact:true}).click();
 await expect(helper.getByRole('heading',{name:title+' public',exact:true})).toHaveCount(0);
 await a.close();await b.close();
});

test('profile edits persist across logout and login',async({page})=>{
 await page.goto('/#community');await page.getByRole('button',{name:'New here? Sign up',exact:true}).click();
 const email=`profile-${Date.now()}@example.test`;
 await page.getByLabel('Display name',{exact:true}).fill('Profile Tester');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Ghost-local-test-123!');await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.getByRole('button',{name:'Request Help',exact:true})).toBeVisible();await page.getByRole('button',{name:'Profile',exact:true}).click();
 await page.getByLabel('Display name',{exact:true}).fill('Updated Profile');await page.getByLabel('Expertise (comma-separated, up to 8 tags)').fill('Repairs, Electronics');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Profile saved.');
 await page.getByRole('button',{name:'Log out',exact:true}).click();await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
 await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Ghost-local-test-123!');await page.getByRole('button',{name:'Log in',exact:true}).click();
 await expect(page.getByLabel('Display name',{exact:true})).toHaveValue('Updated Profile');await expect(page.getByLabel('Expertise (comma-separated, up to 8 tags)')).toHaveValue('Repairs, Electronics');
});

test('friends find usernames, approve friendship, exchange DMs and accept a friend call',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const first=await a.newPage(),second=await b.newPage();await signUp(first,'FriendOne');await signUp(second,'FriendTwo');
 const username=`friend_${Date.now()}`;
 await second.getByRole('button',{name:'Profile',exact:true}).click();await second.getByLabel('Username',{exact:true}).fill(username);await second.getByRole('button',{name:'Save profile',exact:true}).click();await expect(second.getByRole('status').filter({hasText:'Profile saved.'})).toBeVisible();
 await first.getByRole('button',{name:'Messages',exact:true}).click();await first.getByLabel('Search usernames').fill(username);await first.getByRole('button',{name:'Send request',exact:true}).click();
 await second.getByRole('button',{name:'Messages',exact:true}).click();await second.getByRole('button',{name:'Accept friend',exact:true}).click();
 await first.getByRole('button',{name:'Message',exact:true}).click();await first.getByLabel('Message',{exact:true}).fill('Can you show me how to fix this?');await first.getByRole('button',{name:'Send message',exact:true}).click();
 await second.getByRole('button',{name:'Message',exact:true}).click();await expect(second.getByText('Can you show me how to fix this?',{exact:true})).toBeVisible();
 await first.getByRole('button',{name:'Invite to call',exact:true}).click();await expect(first.getByText('Waiting for your invitation to be accepted…')).toBeVisible();await second.getByRole('button',{name:'Decline call',exact:true}).click();await expect(first.getByText('Call declined',{exact:true})).toBeVisible();
 await first.getByRole('button',{name:'Invite to call',exact:true}).click();await second.getByRole('button',{name:'Accept call',exact:true}).click();
 await expect(first.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35000});await expect(second.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/);
 await first.getByRole('button',{name:'End call',exact:true}).click();await a.close();await b.close();
});

test('separate browse pages expose private-safe member cards and avatar profiles',async({browser})=>{
 const a=await browser.newContext(),b=await browser.newContext();const host=await a.newPage(),helper=await b.newPage();await signUp(host,'ProfileVisitor');await signUp(helper,'ProfileMember');
 await helper.getByRole('button',{name:'Profile',exact:true}).click();await helper.getByLabel('About you').fill('I help with furniture repairs.');await helper.getByLabel('Expertise (comma-separated, up to 8 tags)').fill('Furniture, Repairs');await helper.getByRole('checkbox').check();await helper.getByRole('button',{name:'Save profile',exact:true}).click();await expect(helper.getByRole('status').filter({hasText:'Profile saved.'})).toBeVisible();
 await host.getByRole('button',{name:'Helpers',exact:true}).click();await expect(host.getByRole('heading',{name:'Help requests',exact:true})).toHaveCount(0);const card=host.getByRole('article').filter({has:host.getByRole('heading',{name:'ProfileMember',exact:true})});await expect(card.getByText('Not rated yet',{exact:true})).toBeVisible();
 await card.getByRole('button',{name:"View ProfileMember's profile",exact:true}).click();const dialog=host.getByRole('dialog',{name:'Member profile'});await expect(dialog.getByText('I help with furniture repairs.',{exact:true})).toBeVisible();await expect(dialog.getByText('People helped',{exact:true})).toBeVisible();await host.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await card.getByRole('button',{name:"View ProfileMember's profile",exact:true}).click();await dialog.getByRole('button',{name:'Message',exact:true}).click();await expect(host.getByRole('heading',{name:'Messages & Friends',exact:true})).toBeVisible();await host.getByLabel('Message',{exact:true}).fill('Hi, can you help with a cabinet?');await host.getByRole('button',{name:'Send message',exact:true}).click();
 await helper.getByRole('button',{name:'Messages',exact:true}).click();await helper.getByRole('button',{name:/ProfileVisitor/}).click();await expect(helper.getByText('Hi, can you help with a cabinet?',{exact:true})).toBeVisible();
 await host.setViewportSize({width:390,height:844});await host.getByRole('button',{name:"View ProfileMember's profile",exact:true}).click();await expect(host.getByRole('dialog',{name:'Member profile'})).toBeVisible();expect(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await host.getByRole('button',{name:'Close profile',exact:true}).click();await a.close();await b.close();
});

test('automatic usernames resolve @ mixed-case searches and requests appear in the recipient inbox',async({browser})=>{
 const a=await browser.newContext(),b=await browser.newContext();const sender=await a.newPage(),recipient=await b.newPage();const name=`Lookup_${Date.now()}`;
 await signUp(sender,'LookupSender');await signUp(recipient,name);await sender.getByRole('button',{name:'Messages',exact:true}).click();await sender.getByLabel('Search usernames').fill(`@${name.toUpperCase()}`);
 const result=sender.getByRole('article').filter({has:sender.getByText(name,{exact:true})});await expect(result.getByText(`@${name.toLowerCase()}`,{exact:true})).toBeVisible();await result.getByRole('button',{name:`View ${name}'s profile`,exact:true}).click();await expect(sender.getByRole('dialog',{name:'Member profile'}).getByRole('heading',{name,exact:true})).toBeVisible();await sender.getByRole('button',{name:'Close profile',exact:true}).click();
 await result.getByRole('button',{name:'Send request',exact:true}).click();await expect(result.getByRole('button',{name:'Request sent',exact:true})).toBeDisabled();await expect(recipient.getByLabel('1 friend requests')).toBeVisible();
 await recipient.getByRole('button',{name:'Messages',exact:true}).click();const requests=recipient.getByRole('region',{name:'Friend requests',exact:true});await expect(requests.getByText('LookupSender',{exact:true})).toBeVisible();await recipient.reload();await expect(requests.getByText('LookupSender',{exact:true})).toBeVisible();await requests.getByRole('button',{name:'Accept friend',exact:true}).click();await expect(requests).toHaveCount(0);await expect(result.getByRole('button',{name:'Friends',exact:true})).toBeDisabled();
 await sender.getByLabel('Search usernames').fill('@no_such_ghost_user_0123');await expect(sender.getByRole('status').filter({hasText:'No matching username found.'})).toBeVisible();await a.close();await b.close();
});
