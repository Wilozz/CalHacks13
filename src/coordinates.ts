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
  return points.map(p => ({
    x: anchorX + direction * (p.x - wrist.x) * scale,
    y: anchorY - (p.y - wrist.y) * scale,
    z: -(p.z - wrist.z) * scale,
  }));
}
