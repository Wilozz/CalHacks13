import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
await copyFile('node_modules/@mediapipe/tasks-vision/vision_bundle.cjs', 'public/vendor/vision.js');
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/vendor/wasm', { recursive: true });
