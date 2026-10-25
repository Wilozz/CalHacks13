import { useEffect, useRef, useState } from 'react';
import { useCall } from '../CallPanel';
import { normalizeRoomCode, ROOM_PATTERN } from '../callSignaling';
import { useMobileDevice } from '../device';
import { Icon } from '../icons';
import { decodePoses, decodeToss, encodePoses, encodeToss, TOSS_OBJECTS, type Pose, type Toss, type TossKind } from './toss';
import { TossScene, type TossApi, type TossStatus } from './TossScene';
import { useTracker } from './useTracker';
import { ThrowLesson } from '../replay/lesson';
import { keepSharedReplay, saveReplay } from '../replay/Tutorials';

// Bump when the throwing messages change, so two different builds say so instead of silently showing nothing.
const VERSION = 2, HELLO = JSON.stringify({ type: 'throw-hello', v: VERSION });
// The id of a lesson just saved, so the other person keeps the same recording (with these hands in it).
const lessonId = (text: unknown) => { try { const m = typeof text === 'string' && text.length < 200 && JSON.parse(text); return m?.type === 'lesson' && typeof m.id === 'string' && m.id.length < 64 ? m.id as string : null; } catch { return null; } };
const helloVersion = (text: unknown) => { try { const m = typeof text === 'string' && text.length < 100 && JSON.parse(text); return m?.type === 'throw-hello' ? Number(m.v) || 0 : null; } catch { return null; } };

