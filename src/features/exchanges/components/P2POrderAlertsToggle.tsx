import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useExchangeCredentials } from '../hooks/useExchangeCredentials';
import { useP2POrderWatch, useSetP2POrderWatch } from '../hooks/useP2POrderAlerts';
import { p2pWatchHealth } from '../p2p-order-alerts';

/** Compact switch on the Orders page for the 20-second Binance P2P order alert. */
export function P2POrderAlertsToggle() {
  const t = useT();
  const { data: creds } = useExchangeCredentials();
  const { data: watch } = useP2POrderWatch();
  const setWatch = useSetP2POrderWatch();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const hasBinance = (creds ?? []).some((c) => c.exchange === 'binance');
  if (!hasBinance && !watch?.enabled) return null;

  const health = p2pWatchHealth(watch, now);
  const status =
    health === 'ok' ? t('p2pWatchOk')
    : health === 'starting' ? t('p2pWatchStarting')
    : health === 'error' ? `${t('p2pWatchError')}: ${watch?.last_error ?? ''}`
    : health === 'stale' ? t('p2pWatchStale')
    : t('p2pWatchOff');

  const onChange = (enabled: boolean) => {
    setWatch.mutate(enabled, {
      onSuccess: (result) => {
        if (!enabled) return;
        if (result && result.ok === false) toast.error(`${t('p2pWatchError')}: ${result.error ?? ''}`);
        else toast.success(t('p2pWatchEnabled'));
      },
      onError: (err: any) => toast.error(err?.message ?? String(err)),
    });
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <BellRing className={cn('h-4 w-4 shrink-0', watch?.enabled ? 'text-primary' : 'text-muted-foreground')} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t('p2pWatchLabel')}</div>
        <div
          className={cn(
            'truncate text-xs',
            health === 'error' || health === 'stale' ? 'text-destructive' : 'text-muted-foreground',
          )}
          title={status}
        >
          {status}
        </div>
      </div>
      <Switch
        checked={Boolean(watch?.enabled)}
        disabled={setWatch.isPending || (!hasBinance && !watch?.enabled)}
        onCheckedChange={onChange}
        aria-label={t('p2pWatchLabel')}
      />
    </div>
  );
}
