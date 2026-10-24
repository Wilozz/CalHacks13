import {test,expect,type Page} from '@playwright/test';
async function join(host:Page,guest:Page) {
 await host.goto('/');await guest.goto('/');
 await host.getByRole('button',{name:'New call',exact:true}).click();
 await expect(host.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
 const code=await host.getByTestId('room-code').innerText();
 await expect(host.getByText('Waiting for your friend…',{exact:true})).toBeVisible();
 await guest.getByLabel('Join with a code').fill(code);
 await guest.getByRole('button',{name:'Join',exact:true}).click();
 await expect(host.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
 await expect(guest.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
}
test('one short code connects two browsers with bidirectional audio/video, controls and hangup',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const host=await a.newPage(),guest=await b.newPage();
 const errors:string[]=[];
 for(const page of [host,guest]) {
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   const Original=window.RTCPeerConnection;
   window.RTCPeerConnection=class extends Original {
    constructor(configuration?:RTCConfiguration){super(configuration);(window as any).testPeer=this;}
   };
  });
 }
 await join(host,guest);
 if(process.env.GHOST_TEST_TURN_URL) {
  await expect(host.getByText('TURN relay',{exact:true})).toBeVisible();
  await expect(guest.getByText('TURN relay',{exact:true})).toBeVisible();
 }
 for(const page of [host,guest]) {
  await expect.poll(()=>page.locator('.friend-video').evaluate((video:HTMLVideoElement)=>video.videoWidth)).toBeGreaterThan(0);
  const tracks=await page.locator('.friend-video').evaluate((v:HTMLVideoElement)=>(v.srcObject as MediaStream).getTracks().map(t=>({kind:t.kind,state:t.readyState})));
  expect(tracks).toEqual(expect.arrayContaining([{kind:'audio',state:'live'},{kind:'video',state:'live'}]));
  await expect.poll(()=>page.evaluate(async()=>{
   const stats=await ((window as any).testPeer as RTCPeerConnection).getStats();
   let audio=false,video=false;
   stats.forEach(report=>{if(report.type==='inbound-rtp'&&report.bytesReceived>0){if(report.kind==='audio')audio=true;if(report.kind==='video'&&report.framesDecoded>0)video=true;}});
   return audio&&video;
  })).toBe(true);

 }
 await host.getByRole('button',{name:'Mute microphone',exact:true}).click();
 await expect(host.getByRole('button',{name:'Unmute microphone',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await host.locator('.self-video').evaluate((v:HTMLVideoElement)=>(v.srcObject as MediaStream).getAudioTracks()[0].enabled)).toBe(false);
 await host.getByRole('button',{name:'Turn camera off',exact:true}).click();
 expect(await host.locator('.self-video').evaluate((v:HTMLVideoElement)=>(v.srcObject as MediaStream).getVideoTracks()[0].enabled)).toBe(false);
 await host.getByRole('button',{name:'Turn camera on',exact:true}).click();
 await host.getByRole('button',{name:'Unmute microphone',exact:true}).click();
 // Keep references to tracks to prove hangup actually releases resources.
 await host.locator('.self-video').evaluate((v:HTMLVideoElement)=>{(window as any).callTracks=(v.srcObject as MediaStream).getTracks();});
 await host.getByRole('button',{name:'End call',exact:true}).click();
 await expect(guest.getByText('Your friend ended the call.',{exact:true})).toBeVisible();
 expect(await host.evaluate(()=>(window as any).callTracks.every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
 expect(errors).toEqual([]);await a.close();await b.close();
});
test('host can wait beyond old timeout and join starts only after guest permission resolves',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const host=await a.newPage(),guest=await b.newPage();await host.goto('/');await guest.goto('/');
 await guest.evaluate(()=>{
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{
   await new Promise<void>(resolve=>{(window as any).allowCall=resolve;});return original(constraints);
  };
 });
 await host.getByRole('button',{name:'New call',exact:true}).click();
 await expect(host.getByText('Waiting for your friend…',{exact:true})).toBeVisible();
 const code=await host.getByTestId('room-code').innerText();
 // Move the host browser clock past the old two-minute deadline.
 await host.clock.install();await host.clock.fastForward(125_000);
 await expect(host.getByText('Waiting for your friend…',{exact:true})).toBeVisible();
 await guest.getByLabel('Join with a code').fill(code);await guest.getByRole('button',{name:'Join',exact:true}).click();
 await expect(guest.getByTestId('room-code')).toHaveText(code);
 await guest.waitForFunction(()=>typeof (window as any).allowCall==='function');
 await host.clock.fastForward(125_000);
 await expect(host.getByText('Waiting for your friend…',{exact:true})).toBeVisible();
 await guest.evaluate(()=>(window as any).allowCall());await host.clock.resume();
 await expect(host.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
 await expect(guest.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/);
 await a.close();await b.close();
});
test('missing room and denied permissions return actionable errors',async({page})=>{
 await page.goto('/');await page.getByLabel('Join with a code').fill('ZZZ999');await page.getByRole('button',{name:'Join',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Room not found');
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));});
 await page.getByRole('button',{name:'New call',exact:true}).click();await expect(page.getByRole('alert')).toContainText('permission was denied');
 await expect(page.getByRole('button',{name:'New call',exact:true})).toBeVisible();
});
test('cancel while media permission is pending closes later media tracks',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await original(constraints);(window as any).pendingTracks=stream.getTracks();await new Promise<void>(resolve=>{(window as any).allowCall=resolve;});return stream;};
 });
 await page.getByRole('button',{name:'New call',exact:true}).click();await page.waitForFunction(()=>typeof (window as any).allowCall==='function');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>(window as any).allowCall());
 await expect.poll(()=>page.evaluate(()=>(window as any).pendingTracks.every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
 await expect(page.getByRole('button',{name:'New call',exact:true})).toBeVisible();
});
test('room capacity rejects a third participant without disturbing the existing call',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']}),c=await browser.newContext({permissions:['camera','microphone']});
 const host=await a.newPage(),guest=await b.newPage(),third=await c.newPage();await join(host,guest);
 const code=await host.getByTestId('room-code').innerText();await third.goto('/');await third.getByLabel('Join with a code').fill(code);await third.getByRole('button',{name:'Join',exact:true}).click();
 await expect(third.getByRole('alert')).toContainText('two people');
 await expect(host.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/);await expect(guest.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/);
 await guest.getByRole('button',{name:'End call',exact:true}).click();await expect(host.getByText('Your friend ended the call.',{exact:true})).toBeVisible();
 await a.close();await b.close();await c.close();
});
test('hand-tracking camera and call tracks have independent lifetimes',async({browser})=>{
 const a=await browser.newContext({permissions:['camera','microphone']}),b=await browser.newContext({permissions:['camera','microphone']});
 const host=await a.newPage(),guest=await b.newPage();await host.goto('/');await guest.goto('/');
 // Seed the tracking video with a real synthetic camera stream. This isolates
 // sharing/cleanup from model downloads and MediaPipe inference.
 await host.locator('.camera-stage video').evaluate(async(v:HTMLVideoElement)=>{
  const stream=await navigator.mediaDevices.getUserMedia({video:true});v.srcObject=stream;await v.play();(window as any).trackingStream=stream;
 });
 await host.getByRole('button',{name:'New call',exact:true}).click();await expect(host.getByText('Waiting for your friend…',{exact:true})).toBeVisible();
 const code=await host.getByTestId('room-code').innerText();await guest.getByLabel('Join with a code').fill(code);await guest.getByRole('button',{name:'Join',exact:true}).click();await expect(host.getByTestId('call-state')).toHaveText(/^\d\d:\d\d$/,{timeout:35_000});
 await host.evaluate(()=>(window as any).trackingStream.getTracks().forEach((t:MediaStreamTrack)=>t.stop()));
 expect(await host.locator('.self-video').evaluate((v:HTMLVideoElement)=>(v.srcObject as MediaStream).getVideoTracks()[0].readyState)).toBe('live');
 await host.getByRole('button',{name:'End call',exact:true}).click();await a.close();await b.close();
});
test('signaling outage shows an error and cancels its deadline',async({page})=>{
 await page.routeWebSocket('**/signal',ws=>ws.close({code:1011,reason:'Test service outage'}));
 await page.goto('/');await page.getByRole('button',{name:'New call',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('calling server');await expect(page.getByRole('button',{name:'New call',exact:true})).toBeVisible();
});
