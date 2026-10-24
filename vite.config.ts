import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // PORT is the signaling server's port (same .env the server reads), so one setting moves both.
  const env = loadEnv(mode, process.cwd(), ['GHOST_', 'PORT']);
  const aiPort = env.GHOST_AI_PORT ?? '8790';
  const signalingPort = env.PORT ?? '8787';
  const https = process.env.GHOST_HTTPS === '1';
  return {
    plugins: [react()],
    server: {
      strictPort: true,
      proxy: {
        '/signal': {target:process.env.GHOST_SIGNALING_TARGET || `ws://127.0.0.1:${signalingPort}`,ws:true},
        '/ai': `http://127.0.0.1:${aiPort}`,
      },
      ...(https ? {
      host: '0.0.0.0',
      https: {
        key: readFileSync('.cert/localhost-key.pem'),
        cert: readFileSync('.cert/localhost.pem'),
      },
      } : {}),
    },
  };
});
