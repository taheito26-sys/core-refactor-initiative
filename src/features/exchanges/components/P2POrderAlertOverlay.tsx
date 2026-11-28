import { useEffect } from 'react';
import { BellRing, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useT } from '@/lib/i18n';
import { useAcknowledgeP2POrderAlerts, useOpenP2POrderAlerts } from '../hooks/useP2POrderAlerts';
import { binanceOrderUrl } from '../p2p-order-alerts';
import { loadAlarmSound } from '../p2p-alarm-sound';

/** Built-in two-tone beep, used when no custom sound is chosen or it cannot play. */
function beep(ctx: AudioContext | null) {
  if (!ctx) return;
  void ctx.resume().catch(() => undefined);
  const start = ctx.currentTime;
  [880, 660, 880, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.25, start + i * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, start + i * 0.25 + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + i * 0.25);
    osc.stop(start + i * 0.25 + 0.23);
  });
}

/** Plays the merchant's chosen sound on repeat (or the beep) with long vibration while an order waits. */
export function useAlarm(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let audio: HTMLAudioElement | null = null;
    let url: string | null = null;
    let useBeep = true;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      ctx = Ctx ? new Ctx() : null;
    } catch {
      ctx = null;
    }

    const ring = () => {
      if (useBeep) beep(ctx);
      if ('vibrate' in navigator) navigator.vibrate([400, 150, 400, 150, 400]);
    };

    void loadAlarmSound().then((sound) => {
      if (cancelled || !sound?.blob) return;
      url = URL.createObjectURL(sound.blob);
      audio = new Audio(url);
      audio.loop = true;
      audio.play().then(() => { useBeep = false; }).catch(() => { useBeep = true; });
    });

    ring();
    const timer = window.setInterval(ring, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if ('vibrate' in navigator) navigator.vibrate(0);
      audio?.pause();
      if (url) URL.revokeObjectURL(url);
      void ctx?.close().catch(() => undefined);
    };
  }, [active]);
}

/** Full-screen alert for open Binance P2P orders, mounted once in the merchant layout. */
export function P2POrderAlertOverlay() {
  const t = useT();
  const { data: alerts } = useOpenP2POrderAlerts();
  const ack = useAcknowledgeP2POrderAlerts();
  const open = (alerts?.length ?? 0) > 0;
  useAlarm(open);

  if (!open) return null;

  const acknowledge = () => {
    ack.mutate(alerts!.map((a) => a.id), {
      onError: (err: any) => toast.error(err?.message ?? String(err)),
    });
  };

  return (
    <AlertDialog open>
      <AlertDialogContent dir={t.isRTL ? 'rtl' : 'ltr'} className="border-2 border-destructive">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <BellRing className="h-6 w-6 animate-bounce" />
            {t('p2pAlertTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('p2pAlertBody')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {alerts!.map((a) => (
            <div key={a.id} className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-2 font-semibold">
                <span className={a.side === 'buy' ? 'text-emerald-600' : 'text-destructive'}>
                  {a.side === 'buy' ? t('p2pAlertBuy') : t('p2pAlertSell')} {a.amount?.toLocaleString() ?? ''} {a.asset ?? 'USDT'}
                </span>
                {a.total != null && <span>{a.total.toLocaleString()} {a.fiat ?? ''}</span>}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-muted-foreground">
                <span className="truncate">{a.counterparty ?? ''} · #{a.order_number}</span>
                <a
                  href={binanceOrderUrl(a.order_number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-primary underline"
                >
                  {t('p2pAlertOpenBinance')}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogAction onClick={acknowledge} disabled={ack.isPending} className="w-full text-base">
            {t('p2pAlertAcknowledge')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
