// Classic worker: MediaPipe's WASM loader uses importScripts.
self.exports = {};
importScripts('./vendor/vision.js');
const { FilesetResolver, HandLandmarker } = self.exports;
let detector;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks('./vendor/wasm');
      detector = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
  } else if (data.type === 'frame') {
    const bitmap = data.bitmap;
    try {
      if (!detector) throw new Error('Tracker is not ready');
      const start = performance.now();
      const result = detector.detectForVideo(bitmap, data.timestamp);
      self.postMessage({ type: 'result', aspect: data.aspect, frame: {
        timestamp: data.timestamp, landmarks: result.landmarks[0] ?? [],
        worldLandmarks: result.worldLandmarks[0] ?? [],
        handedness: result.handedness[0]?.[0]?.categoryName ?? '',
        inferenceMs: performance.now() - start,
      }});
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
    finally { bitmap.close(); }
  }
};
