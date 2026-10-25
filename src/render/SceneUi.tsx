import type { SceneObject } from '../ai/types';

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

export function ScenePanel({ objects, selectedId, onSelect, cameraOn, inCall, scanning, error, auto, onAuto, onScan, onScanFriend, lastMs, saved = [], onOpenSaved }: {
  objects: SceneObject[]; selectedId: string | null; onSelect: (id: string) => void;
  cameraOn: boolean; inCall: boolean; scanning: boolean; error: string; auto: boolean; onAuto: (v: boolean) => void;
  onScan: () => void; onScanFriend: () => void; lastMs: number | null;
  /** objects saved for the demo: open one without scanning */
  saved?: { key: string; label: string }[]; onOpenSaved?: (key: string) => void;
}) {
  return <section className="panel scene-panel" aria-label="AI scene understanding">
    <div className="panel-heading"><span>OBJECT → 3D COPY</span><span className="cyan">{lastMs ? `LAST SCAN ${(lastMs / 1000).toFixed(1)}s` : 'CLAUDE VISION'}</span></div>
    <div className="scene-body">
      <div className="scene-row">
        <button disabled={!cameraOn || scanning} onClick={onScan}>{scanning ? 'Scanning…' : 'Scan my camera'}</button>
        {inCall && <button className="secondary" disabled={scanning} onClick={onScanFriend}>Scan my friend's view</button>}
        <label><input type="checkbox" checked={auto} disabled={!cameraOn} onChange={e => onAuto(e.target.checked)} /> Re-scan my camera every 6 s</label>
      </div>
      {!cameraOn && !inCall && <p className="scene-hint">Turn on the camera, point it at a bottle, button, knob or drawer, then scan.</p>}
      {!!saved.length && <div className="scene-row" role="group" aria-label="Saved for the demo">
        <span className="scene-hint">Saved for the demo:</span>
        {saved.map(s => <button key={s.key} className="secondary" onClick={() => onOpenSaved?.(s.key)}>★ {s.label}</button>)}
      </div>}
      {error && <p className="scene-error-text" role="alert">{error}</p>}
      {!objects.length && !error && !scanning && (cameraOn || inCall) && <p className="scene-hint">Nothing scanned yet. Pick an object after scanning and a small 3D copy appears in the corner, with the helper's hand on it.</p>}
      {!!objects.length && <>
        <p className="scene-hint">Choose the object to show. {inCall ? '' : 'You can also point at it with your index finger and hold for a moment.'}</p>
        <div className="scene-row" role="group" aria-label="Detected objects">
          {objects.map(o => <button key={o.objectId} className={o.objectId === selectedId ? '' : 'secondary'} aria-pressed={o.objectId === selectedId} onClick={() => onSelect(o.objectId)}>{o.label}{o.model ? '' : ' (basic shape)'}</button>)}
        </div>
      </>}
    </div>
  </section>;
}
