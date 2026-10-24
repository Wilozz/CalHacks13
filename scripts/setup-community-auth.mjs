import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const local=readFileSync('.env.local','utf8');
if(!/^CONVEX_DEPLOYMENT=(local|anonymous):/m.test(local) || !/^VITE_CONVEX_URL=http:\/\/(127\.0\.0\.1|localhost):/m.test(local))throw new Error('This helper only configures a LOCAL Convex deployment. Start npm run convex first.');
const cli='node_modules/convex/bin/main.js';
const check=spawnSync(process.execPath,[cli,'env','get','JWKS'],{encoding:'utf8'});
if(check.status===0 && check.stdout.includes('keys')) {console.log('Local auth keys already exist; preserving them.');process.exit(0);}
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const values={JWT_PRIVATE_KEY:keys.privateKey.export({format:'pem',type:'pkcs8'}).trimEnd().replace(/\n/g,' '),JWKS:JSON.stringify({keys:[{...keys.publicKey.export({format:'jwk'}),use:'sig'}]})};
for(const [name,value] of Object.entries(values)) {
 const result=spawnSync(process.execPath,[cli,'env','set',name],{input:value,encoding:'utf8'});
 if(result.status!==0)throw new Error(`Could not configure ${name}. Ensure the local Convex watcher is running.`);
}
console.log('Local-only authentication signing keys configured. Secret values were not printed.');
