import { AlarmClock, BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';
import { durationLabel, type Lang, type ReadingDue } from '../route';

/** "Next reading in 1 h 20 min" / "Reading overdue by 40 min"; nothing when the shipment is not on the road. */
export function DueBadge({ due, lang, now }: { due: ReadingDue; lang: Lang; now: number }) {
  if (due.state === 'idle' || due.dueAt == null) return null;
  const overdue = due.state === 'overdue';
  const Icon = overdue ? BellRing : AlarmClock;
  const text = overdue
    ? lang === 'ar' ? `القراءة متأخرة ${durationLabel(due.overdueMs, lang)}` : `Reading overdue by ${durationLabel(due.overdueMs, lang)}`
    : lang === 'ar' ? `القراءة القادمة بعد ${durationLabel(due.dueAt - now, lang)}` : `Next reading in ${durationLabel(due.dueAt - now, lang)}`;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        overdue ? 'bg-destructive/10 text-destructive' : due.state === 'due_soon' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {text}
    </span>
  );
}
