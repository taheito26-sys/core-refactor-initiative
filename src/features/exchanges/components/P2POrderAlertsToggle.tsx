import { useEffect, useRef, useState } from 'react';
import { BellRing, Music, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useExchangeCredentials } from '../hooks/useExchangeCredentials';
import { useP2POrderWatch, useSetP2POrderWatch } from '../hooks/useP2POrderAlerts';
import { p2pWatchHealth } from '../p2p-order-alerts';
import { clearAlarmSound, loadAlarmSound, MAX_ALARM_SOUND_BYTES, saveAlarmSound } from '../p2p-alarm-sound';
import { useAlarm } from './P2POrderAlertOverlay';

/** Compact switch on the Orders page for the 20-second Binance P2P order alert. */
export function P2POrderAlertsToggle() {
  const t = useT();
  const { data: creds } = useExchangeCredentials();
  const { data: watch } = useP2POrderWatch();
  const setWatch = useSetP2POrderWatch();
  const [now, setNow] = useState(() => Date.now());
  const [soundName, setSoundName] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useAlarm(testing);

  useEffect(() => {
    void loadAlarmSound().then((sound) => setSoundName(sound?.name ?? null));
  }, []);

  const pickSound = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ALARM_SOUND_BYTES) {
      toast.error(t('p2pAlarmTooBig'));
      return;
    }
    const saved = await saveAlarmSound({ name: file.name, blob: file });
    if (saved === null) {
      toast.error(t('p2pAlarmSaveFailed'));
      return;
    }
    setSoundName(file.name);
    toast.success(t('p2pAlarmSaved'));
  };

  const resetSound = async () => {
    setTesting(false);
    await clearAlarmSound();
    setSoundName(null);
  };

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
    <div className="flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-sm">
    <div className="flex items-center gap-2">
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
    {watch?.enabled && (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Music className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {t('p2pAlarmSound')}: {soundName ?? t('p2pAlarmDefault')}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            void pickSound(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => fileRef.current?.click()}>
          {t('p2pAlarmChoose')}
        </Button>
        {soundName && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void resetSound()}>
            {t('p2pAlarmDefault')}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setTesting((v) => !v)}>
          {testing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {testing ? t('p2pAlarmStop') : t('p2pAlarmTest')}
        </Button>
      </div>
    )}
    </div>
  );
}
