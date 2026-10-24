import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ThrowPrototype from './throw/ThrowPrototype';
import './style.css';

// Two screens; switching unmounts the other one, which ends its call and releases its camera.
function Root() {
  const [tab, setTab] = useState<'call' | 'throw'>(() => location.hash === '#throw' ? 'throw' : 'call');
  useEffect(() => { history.replaceState(null, '', tab === 'throw' ? '#throw' : location.pathname + location.search); }, [tab]);
  return <>
    {tab === 'call' ? <App/> : <ThrowPrototype/>}
    <nav className="tabs" aria-label="Screens">
      <button aria-pressed={tab === 'call'} onClick={() => setTab('call')}>Call</button>
      <button aria-pressed={tab === 'throw'} onClick={() => setTab('throw')}>Throwing prototype</button>
    </nav>
  </>;
}
createRoot(document.getElementById('root')!).render(<Root/>);
