import { useEffect, useState } from 'react';
import { sanitizeSpec } from '../ai/actionLibrary';
import type { ActionSpec } from '../ai/types';
import { DemoScene } from './DemoScene';

const mk = (raw: Record<string, unknown>): ActionSpec => sanitizeSpec({ targetObjectId: 'demo', targetPoint2d: { x: 0.3, y: 0.5 }, confidence: 1, stepIndex: 1, stepCount: 1, ...raw })!;

// Preview presets exercise every action in the library without the camera or the AI.
export const PRESETS: { name: string; spec: ActionSpec }[] = [
  { name: 'Open cap', spec: mk({ actionType: 'twist', rotationSense: 'loosen', targetLabel: 'bottle cap', amount: { turns: 1.5 }, caption: 'Twist the cap counterclockwise to open it' }) },
  { name: 'Tighten', spec: mk({ actionType: 'twist', rotationSense: 'tighten', targetLabel: 'knob', amount: { turns: 1 }, caption: 'Turn the knob clockwise' }) },
  { name: 'Press', spec: mk({ actionType: 'press', targetLabel: 'reset button', amount: { depthCm: 0.5, repeat: 2 }, caption: 'Press the reset button twice' }) },
  { name: 'Pull', spec: mk({ actionType: 'pull', targetLabel: 'drawer', amount: { distanceCm: 15 }, caption: 'Pull the drawer toward you' }) },
  { name: 'Push', spec: mk({ actionType: 'push', targetLabel: 'drawer', amount: { distanceCm: 15 }, caption: 'Push the drawer in' }) },
  { name: 'Slide', spec: mk({ actionType: 'slide', targetLabel: 'latch', amount: { distanceCm: 10, direction: 'right' }, caption: 'Slide the latch right' }) },
  { name: 'Lift', spec: mk({ actionType: 'lift', targetLabel: 'lid', amount: { distanceCm: 12 }, caption: 'Lift the lid straight up' }) },
  { name: 'Flip', spec: mk({ actionType: 'flip', targetLabel: 'power switch', caption: 'Flip the switch' }) },
  { name: 'Tilt', spec: mk({ actionType: 'tilt', targetLabel: 'bottle', amount: { angleDeg: 60, direction: 'right' }, caption: 'Tilt the bottle to pour' }) },
  { name: 'Multi-step', spec: mk({ actionType: 'twist', rotationSense: 'loosen', targetLabel: 'bottle cap', stepIndex: 1, stepCount: 3, caption: 'Unscrew the cap' }) },
];

export function DemoPanel({ onShowOnCamera, cameraActive }: { onShowOnCamera?: (spec: ActionSpec | null) => void; cameraActive?: boolean }) {
  const [onCamera, setOnCamera] = useState(false);
  useEffect(() => { if (!cameraActive) setOnCamera(false); }, [cameraActive]);
  const [index, setIndex] = useState(0);
  const [reverse, setReverse] = useState(false);
  const preset = PRESETS[index];
  return <section className="panel demo-panel" aria-label="3D demonstration preview">
    <div className="panel-heading"><span>DEMO PREVIEW</span><span className="cyan">BUILT-IN SHAPES</span></div>
    <div className="stage demo-stage">
      <DemoScene spec={preset.spec} aspect={16 / 9} reverseThread={reverse} />
    </div>
    <div className="demo-presets" role="group" aria-label="Action presets">
      {PRESETS.map((p, i) => <button key={p.name} className={i === index ? '' : 'secondary'} aria-pressed={i === index} onClick={() => { setIndex(i); if (onCamera) onShowOnCamera?.(p.spec); }}>{p.name}</button>)}
    </div>
    <div className="panel-footer"><label><input type="checkbox" checked={reverse} onChange={e => setReverse(e.target.checked)} /> Reverse thread</label>{onShowOnCamera
        ? <button className="secondary" disabled={!cameraActive} onClick={() => { const next = !onCamera; setOnCamera(next); onShowOnCamera(next ? preset.spec : null); }}>{onCamera ? 'Hide on camera' : cameraActive ? 'Show on camera' : 'Enable camera to overlay'}</button>
        : <span>STANDARD THREAD: LOOSEN = COUNTERCLOCKWISE</span>}</div>
  </section>;
}
