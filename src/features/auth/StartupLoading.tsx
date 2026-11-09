import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useT } from '@/lib/i18n';

/** Keep protected routes closed while offering recovery from stalled startup. */
export function StartupLoading() {
  const t = useT();
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDelayed(true), 12000);
    return () => clearTimeout(timer);
  }, []);
  return <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
    <div className="flex max-w-sm flex-col items-center gap-4 text-center" role="status" aria-live="polite">
      <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm text-foreground">{t(delayed ? 'startupDelayed' : 'loading')}</p>
      {delayed && <><p className="text-xs text-muted-foreground">{t('startupRetryHint')}</p><button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground" onClick={() => window.location.reload()}><RefreshCw size={16} />{t('startupRetry')}</button></>}
    </div>
  </div>;
}
