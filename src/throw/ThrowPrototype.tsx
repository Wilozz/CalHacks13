import { useEffect, useRef, useState } from 'react';
import { useCall } from '../CallPanel';
import { normalizeRoomCode, ROOM_PATTERN } from '../callSignaling';
import { useMobileDevice } from '../device';
import { Icon } from '../icons';
import { decodeToss, encodeToss, TOSS_OBJECTS, type Toss, type TossKind } from './toss';
import { TossScene, type TossApi, type TossStatus } from './TossScene';
import { useTracker } from './useTracker';

const article = (label: string) => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}`;

/**
 * Demo screen for "Reach Through": a live call where a hologram can be grabbed (pinch, or drag with a pointer)
 * and flicked through the screen to the other person. Preset objects stand in for a Claude scan.
 */
export default function ThrowPrototype() {
  const mobile = useMobileDevice();
  const cam = useRef<HTMLVideoElement>(null);
  const tracker = useTracker(cam);
  const call = useCall(() => cam.current?.srcObject instanceof MediaStream ? cam.current.srcObject : null);
  const api = useRef<TossApi | null>(null);
  const [status, setStatus] = useState<TossStatus>({ state: 'none', label: '', hover: false, handSeen: false });
  const [toast, setToast] = useState('');
  const [code, setCode] = useState('');
  const toastTimer = useRef(0);
  const show = (text: string) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 2600); };
  const screen = call.status === 'idle' ? 'home' : call.status === 'connected' || call.status === 'disconnected' ? 'incall' : 'calling';
  const tracking = tracker.phase === 'running' || tracker.phase === 'loading';

  useEffect(() => {
    const dc = call.controlChannel;
    if (!dc) return;
    const onMessage = (e: MessageEvent) => { const t = decodeToss(e.data); if (t) { api.current?.receive(t); show(`Your friend tossed you ${article(t.label)}`); } };
    dc.addEventListener('message', onMessage);
    return () => dc.removeEventListener('message', onMessage);
  }, [call.controlChannel]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function onToss(t: Toss) {
    const dc = call.controlChannel;
    if (dc?.readyState === 'open') { dc.send(encodeToss(t)); show(`Tossed ${article(t.label)} to your friend`); return; }
    // Nobody on the other end: it comes back, so the effect can be tried alone.
    window.setTimeout(() => { api.current?.receive(t); show('Nobody caught it, so it came back'); }, 700);
  }
  async function begin(room?: string) {
    if (tracker.phase !== 'running') await tracker.start(); // the call reuses this camera track
    call.start(room);
  }

  const validCode = ROOM_PATTERN.test(normalizeRoomCode(code));
  const hint = status.state === 'none' ? (screen === 'incall' ? 'Pick an object, or wait for your friend to toss one' : 'Pick an object to make a hologram')
    : status.state === 'spawn' ? `Scanning ${status.label.toLowerCase()}…`
    : status.state === 'rest' ? (status.handSeen ? (status.hover ? 'Pinch or make a fist to grab it' : 'Reach for it with your hand') : 'Drag it, or show your hand and grab it')
    : status.state === 'held' ? 'Flick it, or push toward the screen, and let go'
    : status.state === 'drop' ? 'Grab it again' : '';

  // t- prefixes: App's .phone/.mac/.home layout rules must not apply here.
  return <main className={`throw t-${mobile ? 'phone' : 'mac'} t-${screen}`}>
    <video ref={call.friendVideo} className="throw-friend" autoPlay playsInline/>
    {screen === 'incall' && !call.remote && <p className="throw-wait">Waiting for video…</p>}
    <div className={`throw-self ${tracking ? '' : 'off'}`}>
      <video ref={cam} autoPlay playsInline muted/>
      <video ref={call.selfVideo} autoPlay playsInline muted/>
    </div>

    <TossScene api={api} hand={tracker.hand} mirrored bottomInset={mobile ? 190 : 120} onToss={onToss} onStatus={setStatus}/>

    {screen === 'home' && <section className="throw-card" aria-label="Start a call">
      <h1>Throwing prototype</h1>
      <p>Make an object, grab it with a pinch or a fist, and flick it through the screen to the person you're calling. Alone, it comes back to you.</p>
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
    {call.playBlocked && <button className="pill-button throw-play" onClick={call.retryPlay}>Play friend’s audio and video</button>}

    {toast && <p className="throw-toast" role="status">{toast}</p>}
    <div className="throw-bar">
      {hint && <p className="throw-hint" role="status">{hint}</p>}
      <div className="throw-row">
        <div className="throw-chips" role="group" aria-label="Make a hologram">
          {(Object.keys(TOSS_OBJECTS) as TossKind[]).map(k => <button key={k} disabled={status.state === 'out' || status.state === 'in'} aria-pressed={status.label === TOSS_OBJECTS[k].label} onClick={() => api.current?.spawn(k)}>{TOSS_OBJECTS[k].label}</button>)}
        </div>
        <button className="throw-toss" disabled={status.state !== 'rest'} onClick={() => api.current?.flick()}>Toss</button>
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
