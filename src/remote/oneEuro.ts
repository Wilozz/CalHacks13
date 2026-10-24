/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing when the hand is still (kills jitter), light smoothing
 * when it moves fast (no lag on a flick). Time in seconds.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private readonly minCutoff = 1.2, private readonly beta = 0.4, private readonly dCutoff = 1) {}

  filter(value: number, t: number): number {
    if (this.x === null) { this.x = value; this.t = t; return value; }
    const dt = t - this.t;
    if (dt <= 0) return this.x;
    this.t = t;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.dx += alpha(this.dCutoff) * ((value - this.x) / dt - this.dx);
    this.x += alpha(this.minCutoff + this.beta * Math.abs(this.dx)) * (value - this.x);
    return this.x;
  }

  reset() { this.x = null; this.dx = 0; }
}
