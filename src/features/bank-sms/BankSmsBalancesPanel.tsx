import { RefreshCw, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { useBankSmsBalances } from './useBankSmsBalances';

/** Android-only: shows the latest bank balances read from SMS. Renders nothing elsewhere. */
export function BankSmsBalancesPanel() {
  const t = useT();
  const { supported, permission, syncing, balances, sync, requestAccess } = useBankSmsBalances();
  if (!supported) return null;

  const sorted = [...balances].sort((a, b) => b.smsTimestamp - a.smsTimestamp);
  const locale = t.lang === 'ar' ? 'ar' : 'en';

  return (
    <section className="rounded-lg border bg-card p-3 text-card-foreground" aria-label={t('smsBalTitle')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Smartphone className="h-4 w-4" />
          {t('smsBalTitle')}
        </h3>
        {permission === 'granted' && (
          <Button size="sm" variant="ghost" onClick={() => void sync()} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            <span className="ms-1">{t('smsBalRefresh')}</span>
          </Button>
        )}
      </div>

      {permission === 'granted' ? (
        sorted.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('smsBalEmpty')}</p>
        ) : (
          <ul className="mt-2 divide-y">
            {sorted.map((b) => (
              <li key={b.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{b.sender}</div>
                  <div className="text-xs text-muted-foreground">
                    {b.last4 ? `${t('smsBalAccount')} •••• ${b.last4} · ` : ''}
                    {t('smsBalAsOf')} {new Date(b.smsTimestamp).toLocaleString(locale)}
                  </div>
                </div>
                <div className="shrink-0 font-semibold tabular-nums" dir="ltr">
                  {b.balance.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {b.currency}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : permission === 'denied' ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('smsBalDenied')}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-muted-foreground">{t('smsBalEnableDesc')}</p>
          <Button size="sm" onClick={() => void requestAccess()}>{t('smsBalEnable')}</Button>
        </div>
      )}
    </section>
  );
}
