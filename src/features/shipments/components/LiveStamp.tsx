import { cn } from '@/lib/utils';
import { agoLabel, durationLabel, type Lang, type Liveness, type ReadingDue } from '../route';

/**
 * "Live · updated 18 min ago" while readings come on time, "Stale · last update 5 h ago" once one is
 * late. A parked or finished shipment says when it was last read and nothing about live.
 */
export function LiveStamp({
  liveness, due, lastAt, lang, now,
}: { liveness: Liveness; due: ReadingDue; lastAt: string | null; lang: Lang; now: number }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const ago = lastAt ? agoLabel(lastAt, now, lang) : null;

  if (liveness === 'none') {
    return <span className="text-xs text-muted-foreground">{ago ? L(`Last reading ${ago}`, `آخر قراءة ${ago}`) : L('No reading yet', 'لا توجد قراءة بعد')}</span>;
  }
  const stale = liveness === 'stale';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className={cn('inline-flex items-center gap-1.5 font-semibold', stale ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
        <span className="relative flex h-2 w-2" aria-hidden="true">
          {!stale && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60 motion-reduce:animate-none" />}
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', stale ? 'bg-amber-500' : 'bg-emerald-500')} />
        </span>
        {stale ? L('Stale', 'قديمة') : L('Live', 'مباشر')}
      </span>
      <span className="text-muted-foreground">{ago ? L(`updated ${ago}`, `تحديث ${ago}`) : L('waiting for the first reading', 'بانتظار أول قراءة')}</span>
      {stale ? (
        <span className="font-semibold text-destructive">{L(`reading overdue by ${durationLabel(due.overdueMs, lang)}`, `القراءة متأخرة ${durationLabel(due.overdueMs, lang)}`)}</span>
      ) : due.dueAt != null ? (
        <span className="text-muted-foreground">{L(`next in ${durationLabel(due.dueAt - now, lang)}`, `القادمة بعد ${durationLabel(due.dueAt - now, lang)}`)}</span>
      ) : null}
    </div>
  );
}
