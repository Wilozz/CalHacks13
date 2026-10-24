import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
if (!existsSync('.cert/localhost.pem') || !existsSync('.cert/localhost-key.pem')) {
  console.error('Missing local HTTPS certificate. Follow README.md → Test on an actual phone to create .cert/localhost.pem and .cert/localhost-key.pem.');
  process.exit(1);
}
const child = spawn(process.execPath, ['scripts/dev.mjs', '--host', '0.0.0.0'], {
  stdio: 'inherit', env: { ...process.env, GHOST_HTTPS: '1' },
});
child.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
