import { useEffect, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PageHeading } from '../components/ui/page-heading';
import { decodeReplay, encodeReplay, MAX_REPLAY_BYTES, type Replay } from './log';
import { ReplayPlayer } from './ReplayPlayer';

export const hasConvex = !!import.meta.env.VITE_CONVEX_URL;
const fmt = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

let memoryKey = '';
/** Tutorials belong to this browser: a random key kept in localStorage (see convex/replays.ts). */
export function ownerKey(): string {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  try {
    let k = localStorage.getItem('ghost.ownerKey');
    if (!k || !/^[a-f0-9]{32}$/.test(k)) { k = make(); localStorage.setItem('ghost.ownerKey', k); }
    return k;
  } catch { return memoryKey ||= make(); }
}

function SaveForm({ replay, onDone }: { replay: Replay; onDone: () => void }) {
  const uploadUrl = useMutation(api.replays.generateUploadUrl);
  const save = useAction(api.replays.save);
  const [name, setName] = useState(`${replay.twin.label} tutorial`);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  async function submit() {
    setState('saving'); setError('');
    try {
      const body = encodeReplay(replay);
      if (body.length > MAX_REPLAY_BYTES) throw new Error('This recording is too long to save.');
      const res = await fetch(await uploadUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
      const { storageId } = await res.json() as { storageId: Id<'_storage'> };
      await save({ storageId, name, ownerKey: ownerKey() });
      setState('saved');
    } catch (e) { setState('idle'); setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
  }
  if (state === 'saved') return <div className="replay-actions"><p role="status">Saved as “{name.trim() || `${replay.twin.label} tutorial`}”. Open it any time from Tutorials.</p><button className="primary" onClick={onDone}>Done</button></div>;
  return <form className="replay-actions" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <label>Name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} autoFocus /></label>
    {error && <p className="community-error" role="alert">{error}</p>}
    <div className="community-actions"><button type="submit" className="primary" disabled={state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save tutorial'}</button><button type="button" onClick={onDone} disabled={state === 'saving'}>Discard</button></div>
  </form>;
}

/** Shown when a recording stops: watch it straight away, then name and save it, or throw it away. */
export function TakeDialog({ replay, onClose }: { replay: Replay; onClose: () => void }) {
  return <div className="community-modal replay-modal"><section role="dialog" aria-modal="true" aria-label="Your recording">
    <div className="community-row"><h2>Your recording</h2><span className="replay-meta">{replay.twin.label} · {fmt(replay.durationMs)}</span></div>
    <ReplayPlayer replay={replay} />
    {hasConvex ? <SaveForm replay={replay} onDone={onClose} />
      : <div className="replay-actions"><p>Saving needs the Convex backend (<code>npm run convex</code>). You can watch it here until you close this.</p><button onClick={onClose}>Close</button></div>}
  </section></div>;
}

function OpenTutorial({ id, onDeleted }: { id: Id<'replays'>; onDeleted: () => void }) {
  const meta = useQuery(api.replays.get, { id, ownerKey: ownerKey() });
  const remove = useMutation(api.replays.remove);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const url = meta?.url;
  useEffect(() => {
    setReplay(null); setError(''); setConfirm(false);
    if (!url) return;
    let live = true;
    fetch(url).then(r => r.text()).then(text => { if (!live) return; const r = decodeReplay(text); if (r) setReplay(r); else setError('This tutorial could not be read.'); })
      .catch(() => { if (live) setError('Could not download this tutorial. Check your connection.'); });
    return () => { live = false; };
  }, [url]);
  if (meta === null) return <p className="community-empty">This tutorial no longer exists.</p>;
  return <div className="community-card replay-open">
    <div className="community-row"><h2>{meta?.name ?? 'Loading…'}</h2>
      <button onClick={async () => { if (!confirm) { setConfirm(true); return; } await remove({ id, ownerKey: ownerKey() }); onDeleted(); }}>{confirm ? 'Tap again to delete' : 'Delete'}</button></div>
    {error ? <p className="community-error" role="alert">{error}</p> : replay ? <ReplayPlayer replay={replay} /> : <p className="community-empty">Loading the recording…</p>}
  </div>;
}

/** Saved tutorials, newest first. The list is a live Convex query, so a new save shows up here at once. */
export function Tutorials() {
  const list = useQuery(api.replays.list, { ownerKey: ownerKey() });
  const [open, setOpen] = useState<Id<'replays'> | null>(null);
  return <main className="community-page">
    <PageHeading eyebrow="WATCH IT AGAIN" title="Tutorials" description="Saved 3D recordings of the object and the hands that showed you how. No video is ever kept." />
    <div className="community-grid">
      <section aria-label="Saved tutorials">
        {list === undefined ? <p className="community-empty">Loading…</p>
          : !list.length ? <p className="community-empty">Nothing saved yet. In a call, open the 3D copy of an object and press ● to record. When you stop, you can watch it and save it with a name.</p>
          : list.map(r => <button key={r._id} className={`community-card replay-item ${open === r._id ? 'active' : ''}`} aria-pressed={open === r._id} onClick={() => setOpen(r._id)}>
            <b>{r.name}</b><small>{r.label} · {fmt(r.durationMs)} · {new Date(r._creationTime).toLocaleString()}</small>
          </button>)}
      </section>
      <section aria-label="Player">{open ? <OpenTutorial key={open} id={open} onDeleted={() => setOpen(null)} /> : list?.length ? <p className="community-empty">Pick a tutorial to play it.</p> : null}</section>
    </div>
  </main>;
}
