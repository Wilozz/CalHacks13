// Classic worker: MediaPipe's WASM loader uses importScripts. Runs beside tracking.worker.js so hand tracking never waits.
// Boxes every object in the frame (EfficientDet-Lite0, COCO), then scores how much each box looks like the reference
// pictures of the stored lanyard (MobileNet-V3 embeddings, cosine similarity). Plain data in and out; frames never leave.
self.exports = {};
importScripts('./vendor/vision.js');
const { FilesetResolver, ObjectDetector, ImageEmbedder } = self.exports;
const DETECTOR = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';
const EMBEDDER = 'https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite';
// Too big to be the thing in your hand (a lanyard worn on a person is found through the hand boxes instead).
const SKIP = new Set(['person', 'dining table', 'chair', 'couch', 'bed', 'tv', 'refrigerator', 'oven', 'toilet', 'sink', 'bench', 'car']);
let detector, embedder, refs = [];
const clamp = n => Math.min(1, Math.max(0, n));
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks('./vendor/wasm');
      [detector, embedder] = await Promise.all([
        ObjectDetector.createFromOptions(files, { baseOptions: { modelAssetPath: DETECTOR, delegate: 'CPU' }, runningMode: 'IMAGE', scoreThreshold: 0.15, maxResults: 10 }),
        ImageEmbedder.createFromOptions(files, { baseOptions: { modelAssetPath: EMBEDDER, delegate: 'CPU' }, runningMode: 'IMAGE', l2Normalize: true }),
      ]);
      refs = data.refs.map(b => { const e = embedder.embed(b).embeddings[0]; b.close(); return e; });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
  } else if (data.type === 'ref') {
    // A real picture of the lanyard (a crop Claude confirmed): matched from now on, far closer than the rendered model.
    try { if (embedder) refs.push(embedder.embed(data.bitmap).embeddings[0]); } finally { data.bitmap.close(); }
  } else if (data.type === 'frame') {
    const bitmap = data.bitmap;
    try {
      if (!detector) throw new Error('Object detector is not ready');
      const start = performance.now(), W = bitmap.width, H = bitmap.height;
      const boxes = detector.detect(bitmap).detections.flatMap(d => {
        const c = d.categories[0], b = d.boundingBox;
        if (!c || !b || SKIP.has(c.categoryName)) return [];
        return [{ label: c.categoryName, score: c.score, bbox: [clamp(b.originX / W), clamp(b.originY / H), clamp((b.originX + b.width) / W), clamp((b.originY + b.height) / H)] }];
      });
      // Whatever is held: a box around each tracked hand, grown to take in what hangs from it (normalized, from the page).
      for (const bbox of data.held ?? []) boxes.push({ label: 'in hand', score: 0, bbox: bbox.map(clamp) });
      for (const b of boxes) {
        const [left, top, right, bottom] = b.bbox;
        if (right - left < 0.03 || bottom - top < 0.03) { b.sim = 0; continue; }
        const e = embedder.embed(bitmap, { regionOfInterest: { left, top, right, bottom } }).embeddings[0];
        b.sim = Math.max(...refs.map(r => ImageEmbedder.cosineSimilarity(e, r)));
      }
      self.postMessage({ type: 'result', boxes, ms: performance.now() - start });
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
    finally { bitmap.close(); }
  }
};
