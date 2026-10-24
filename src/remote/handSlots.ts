import type { HandFrame } from '../coordinates';

export type Slots = [HandFrame | null, HandFrame | null];
interface Track { x: number; y: number; vx: number; vy: number; at: number }

const wrist = (f: HandFrame) => f.landmarks[0];

/**
 * Keeps each of up to two hands in the same slot from frame to frame. MediaPipe's left/right label swaps, so hands are
 * matched by where each should be now, from where it was and how fast it was moving, which keeps them apart even as they
 * cross. A new hand takes a free slot; a hand that disappears frees its slot after a short grace period, so a flicker does
 * not swap who is who. When both appear at once, the one on the left of the image is slot 0.
 */
export class HandSlots {
  private tracks: (Track | null)[] = [null, null];
  constructor(private readonly graceMs = 600, private readonly maxJump = 0.45) {}

  private predict(t: Track, now: number) {
    const dt = Math.min(now - t.at, 150); // do not coast far
    return { x: t.x + t.vx * dt, y: t.y + t.vy * dt };
  }

  update(frames: HandFrame[], now: number): Slots {
    const hands = frames.filter(f => f.landmarks.length === 21).slice(0, 2);
    this.tracks = this.tracks.map(t => (t && now - t.at > this.graceMs ? null : t));
    const out: Slots = [null, null];
    const free = new Set(hands.map((_, i) => i));

    // Existing slots claim the hand nearest where they expect it, closest pairs first.
    const pairs: [number, number, number][] = [];
    hands.forEach((h, hi) => this.tracks.forEach((t, s) => {
      if (!t) return;
      const p = this.predict(t, now);
      pairs.push([Math.hypot(wrist(h).x - p.x, wrist(h).y - p.y), hi, s]);
    }));
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [d, hi, s] of pairs) if (d <= this.maxJump && free.has(hi) && !out[s]) { out[s] = hands[hi]; free.delete(hi); }

    // Anything left takes a free slot (one nobody used lately first); two new hands: left of the image first.
    for (const hi of [...free].sort((a, b) => wrist(hands[a]).x - wrist(hands[b]).x)) {
      const s = [0, 1].find(k => !out[k] && !this.tracks[k]) ?? [0, 1].find(k => !out[k]);
      if (s !== undefined) { out[s] = hands[hi]; free.delete(hi); this.tracks[s] = null; }
    }
    out.forEach((h, s) => {
      if (!h) return;
      const w = wrist(h), prev = this.tracks[s];
      const dt = prev ? now - prev.at : 0;
      // Velocity, smoothed so one jittery frame does not fling the prediction.
      const vx = prev && dt > 0 ? 0.6 * ((w.x - prev.x) / dt) + 0.4 * prev.vx : 0, vy = prev && dt > 0 ? 0.6 * ((w.y - prev.y) / dt) + 0.4 * prev.vy : 0;
      this.tracks[s] = { x: w.x, y: w.y, vx, vy, at: now };
    });
    return out;
  }

  reset() { this.tracks = [null, null]; }
}
