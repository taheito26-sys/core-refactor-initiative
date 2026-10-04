import { useState } from 'react';
import { format } from 'date-fns';
import { ar as arLocale, enUS } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** A calendar day as YYYY-MM-DD in local time, the format a date input uses. */
export function toDayString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parses YYYY-MM-DD as local midnight; undefined when it is not a valid day. */
export function fromDayString(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const daysAgo = (n: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};

/**
 * A date field that needs no typing: one tap for today, yesterday or a few
 * days back, or a calendar to pick any other day. Replaces the native date
 * input, whose month / day / year segments are slow to edit on a phone.
 */
export function QuickDateField({
  value,
  onChange,
  lang = 'en',
  maxToday = true,
  quickDays = [0, 1, 2, 3],
}: {
  /** YYYY-MM-DD. */
  value: string;
  onChange: (value: string) => void;
  lang?: 'en' | 'ar';
  /** Disallow days after today (a payment cannot have been made in the future). */
  maxToday?: boolean;
  /** How many days back each shortcut goes; 0 is today. */
  quickDays?: number[];
}) {
  const [open, setOpen] = useState(false);
  const isAr = lang === 'ar';
  const locale = isAr ? arLocale : enUS;
  const selected = fromDayString(value);
  const today = daysAgo(0);
  const chipLabel = (n: number) => (n === 0 ? (isAr ? 'اليوم' : 'Today') : n === 1 ? (isAr ? 'أمس' : 'Yesterday') : format(daysAgo(n), 'EEE d MMM', { locale }));

  const chips = quickDays.map((n) => {
    const day = toDayString(daysAgo(n));
    return { n, day, active: value === day };
  });
  const customActive = !!selected && !chips.some((c) => c.active);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.n}
            type="button"
            onClick={() => onChange(c.day)}
            className={cn(
              'h-10 rounded-xl border px-3 text-xs font-semibold transition-colors',
              c.active ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card hover:border-primary/40',
            )}
          >
            {chipLabel(c.n)}
          </button>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors',
                customActive ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card hover:border-primary/40',
              )}
            >
              <CalendarDays className="h-4 w-4" />
              {customActive && selected ? format(selected, 'd MMM yyyy', { locale }) : isAr ? 'اختر تاريخًا' : 'Pick a date'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              locale={locale}
              dir={isAr ? 'rtl' : 'ltr'}
              selected={selected}
              defaultMonth={selected ?? today}
              disabled={maxToday ? { after: today } : undefined}
              onSelect={(day) => {
                if (!day) return;
                onChange(toDayString(day));
                setOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      {selected && (
        <p className="text-xs text-muted-foreground">{format(selected, 'EEEE, d MMMM yyyy', { locale })}</p>
      )}
    </div>
  );
}
