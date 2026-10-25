import type { HandFrame } from '../coordinates';
import type { ModelSpec } from '../ai/types';
import type { TwinPose } from '../remote/twinWire';
import { Recorder, type ObjPose, type Replay } from './log';

export const MIN_LESSON_MS = 2000;

/**
 * A lesson is the time a 3D copy is up in a call: it starts when the copy comes up, and ends when it is closed (or
 * another one replaces it) or the call ends. Both people's hands and the copy's pose, whoever moved it. Silent on
 * purpose: nothing on screen says it is recording. Too short (opened and closed at once) is not a lesson.
 */
export class CallLesson {
  private cur: { id: string; rec: Recorder } | null = null;
  private lastAt = -1;
  constructor(private readonly onLesson: (r: Replay) => void) {}
  get recording() { return this.cur?.id ?? null; }
  /** A copy came up. A different one ends the lesson so far and starts a new one; the same one carries on. */
  start(id: string, label: string, model: ModelSpec, aspect: number, now: number, twin?: Replay['twin']) {
    if (this.cur?.id === id) return;
    this.end(now);
    this.cur = { id, rec: new Recorder(now, { label, model, aspect, twin }) }; this.lastAt = -1;
  }
  /** Every pose tick (~30 Hz): your hands (at = when the tracker produced them), where your objects are, and the 3D copy's pose. */
  tick(now: number, hands: HandFrame[], at: number, poses: ({ id: string } & ObjPose)[], twinPose?: TwinPose | null) {
    const c = this.cur; if (!c) return;
    const fresh = hands.length > 0 && now - at < 350;
    const update = fresh ? (at !== this.lastAt ? hands : undefined) : [];
    if (fresh) this.lastAt = at;
    c.rec.frame(now, update, poses.find(p => p.id === c.id) ?? null, twinPose);
    if (c.rec.full) this.end(now);
  }
  /** The friend's hands, as they arrive. */
  peer(now: number, hands: HandFrame[]) { const c = this.cur; if (c) { c.rec.peer(now, hands); if (c.rec.full) this.end(now); } }
  /** The 3D copy moved (either screen's pose, ~15 Hz): kept even between hand-tracker frames. */
  posed(now: number, twinPose: TwinPose) { const c = this.cur; if (c) { c.rec.frame(now, undefined, null, twinPose); if (c.rec.full) this.end(now); } }
  /** The copy was closed, or the call or screen is closing: keep what was recorded. */
  end(now: number) {
    const c = this.cur; if (!c) return;
    this.cur = null;
    const r = c.rec.finish(now);
    if (r.durationMs >= MIN_LESSON_MS) this.onLesson(r);
  }
}
