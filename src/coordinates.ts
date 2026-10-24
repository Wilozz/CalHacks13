export interface Point { x: number; y: number; z: number }
// Serializable boundary: transport this data rather than renderer objects.
export interface HandFrame {
  timestamp: number;
  landmarks: Point[];
  worldLandmarks: Point[];
  handedness: string;
  inferenceMs: number;
}
export const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]] as const;
export function transformHand(frame: HandFrame, aspect: number, mirrored = true): Point[] {
  const image = frame.landmarks;
  if (image.length !== 21) return [];
  const world = frame.worldLandmarks.length === 21;
  const points = world ? frame.worldLandmarks : image;
  const wrist = points[0];
  // Fixed scale preserves estimated metric proportions; no per-frame bone normalization.
  const scale = world ? 12 : 5;
  const direction = mirrored ? -1 : 1;
  const anchorX = direction * (image[0].x - 0.5) * 4 * aspect || 0;
  const anchorY = (0.5 - image[0].y) * 4 - 0.1;
  const anchorZ = cameraDepth(frame, aspect);
  return points.map(p => ({
    x: anchorX + direction * (p.x - wrist.x) * scale,
    y: anchorY - (p.y - wrist.y) * scale,
    z: anchorZ - (p.z - wrist.z) * scale,
  }));
}
// Palm bones: apparent image size vs. true metric size gives distance to camera.
const PALM = [[0,5],[0,9],[0,17],[5,17]] as const;
// shortcut: reference ~0.5 m on a typical ~45° webcam, uncalibrated; add per-camera calibration if absolute distance matters.
const REFERENCE_HEIGHTS_PER_METRE = 2.4, DEPTH_GAIN = 3, DEPTH_LIMIT = 4;
// Positive = closer to the camera. Dividing by the world bone's XY projection cancels palm tilt.
export function cameraDepth(frame: HandFrame, aspect: number): number {
  const image = frame.landmarks, world = frame.worldLandmarks;
  if (image.length !== 21 || world.length !== 21) return 0;
  let imageLen = 0, worldLen = 0;
  for (const [a, b] of PALM) {
    imageLen += Math.hypot((image[b].x - image[a].x) * aspect, image[b].y - image[a].y);
    worldLen += Math.hypot(world[b].x - world[a].x, world[b].y - world[a].y);
  }
  const z = Math.log(imageLen / worldLen / REFERENCE_HEIGHTS_PER_METRE) * DEPTH_GAIN;
  return Number.isFinite(z) ? Math.max(-DEPTH_LIMIT, Math.min(DEPTH_LIMIT, z)) : 0;
}
