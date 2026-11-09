import { Landmark } from 'lucide-react';
import { useBankMisrRate } from './useBankMisrRate';

/**
 * Live Bank Misr price of the Qatari riyal (QAR notes, buy), in EGP per 1 QAR.
 * Renders nothing until a rate exists, so a missing feed never shows a dash or a stale zero.
 */
export function BankMisrRateKpi({ lang }: { lang: 'en' | 'ar' }) {
  const { data } = useBankMisrRate();
  if (!data) return null;

  const ar = lang === 'ar';
  const time = new Date(data.fetchedAt).toLocaleTimeString(ar ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const value = data.buy.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 text-card-foreground shadow-sm"
      role="status"
      aria-label={ar ? 'سعر بنك مصر للريال القطري' : 'Bank Misr Qatari riyal price'}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Landmark className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold leading-tight">{ar ? 'سعر بنك مصر' : 'Bank Misr Price'}</div>
        <div className="text-[10px] leading-tight text-muted-foreground">
          {ar ? `ريال قطري (أوراق نقدية) · شراء · تحديث ${time}` : `QAR notes · buy · updated ${time}`}
        </div>
      </div>
      <div className="shrink-0 text-end leading-tight" dir="ltr">
        <div className="text-lg font-extrabold tabular-nums">{value}</div>
        <div className="text-[10px] text-muted-foreground">{ar ? 'جنيه / ريال' : 'EGP / QAR'}</div>
      </div>
    </div>
  );
}
