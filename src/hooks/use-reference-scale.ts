import { useEffect, useState } from 'react';

/** Keep the prototype's composition intact on phones, including its parallel sidebar. */
export function useReferenceScale(referenceWidth = 853) {
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? referenceWidth : window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, []);
  return Math.min(1, width / referenceWidth);
}
