import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const aiPort = loadEnv(mode, process.cwd(), 'GHOST_').GHOST_AI_PORT ?? '8790';
  const https = process.env.GHOST_HTTPS === '1';
  return {
    plugins: [react()],
    server: {
      strictPort: true,
      proxy: {
        '/signal': {target:process.env.GHOST_SIGNALING_TARGET || 'ws://127.0.0.1:8787',ws:true},
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
