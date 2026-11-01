import { useEffect, useState } from 'react';

const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** Keep calendar windows current even when an open dashboard receives no new data. */
export function useDashboardNow(): number {
  const [now, setNow] = useState(currentMinute);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      setNow(currentMinute());
      timer = setTimeout(refresh, 60_000 - Date.now() % 60_000 + 1);
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return now;
}
