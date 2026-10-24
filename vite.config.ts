import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const aiPort = loadEnv(mode, process.cwd(), 'GHOST_').GHOST_AI_PORT ?? '8787';
  const https = process.env.GHOST_HTTPS === '1';
  return {
    plugins: [react()],
    server: {
      proxy: { '/ai': `http://127.0.0.1:${aiPort}` },
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
