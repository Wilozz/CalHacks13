import {spawn} from 'node:child_process';
const env={...process.env,HOST:'127.0.0.1',PORT:'8788',ALLOWED_ORIGINS:'http://127.0.0.1:5180',GHOST_SIGNALING_TARGET:'ws://127.0.0.1:8788',VITE_SIGNALING_URL:'/signal',GHOST_HTTPS:'0'};
// Isolated from user .env: tests must never use a real relay's credentials.
delete env.TURN_URLS;delete env.TURN_SHARED_SECRET;delete env.RELAY_ONLY;
if(process.env.GHOST_TEST_TURN_URL) {env.TURN_URLS=process.env.GHOST_TEST_TURN_URL;env.TURN_SHARED_SECRET=process.env.GHOST_TEST_TURN_SECRET;env.RELAY_ONLY='true';}
const backend=spawn(process.execPath,['server/test-entry.mjs'],{stdio:'inherit',env});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5180','--strictPort'],{stdio:'inherit',env});
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;backend.kill();vite.kill();process.exitCode=code;}
backend.on('exit',code=>stop(code??0));vite.on('exit',code=>stop(code??0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
