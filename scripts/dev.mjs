import { spawn } from 'node:child_process';
const signaling=spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',env:process.env});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1',...process.argv.slice(2)],{stdio:'inherit',env:process.env});
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;signaling.kill();vite.kill();process.exitCode=code;}
signaling.on('exit',code=>stop(code??0));vite.on('exit',code=>stop(code??0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
