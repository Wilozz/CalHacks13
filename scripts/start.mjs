import { spawn } from 'node:child_process';
// Production: the public server (static files, /signal, /health, /ai proxy) plus the AI server behind it.
const server=spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',env:process.env});
// AI server (Claude scan, voice tokens). Optional: if it fails, calls still work and the client uses its offline fallback.
const ai=spawn(process.execPath,['--import','tsx','server/ai.ts'],{stdio:'inherit',env:process.env});
ai.on('exit',code=>{if(!stopping)console.warn(`AI server exited (${code}); AI features are unavailable.`);});
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;server.kill();ai.kill();process.exitCode=code;}
server.on('exit',code=>stop(code??0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
