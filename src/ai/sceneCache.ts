import type { Candidate, Point2d, SceneObject } from './types';

/** Cache of scene objects (about 1 fps analysis). Always-fresh "what is under the fingertip" lookup. */
export class SceneCache {
  private objects = new Map<string, SceneObject>();
  constructor(private readonly maxAgeSec = 6) {}

  update(objects: SceneObject[], now: number) {
    for (const o of objects) this.objects.set(o.objectId, o);
    for (const [id, o] of this.objects) if (now - o.seenAt > this.maxAgeSec) this.objects.delete(id);
  }

  clear() { this.objects.clear(); }
  all(): SceneObject[] { return [...this.objects.values()]; }
  get(id: string) { return this.objects.get(id) ?? null; }
  /** Age of the freshest object, for the "age of cache at use" latency metric. */
  ageSec(now: number): number | null {
    let newest = -Infinity;
    for (const o of this.objects.values()) newest = Math.max(newest, o.seenAt);
    return Number.isFinite(newest) ? now - newest : null;
  }

  /** Objects whose bbox contains or is near the point, smallest (most specific) first. */
  candidatesAt(p: Point2d | null, radius = 0.08, limit = 4): Candidate[] {
    if (!p) return [];
    return this.all().flatMap(object => {
      const [x0, y0, x1, y1] = object.bbox;
      const dx = Math.max(x0 - p.x, 0, p.x - x1);
      const dy = Math.max(y0 - p.y, 0, p.y - y1);
      const distance = Math.hypot(dx, dy);
      return distance <= radius ? [{ object, distance, inside: distance === 0 }] : [];
    }).sort((a, b) =>
      Number(b.inside) - Number(a.inside) || a.distance - b.distance ||
      area(a.object) - area(b.object)).slice(0, limit);
  }
}
const area = (o: SceneObject) => (o.bbox[2] - o.bbox[0]) * (o.bbox[3] - o.bbox[1]);
