import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests', timeout:90_000, workers:1,
  use:{baseURL:'http://127.0.0.1:5180',browserName:'chromium',permissions:['camera','microphone'],launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']},trace:'retain-on-failure'},
  webServer:{command:'node scripts/test-server.mjs',url:'http://127.0.0.1:5180',reuseExistingServer:false,timeout:30_000},
});
