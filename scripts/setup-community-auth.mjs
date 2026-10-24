import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const prod=process.argv.includes('--prod'),target=prod?['--prod']:[]; // --prod: the cloud production deployment of the logged-in project.
const local=prod?'':readFileSync('.env.local','utf8');
if(!prod && (!/^CONVEX_DEPLOYMENT=(local|anonymous):/m.test(local) || !/^VITE_CONVEX_URL=http:\/\/(127\.0\.0\.1|localhost):/m.test(local)))throw new Error('This helper only configures a LOCAL Convex deployment. Start npm run convex first.');
const cli='node_modules/convex/bin/main.js';
const check=spawnSync(process.execPath,[cli,'env','get',...target,'JWKS'],{encoding:'utf8'});
if(check.status===0 && check.stdout.includes('keys')) {console.log(`${prod?'Production':'Local'} auth keys already exist; preserving them.`);process.exit(0);}
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const values={JWT_PRIVATE_KEY:keys.privateKey.export({format:'pem',type:'pkcs8'}).trimEnd().replace(/\n/g,' '),JWKS:JSON.stringify({keys:[{...keys.publicKey.export({format:'jwk'}),use:'sig'}]})};
for(const [name,value] of Object.entries(values)) {
 const result=spawnSync(process.execPath,[cli,'env','set',...target,name],{input:value,encoding:'utf8'});
 if(result.status!==0)throw new Error(`Could not configure ${name}. Ensure the local Convex watcher is running.`);
}
console.log(`${prod?'Production':'Local'} authentication signing keys configured. Secret values were not printed.`);
