import { useEffect, useState } from 'react';
// Include touch tablets and landscape phones, not only narrow viewports.
export function useMobileDevice() {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 800px), (pointer: coarse)').matches);
  useEffect(() => {
    const query = matchMedia('(max-width: 800px), (pointer: coarse)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}
