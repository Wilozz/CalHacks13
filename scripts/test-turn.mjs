import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createConnection} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
const temporary=mkdtempSync(join(tmpdir(),'ghost-relay-test-'));
const secret=randomBytes(32).toString('hex');
const config=join(temporary,'turn.conf');
writeFileSync(config,`listening-ip=127.0.0.1\nrelay-ip=127.0.0.1\nlistening-port=3480\nrealm=ghost-local-test\nfingerprint\nuse-auth-secret\nstatic-auth-secret=${secret}\nno-tls\nno-dtls\nallow-loopback-peers\nno-cli\nmin-port=49300\nmax-port=49350\npidfile=${join(temporary,'turn.pid')}\nlog-file=${join(temporary,'turn.log')}\n`,{mode:0o600});
const turn=spawn(process.env.GHOST_TEST_TURN_BINARY??'turnserver',['-c',config],{stdio:'ignore'});
let launchError;
turn.on('error',error=>{launchError=error;});
let runner;
function stop(){runner?.kill();turn.kill();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
try {
 let ready=false;
 for(let attempt=0;attempt<40;attempt++) {
  if(launchError)throw new Error('Install coturn to run the actual relay test (brew install coturn or your OS package manager), or set GHOST_TEST_TURN_BINARY.');
  ready=await new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:3480});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});
  if(ready)break;await delay(100);
 }
 if(!ready)throw new Error('Temporary coturn did not start on localhost:3480.');
 for(const transport of ['udp','tcp']) {
  console.log(`Testing forced TURN over ${transport.toUpperCase()}`);
  runner=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','--grep','one short code'],{stdio:'inherit',env:{...process.env,GHOST_TEST_TURN_URL:`turn:127.0.0.1:3480?transport=${transport}`,GHOST_TEST_TURN_SECRET:secret}});
  const code=await new Promise((resolve,reject)=>{runner.once('exit',resolve);runner.once('error',reject);});
  if(code!==0){process.exitCode=code??1;break;}
 }
} catch(error){console.error(error.message);process.exitCode=1;} finally {turn.kill();}