const article = (label: string) => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}`;

/**
 * Demo screen for "Reach Through": a live call where a hologram can be grabbed (pinch, or drag with a pointer)
 * and flicked through the screen to the other person. Preset objects stand in for a Claude scan.
 */
export default function ThrowPrototype() {
  const mobile = useMobileDevice();
  const cam = useRef<HTMLVideoElement>(null);
  const tracker = useTracker(cam, mobile ? 1 : 2); // a phone is held in one hand; on a computer the second hand resizes
  const call = useCall(() => cam.current?.srcObject instanceof MediaStream ? cam.current.srcObject : null);
  const api = useRef<TossApi | null>(null);
  const [status, setStatus] = useState<TossStatus>({ state: 'none', label: '', hover: false, handSeen: false, labels: [], canToss: false, busy: false });
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [code, setCode] = useState('');
  const [peer, setPeer] = useState<'unknown' | 'ok' | 'missing' | 'other'>('unknown'); // is the friend on this screen, same build?
  const toastTimers = useRef<number[]>([]);
  // Stacked, not replaced: sending and catching at the same moment shows both.
  const show = (text: string) => {
    const id = Math.random();
    setToasts(t => [...t.slice(-2), { id, text }]);
    toastTimers.current.push(window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600));
  };
  // Lessons record themselves, silently: from catching an object someone threw you until you throw it back.
  const lesson = useRef<ThrowLesson | null>(null);
  const control = useRef<RTCDataChannel | null>(null);
  control.current = call.controlChannel;
  if (!lesson.current) lesson.current = new ThrowLesson(r => { saveReplay(r, `${r.label} lesson`).then(id => {
    show('Lesson saved to Tutorials');
    if (control.current?.readyState === 'open') control.current.send(JSON.stringify({ type: 'lesson', id }));
  }, e => console.warn('Lesson not saved:', e)); });
  const caught = (t: Toss) => lesson.current!.caught(t.id, t.label, t.model, tracker.hand.current.aspect, performance.now());
  useEffect(() => () => lesson.current?.end(performance.now()), []);
  const screen = call.status === 'idle' ? 'home' : call.status === 'connected' || call.status === 'disconnected' ? 'incall' : 'calling';
  const tracking = tracker.phase === 'running' || tracker.phase === 'loading';

  useEffect(() => {
    const dc = call.controlChannel;
    if (!dc) return;
    let timer = 0;
    const onMessage = (e: MessageEvent) => {
      const v = helloVersion(e.data);
      if (v !== null) { clearTimeout(timer); setPeer(v === VERSION ? 'ok' : 'other'); return; }
      const shared = lessonId(e.data);
      if (shared) { keepSharedReplay(shared).then(() => show('Your friend’s lesson was saved to Tutorials'), err => console.warn('Lesson not kept:', err)); return; }
      const t = decodeToss(e.data); if (t) { api.current?.receive(t); if (t.give) { show(`Your friend tossed you ${article(t.label)}`); caught(t); } }
    };
    const onOpen = () => {
      dc.send(HELLO); api.current?.announce(); // objects made before the friend joined show up for them too
      timer = window.setTimeout(() => setPeer(p => p === 'ok' ? p : 'missing'), 4000);
    };
    setPeer('unknown');
    dc.addEventListener('message', onMessage); dc.addEventListener('open', onOpen);
    if (dc.readyState === 'open') onOpen();
    return () => { clearTimeout(timer); dc.removeEventListener('message', onMessage); dc.removeEventListener('open', onOpen); };
  }, [call.controlChannel]);
  useEffect(() => {
    const dc = call.handChannel;
    if (!dc) return;
    const onMessage = (e: MessageEvent) => { const p = decodePoses(e.data); if (p) api.current?.poses(p); };
    dc.addEventListener('message', onMessage);
    return () => dc.removeEventListener('message', onMessage);
  }, [call.handChannel]);
  useEffect(() => () => toastTimers.current.forEach(clearTimeout), []);

  function onToss(t: Toss) {
    const dc = call.controlChannel;
    if (t.give) lesson.current!.thrown(t.id, performance.now());
    if (dc?.readyState === 'open') { dc.send(encodeToss(t)); if (t.give) show(`Tossed ${article(t.label)} to your friend`); return; }
    if (!t.give) return;
    // Nobody on the other end: it comes back, so the effect can be tried alone.
    window.setTimeout(() => { api.current?.receive(t); caught(t); show('Nobody caught it, so it came back'); }, 700);
  }
  // Unreliable channel: a lost pose is replaced by the next one 33 ms later.
  const onPoses = (p: Pose[]) => {
    const dc = call.handChannel; if (dc?.readyState === 'open') dc.send(encodePoses(p));
    const h = tracker.hand.current;
    lesson.current!.tick(performance.now(), h.frames.length ? h.frames : h.frame?.landmarks.length === 21 ? [h.frame] : [], h.at, p);
  };
  const friendAspect = () => { const v = call.friendVideo.current; return v?.videoWidth ? v.videoWidth / v.videoHeight : 4 / 3; };
  async function begin(room?: string) {
    if (tracker.phase !== 'running') await tracker.start(); // the call reuses this camera track
    call.start(room);
  }

  const validCode = ROOM_PATTERN.test(normalizeRoomCode(code));
  const hint = status.state === 'none' ? (screen === 'incall' ? 'Pick an object, or wait for your friend to toss one' : 'Pick an object to make a hologram')
    : status.state === 'spawn' ? `Scanning ${status.label.toLowerCase()}…`
    : status.state === 'held' ? (status.handSeen
      ? (mobile ? 'Turn your hand to rotate it. Flick up and let go to throw' : 'Turn your hand to rotate it. Close your other hand on it to resize. Flick up or push to throw')
      : (mobile ? 'Flick up and let go to throw. A second finger on it resizes' : 'Flick up and let go to throw. Scroll to resize'))
    : status.state === 'rest' || status.state === 'drop' ? (status.handSeen ? (status.hover ? 'Pinch or make a fist to grab it' : 'Reach for it with your hand') : 'Drag one, or show your hand and grab it')
    : '';

  // t- prefixes: App's .phone/.mac/.home layout rules must not apply here.
  return <main className={`throw t-${mobile ? 'phone' : 'mac'} t-${screen}`}>
    <video ref={call.friendVideo} className="throw-friend" autoPlay playsInline/>
    {screen === 'incall' && !call.remote && <p className="throw-wait">Waiting for video…</p>}
    <div className={`throw-self ${tracking ? '' : 'off'}`}>
      <video ref={cam} autoPlay playsInline muted/>
      <video ref={call.selfVideo} autoPlay playsInline muted/>
    </div>

    <TossScene api={api} hand={tracker.hand} mirrored bottomInset={mobile ? 190 : 120} onToss={onToss} onPoses={onPoses} friendAspect={friendAspect} onStatus={setStatus}/>

    {screen === 'home' && <section className="throw-card" aria-label="Start a call">
      <h1>Throwing prototype</h1>
      <p>Make one or two objects, grab them with a pinch or a fist, turn and resize them, and throw them through the screen to the person you're calling. You both always see every object: when your friend holds one, it sits in their hand in their video. Alone, they come back to you.</p>
      <div className="throw-actions">
        <button className="primary" onClick={() => void begin()}><Icon name="video" size={20}/>New call</button>
        <form onSubmit={e => { e.preventDefault(); if (validCode) void begin(code); }}>
          <input aria-label="Room code" value={code} onChange={e => setCode(normalizeRoomCode(e.target.value).slice(0, 6))} placeholder="ABC234" maxLength={8} spellCheck={false} autoCapitalize="characters" autoComplete="off"/>
          <button type="submit" disabled={!validCode}>Join</button>
        </form>
      </div>
      {(call.error || tracker.error || call.hint) && <p className={`banner ${call.error || tracker.error ? 'error' : ''}`} role="status">{call.error || tracker.error || call.hint}</p>}
    </section>}
    {screen === 'calling' && <section className="throw-calling" aria-label="Calling">
      <p className="code" data-testid="room-code">{call.room || '······'}</p>
      <p>{call.status === 'waiting' ? 'Waiting for your friend…' : call.status === 'connecting' ? 'Connecting…' : 'Getting camera and microphone ready…'}</p>
      {call.room && <button className="pill-button" onClick={call.share}><Icon name="share" size={16}/>Share code</button>}
    </section>}
    {screen === 'incall' && <div className="call-pill throw-pill" role="status"><b>{call.room}</b><span data-testid="call-state">{call.status === 'connected' ? 'Reach through' : 'Reconnecting…'}</span></div>}
    {screen === 'incall' && (peer === 'missing' || peer === 'other') && <p className="banner error throw-warn" role="alert">
      {peer === 'other' ? 'Your friend is on a different version of GHOST, so objects won’t show up for them. Both of you should reload the page.'
        : 'Your friend isn’t on the Throwing prototype screen, or has an old version, so they can’t see your objects. Ask them to open “Throwing prototype”, reload, and rejoin with your code.'}
    </p>}
    {call.playBlocked && <button className="pill-button throw-play" onClick={call.retryPlay}>Play friend’s audio and video</button>}

    {toasts.length > 0 && <div className="throw-toasts">{toasts.map(t => <p key={t.id} className="throw-toast" role="status">{t.text}</p>)}</div>}
    <div className="throw-bar">
      {hint && <p className="throw-hint" role="status">{hint}</p>}
      <div className="throw-row">
        <div className="throw-chips" role="group" aria-label="Make a hologram">
          {(Object.keys(TOSS_OBJECTS) as TossKind[]).map(k => <button key={k} aria-pressed={status.labels.includes(TOSS_OBJECTS[k].label)} onClick={() => api.current?.spawn(k)}>{TOSS_OBJECTS[k].label}</button>)}
        </div>
        <button className="throw-toss" disabled={!status.canToss} onClick={() => api.current?.flick()}>Toss</button>
        <button className="round" aria-pressed={tracking} aria-label={tracking ? 'Turn off hand tracking' : 'Turn on hand tracking'} onClick={() => tracking ? tracker.stop() : void tracker.start()}><Icon name="hand"/></button>
        {screen !== 'home' && <>
          <button className="round" disabled={!call.local} aria-pressed={call.muted} aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'} onClick={call.toggleMute}><Icon name={call.muted ? 'micOff' : 'mic'}/></button>
          <button className="round end" aria-label="End call" onClick={call.end}><Icon name="end" size={26}/></button>
        </>}
      </div>
      {tracker.phase === 'loading' && <p className="throw-fine">Starting hand tracking…</p>}
    </div>
  </main>;
}
