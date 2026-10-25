import type { SceneObject } from '../ai/types';
import { Icon } from '../icons';
import type { Heard } from './agent';
import type { FocusDecision } from './referent';
import type { Engine, VoiceState } from './useVoice';

const WHY: Record<FocusDecision['source'], string> = { point: 'you are pointing at it', voice: 'you mentioned it', both: 'you said it and are pointing at it', memory: 'last thing in focus', none: '' };

interface Props {
  state: VoiceState; engine: Engine; partial: string; error: string; heard: Heard | null;
  objects: SceneObject[]; focus: FocusDecision | null; topic: string;
  onToggle: () => void; onChoose: (id: string) => void; onAccept: () => void; onDecline: () => void;
}

/** Voice is the center of Handoff: it shows that it is listening, what it heard, what it has spotted, and what it thinks you mean. */
export function VoiceBar({ state, engine, partial, error, heard, objects, focus, topic, onToggle, onChoose, onAccept, onDecline }: Props) {
  const on = state === 'listening', busy = state === 'starting';
  const focusObj = objects.find(o => o.objectId === focus?.objectId) ?? null;
  return <>
    <section className="voice-bar" aria-label="Voice assistant">
      <div className="voice-row">
        <button className={`voice-mic ${on ? 'on' : ''}`} aria-pressed={on} aria-label={on ? 'Stop listening' : 'Let Handoff listen'} disabled={busy} onClick={onToggle}>
          <Icon name={on ? 'mic' : 'micOff'} size={20} />{on && <i className="voice-pulse" />}
        </button>
        <div className="voice-caption" aria-live="polite">
          {partial ? <span className="voice-partial">{partial}</span>
            : heard ? <span><b>{heard.speaker === 'me' ? 'You' : 'Friend'}:</b> {heard.text}</span>
            : <span className="voice-idle">{busy ? 'Starting the microphone…' : on ? 'Listening. Talk about what you are looking at.' : 'Handoff can listen to the conversation and follow what you point at.'}</span>}
        </div>
      </div>
      {!!objects.length && <div className="voice-objects" role="group" aria-label="Objects spotted">
        <span className="voice-key">SPOTTED</span>
        {objects.map(o => <button key={o.objectId} className={`voice-chip ${o.objectId === focus?.objectId ? 'focus' : ''}`} aria-pressed={o.objectId === focus?.objectId} onClick={() => onChoose(o.objectId)}>{o.label}</button>)}
      </div>}
      {focusObj && focus && <div className="voice-focus">Showing <b>{focusObj.label}</b><span> · {WHY[focus.source]}</span></div>}
      {topic && on && <div className="voice-topic">{topic}</div>}
      {error && <div className="voice-error" role="alert">{error}</div>}
      {on && engine === 'browser' && <div className="voice-note">Using the browser's speech recognition (add CARTESIA_API_KEY to use Cartesia).</div>}
    </section>
    {state === 'asking' && <div className="consent-backdrop" onClick={e => { if (e.target === e.currentTarget) onDecline(); }}>
      <div className="consent" role="dialog" aria-label="Let Handoff listen?" aria-modal="true" onKeyDown={e => { if (e.key === 'Escape') onDecline(); }}>
        <h2>Let Handoff listen?</h2>
        <p>Handoff listens to your microphone for the whole session so it can follow what you and your friend are talking about and know which object you mean.</p>
        <ul>
          <li>Your voice is sent to the speech service (Cartesia) to be turned into text. If that is not set up, your browser's own recognizer is used instead, and Chrome sends that audio to Google.</li>
          <li>The text is sent to Claude to work out which object you are talking about.</li>
          <li>In a call, your friend sees the text of what you say, not your audio.</li>
          <li>Nothing is recorded or kept. It stops when you close the page or tap the mic.</li>
        </ul>
        <p className="consent-fine">Make sure everyone on the call knows Handoff is listening. In some places that is required.</p>
        <div className="consent-actions"><button className="pill-button" onClick={onDecline}>Not now</button><button className="primary" onClick={onAccept} autoFocus>Start listening</button></div>
      </div>
    </div>}
  </>;
}
