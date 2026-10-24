import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  const https = process.env.GHOST_HTTPS === '1';
  return {
    plugins: [react()],
    server: {
      strictPort: true,
      proxy: {'/signal': {target:process.env.GHOST_SIGNALING_TARGET || 'ws://127.0.0.1:8787',ws:true}},
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
