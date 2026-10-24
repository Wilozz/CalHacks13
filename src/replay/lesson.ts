import type { HandFrame } from '../coordinates';
import type { ModelSpec } from '../ai/types';
import { Recorder, type ObjPose, type Replay } from './log';

export const MIN_LESSON_MS = 2000;

/**
 * A lesson is the time you have an object someone threw you: catching it starts the recording, throwing that same
 * object back ends it. Silent on purpose: nothing on screen says it is recording. Too short (a catch and an instant
 * throw back) is not a lesson.
 */
export class ThrowLesson {
  private cur: { id: string; rec: Recorder } | null = null;
  private lastAt = -1;
  constructor(private readonly onLesson: (r: Replay) => void) {}
  get recording() { return this.cur?.id ?? null; }
  /** An object was thrown to you. One lesson at a time: catching a second object while recording is part of the first. */
  caught(id: string, label: string, model: ModelSpec, aspect: number, now: number) {
    if (this.cur) return;
    this.cur = { id, rec: new Recorder(now, { label, model, aspect }) }; this.lastAt = -1;
  }
  /** Every pose tick (~30 Hz): your hands (at = when the tracker produced them) and where your objects are. */
  tick(now: number, hands: HandFrame[], at: number, poses: ({ id: string } & ObjPose)[]) {
    const c = this.cur; if (!c) return;
    const fresh = hands.length > 0 && now - at < 350;
    const update = fresh ? (at !== this.lastAt ? hands : undefined) : [];
    if (fresh) this.lastAt = at;
    c.rec.frame(now, update, poses.find(p => p.id === c.id) ?? null);
    if (c.rec.full) this.end(now);
  }
  /** You threw an object: if it is the one you caught, the lesson is over. */
  thrown(id: string, now: number) { if (this.cur?.id === id) this.end(now); }
  /** The call or screen is closing: keep what was recorded. */
  end(now: number) {
    const c = this.cur; if (!c) return;
    this.cur = null;
    const r = c.rec.finish(now);
    if (r.durationMs >= MIN_LESSON_MS) this.onLesson(r);
  }
}
