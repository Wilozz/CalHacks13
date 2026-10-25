import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { convex } from '../convexClient';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PageHeading } from '../components/ui/page-heading';
import { decodeReplay, encodeReplay, MAX_REPLAY_BYTES, type Replay } from './log';
import { ReplayPlayer } from './ReplayPlayer';

const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

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

/** Uploads a lesson as a tutorial (the server validates it in replays.save) and returns its id. */
export async function saveReplay(replay: Replay, name: string): Promise<Id<'replays'>> {
  if (!convex) throw new Error('Saving needs the Convex backend (npm run convex).');
  const body = encodeReplay(replay);
  if (body.length > MAX_REPLAY_BYTES) throw new Error('This recording is too long to save.');
  const res = await fetch(await convex.mutation(api.replays.generateUploadUrl, {}), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
  const { storageId } = await res.json() as { storageId: Id<'_storage'> };
  return await convex.action(api.replays.save, { storageId, name, ownerKey: ownerKey() });
}

function OpenTutorial({ id, onDeleted }: { id: Id<'replays'>; onDeleted: () => void }) {
  const meta = useQuery(api.replays.get, { id, ownerKey: ownerKey() });
  const remove = useMutation(api.replays.remove);
  const rename = useMutation(api.replays.rename);
  const [name, setName] = useState<string | null>(null);
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
    <div className="community-row">{name === null ? <h2>{meta?.name ?? 'Loading…'}</h2>
      : <form className="replay-rename" onSubmit={async e => { e.preventDefault(); await rename({ id, name, ownerKey: ownerKey() }); setName(null); }}><input aria-label="Name" value={name} maxLength={80} autoFocus onChange={e => setName(e.target.value)} /><button type="submit" disabled={!name.trim()}>Save name</button></form>}
      {meta && name === null && <button onClick={() => setName(meta.name)}>Rename</button>}
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
          : !list.length ? <p className="community-empty">Nothing saved yet. On the Throwing screen, when someone throws you an object, everything you show with it until you throw it back is saved here by itself.</p>
          : list.map(r => <button key={r._id} className={`community-card replay-item ${open === r._id ? 'active' : ''}`} aria-pressed={open === r._id} onClick={() => setOpen(r._id)}>
            <b>{r.name}</b><small>{r.label} · {fmt(r.durationMs)} · {new Date(r._creationTime).toLocaleString()}</small>
          </button>)}
      </section>
      <section aria-label="Player">{open ? <OpenTutorial key={open} id={open} onDeleted={() => setOpen(null)} /> : list?.length ? <p className="community-empty">Pick a tutorial to play it.</p> : null}</section>
    </div>
  </main>;
}
