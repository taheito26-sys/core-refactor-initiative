import { useState } from 'react';
import { format } from 'date-fns';
import { ar as arLocale, enUS } from 'date-fns/locale';
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
 * A one-button day filter: nothing but a small trigger sits in the toolbar,
 * and Today / Yesterday / a calendar only open when it is tapped. Keeps the
 * filter row to a single line on a phone so the orders get the space.
 */
export function DayFilterDropdown({
  value,
  onChange,
  lang = 'en',
  title,
}: {
  /** YYYY-MM-DD, empty for no filter. */
  value: string;
  onChange: (value: string) => void;
  lang?: 'en' | 'ar';
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const isAr = lang === 'ar';
  const locale = isAr ? arLocale : enUS;
  const selected = fromDayString(value);
  const today = daysAgo(0);
  const pick = (day: string) => { onChange(day); setOpen(false); };

  const label = !selected
    ? (isAr ? 'اليوم' : 'Day')
    : value === toDayString(today) ? (isAr ? 'اليوم' : 'Today')
    : value === toDayString(daysAgo(1)) ? (isAr ? 'أمس' : 'Yesterday')
    : format(selected, 'd MMM', { locale });

  const chips = [0, 1, 2].map((n) => ({
    n,
    day: toDayString(daysAgo(n)),
    text: n === 0 ? (isAr ? 'اليوم' : 'Today') : n === 1 ? (isAr ? 'أمس' : 'Yesterday') : format(daysAgo(n), 'EEE d', { locale }),
  }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-colors',
            selected ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card hover:border-primary/40',
          )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {selected && label}
          {!selected && <span className="max-sm:hidden">{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.n}
              type="button"
              onClick={() => pick(value === c.day ? '' : c.day)}
              className={cn(
                'h-8 rounded-xl border px-3 text-xs font-semibold transition-colors',
                value === c.day ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card hover:border-primary/40',
              )}
            >
              {c.text}
            </button>
          ))}
          {selected && (
            <button
              type="button"
              onClick={() => pick('')}
              aria-label={isAr ? 'مسح التاريخ' : 'Clear date'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/50 bg-card hover:border-primary/40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Calendar
          mode="single"
          locale={locale}
          dir={isAr ? 'rtl' : 'ltr'}
          selected={selected}
          defaultMonth={selected ?? today}
          disabled={{ after: today }}
          onSelect={(day) => { if (day) pick(toDayString(day)); }}
        />
      </PopoverContent>
    </Popover>
  );
}
