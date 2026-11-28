import { BellRing, ExternalLink, Volume2 } from 'lucide-react';
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
import { useAlarm } from '../p2p-alarm-sound';

/** Full-screen alert for open Binance P2P orders, mounted in both merchant shells. */
export function P2POrderAlertOverlay() {
  const t = useT();
  const { data: alerts } = useOpenP2POrderAlerts();
  const ack = useAcknowledgeP2POrderAlerts();
  const open = (alerts?.length ?? 0) > 0;
  const alarm = useAlarm(open);

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
          {alarm.blocked && (
            <button
              type="button"
              onClick={() => void alarm.enable()}
              className="flex items-center justify-center gap-2 rounded-md bg-destructive px-3 py-2 text-sm font-bold text-white"
            >
              <Volume2 className="h-4 w-4" />
              {t('p2pAlarmEnable')}
            </button>
          )}
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
