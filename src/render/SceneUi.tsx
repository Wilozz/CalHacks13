import type { ActionType, SceneObject } from '../ai/types';
import { ACTION_TYPES } from '../ai/actionLibrary';

/** Boxes over the camera view for what the AI saw. Click one, or point at it for about a second. */
export function SceneOverlay({ objects, selectedId, hoverId, aspect, mirrored, onSelect }:
  { objects: SceneObject[]; selectedId: string | null; hoverId: string | null; aspect: number; mirrored: boolean; onSelect: (id: string) => void }) {
  return <div className="demo-overlay scene-overlay">
    <div className="demo-frame" style={{ aspectRatio: String(aspect) }}>
      {objects.map(o => {
        const [x0, y0, x1, y1] = o.bbox;
        const left = mirrored ? 1 - x1 : x0;
        return <button key={o.objectId} aria-pressed={o.objectId === selectedId}
          className={`scene-box ${o.objectId === selectedId ? 'selected' : ''} ${o.objectId === hoverId ? 'hover' : ''}`}
          style={{ left: `${left * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
          onClick={() => onSelect(o.objectId)}><span>{o.label}</span></button>;
      })}
    </div>
  </div>;
}

export function ScenePanel({ objects, selectedId, onSelect, action, onAction, mode, onMode, onRecenter, cameraOn, scanning, error, auto, onAuto, onScan, lastMs }: {
  objects: SceneObject[]; selectedId: string | null; onSelect: (id: string) => void;
  action: ActionType | null; onAction: (a: ActionType) => void;
  mode: 'live' | 'demo'; onMode: (m: 'live' | 'demo') => void; onRecenter: () => void;
  cameraOn: boolean; scanning: boolean; error: string; auto: boolean; onAuto: (v: boolean) => void; onScan: () => void; lastMs: number | null;
}) {
  const selected = objects.find(o => o.objectId === selectedId) ?? null;
  const actions = selected ? (selected.affordances.length ? selected.affordances : [...ACTION_TYPES]) : [];
  return <section className="panel scene-panel" aria-label="AI scene understanding">
    <div className="panel-heading"><span>AI SCENE → 3D TWIN</span><span className="cyan">{lastMs ? `LAST SCAN ${(lastMs / 1000).toFixed(1)}s` : 'CLAUDE VISION'}</span></div>
    <div className="scene-body">
      <div className="scene-row">
        <button disabled={!cameraOn || scanning} onClick={onScan}>{scanning ? 'Scanning…' : 'Scan what the camera sees'}</button>
        <label><input type="checkbox" checked={auto} disabled={!cameraOn} onChange={e => onAuto(e.target.checked)} /> Re-scan every 6 s</label>
      </div>
      {!cameraOn && <p className="scene-hint">Enable the camera, point it at a bottle, button, knob or drawer, then scan.</p>}
      {error && <p className="scene-error-text" role="alert">{error}</p>}
      {cameraOn && !objects.length && !error && !scanning && <p className="scene-hint">Nothing scanned yet. Each object found becomes a 3D twin you can control with your hand.</p>}
      {!!objects.length && <>
        <p className="scene-hint">Click an object, or point at it with your index finger and hold for a moment.</p>
        <div className="scene-row" role="group" aria-label="Detected objects">
          {objects.map(o => <button key={o.objectId} className={o.objectId === selectedId ? '' : 'secondary'} aria-pressed={o.objectId === selectedId} onClick={() => onSelect(o.objectId)}>{o.label}{o.model ? '' : ' (basic shape)'}</button>)}
        </div>
      </>}
      {selected && <>
        <div className="scene-row" role="group" aria-label="Action">
          <span className="scene-key">ACTION</span>
          {actions.map(a => <button key={a} className={a === action ? '' : 'secondary'} aria-pressed={a === action} onClick={() => onAction(a)}>{a}</button>)}
        </div>
        <div className="scene-row" role="group" aria-label="Control mode">
          <span className="scene-key">TWIN</span>
          <button className={mode === 'live' ? '' : 'secondary'} aria-pressed={mode === 'live'} onClick={() => onMode('live')}>Follows my hand</button>
          <button className={mode === 'demo' ? '' : 'secondary'} aria-pressed={mode === 'demo'} onClick={() => onMode('demo')}>Play demo</button>
          {mode === 'live' && <button className="secondary" onClick={onRecenter}>Recenter</button>}
        </div>
      </>}
    </div>
  </section>;
}
