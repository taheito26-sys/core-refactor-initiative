import { Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBankMisrRate } from './useBankMisrRate';

/**
 * Live Bank Misr price of the Qatari riyal (QAR notes, sell), in EGP per 1 QAR.
 * Renders nothing until a rate exists, so a missing feed never shows a dash or a stale zero.
 * `hero` sits on the dark home header; `card` sits on the light orders page.
 */
export function BankMisrRateKpi({ lang, variant }: { lang: 'en' | 'ar'; variant: 'hero' | 'card' }) {
  const { data } = useBankMisrRate();
  if (!data) return null;

  const ar = lang === 'ar';
  const time = new Date(data.fetchedAt).toLocaleTimeString(ar ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const value = data.sell.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const hero = variant === 'hero';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl px-3 py-2.5',
        hero
          ? 'mt-2 bg-white/10 text-white ring-1 ring-inset ring-white/20'
          : 'border border-border bg-card text-card-foreground shadow-sm',
      )}
      role="status"
      aria-label={ar ? 'سعر بنك مصر للريال القطري' : 'Bank Misr Qatari riyal price'}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', hero ? 'bg-white/15' : 'bg-primary/10 text-primary')}>
        <Landmark className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[11px] font-medium leading-tight', hero ? 'text-white/90' : 'text-muted-foreground')}>
          {ar ? 'سعر بنك مصر' : 'Bank Misr Price'}
        </div>
        <div className={cn('text-[10px] leading-tight', hero ? 'text-white/70' : 'text-muted-foreground')}>
          {ar ? `ريال قطري (أوراق نقدية) · بيع · تحديث ${time}` : `QAR notes · sell · updated ${time}`}
        </div>
      </div>
      <div className="shrink-0 text-end leading-tight" dir="ltr">
        <div className="text-lg font-extrabold tabular-nums">{value}</div>
        <div className={cn('text-[10px]', hero ? 'text-white/70' : 'text-muted-foreground')}>{ar ? 'جنيه / ريال' : 'EGP / QAR'}</div>
      </div>
    </div>
  );
}
