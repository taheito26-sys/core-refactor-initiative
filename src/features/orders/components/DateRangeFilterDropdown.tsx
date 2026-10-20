import { useState } from 'react';
import { format } from 'date-fns';
import { ar as arLocale, enUS } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fromDayString, toDayString } from '@/components/shared/QuickDateField';
import { cn } from '@/lib/utils';

const daysAgo = (n: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};

/**
 * A one-button date filter for a single day or a period (from a day to a day). A day is a period
 * whose two ends are the same, so one tap on the calendar picks a day and a second tap extends it
 * to a period. The quick choices cover the common spans without opening the calendar.
 */
export function DateRangeFilterDropdown({
  from,
  to,
  onChange,
  lang = 'en',
  title,
  triggerClassName,
  triggerActiveClassName,
  emptyLabel,
}: {
  /** First day, YYYY-MM-DD, empty for no filter. */
  from: string;
  /** Last day, YYYY-MM-DD; empty means the period is just the first day. */
  to: string;
  onChange: (from: string, to: string) => void;
  lang?: 'en' | 'ar';
  title?: string;
  triggerClassName?: string;
  triggerActiveClassName?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const isAr = lang === 'ar';
  const locale = isAr ? arLocale : enUS;
  const start = fromDayString(from);
  const end = fromDayString(to || from);
  const today = daysAgo(0);
  const todayStr = toDayString(today);
  const last = to || from;
  const isPeriod = !!from && last !== from;

  const pick = (a: string, b: string) => { onChange(a, b === a ? '' : b); setOpen(false); };

  const label = !start
    ? ''
    : isPeriod && end
      ? `${format(start, 'd MMM', { locale })} – ${format(end, 'd MMM', { locale })}`
      : from === todayStr ? (isAr ? 'اليوم' : 'Today')
      : from === toDayString(daysAgo(1)) ? (isAr ? 'أمس' : 'Yesterday')
      : format(start, 'd MMM', { locale });

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const chips = [
    { text: isAr ? 'اليوم' : 'Today', a: todayStr, b: todayStr },
    { text: isAr ? 'أمس' : 'Yesterday', a: toDayString(daysAgo(1)), b: toDayString(daysAgo(1)) },
    { text: isAr ? 'آخر 7 أيام' : 'Last 7 days', a: toDayString(daysAgo(6)), b: todayStr },
    { text: isAr ? 'آخر 30 يوماً' : 'Last 30 days', a: toDayString(daysAgo(29)), b: todayStr },
    { text: isAr ? 'هذا الشهر' : 'This month', a: toDayString(monthStart), b: todayStr },
  ];

  const selected: DateRange | undefined = start ? { from: start, to: end ?? start } : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          className={triggerClassName
            ? cn(triggerClassName, start && triggerActiveClassName)
            : cn(
              'inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-colors',
              start ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card hover:border-primary/40',
            )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {start ? label : emptyLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[calc(100vw-16px)] p-2" align="start">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {chips.map(c => {
            const on = from === c.a && last === c.b;
            return (
              <button
                key={c.text}
                type="button"
                onClick={() => (on ? pick('', '') : pick(c.a, c.b))}
                className={cn(
                  'h-8 rounded-xl border px-3 text-xs font-semibold transition-colors',
                  on ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card hover:border-primary/40',
                )}
              >
                {c.text}
              </button>
            );
          })}
          {start && (
            <button
              type="button"
              onClick={() => pick('', '')}
              aria-label={isAr ? 'مسح التاريخ' : 'Clear date'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/50 bg-card hover:border-primary/40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="mb-1 px-1 text-[11px] text-muted-foreground">
          {isAr ? 'اختر يوماً، ثم اختر يوماً ثانياً لتحديد فترة' : 'Pick a day, then a second day to make a period'}
        </p>
        <Calendar
          mode="range"
          locale={locale}
          dir={isAr ? 'rtl' : 'ltr'}
          selected={selected}
          defaultMonth={start ?? today}
          disabled={{ after: today }}
          onDayClick={(day, _modifiers, e) => {
            e.preventDefault();
            const clicked = toDayString(day);
            // Nothing picked, or a whole period already picked: this tap starts over as a single day
            // and the calendar stays open for the second tap. A tap with only the first day picked
            // closes the period (earlier or later than the first day, or the same day again).
            if (!from || (to && to !== from)) { onChange(clicked, ''); return; }
            const [a, b] = clicked < from ? [clicked, from] : [from, clicked];
            pick(a, b);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
