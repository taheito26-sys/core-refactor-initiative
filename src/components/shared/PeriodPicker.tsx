import { useEffect, useState } from 'react';
import { ar as arLocale, enUS } from 'date-fns/locale';
import { format } from 'date-fns';
import { CalendarDays, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fromDayString, toDayString } from '@/components/shared/QuickDateField';
import { cn } from '@/lib/utils';

type Mode = 'days' | 'months';

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysAgo = (n: number) => { const d = startOfToday(); d.setDate(d.getDate() - n); return d; };
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const firstOfMonth = (key: string) => `${key}-01`;
const lastOfMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return toDayString(new Date(y, m, 0));
};

/** The three ways a period reaches the page, written as the two days it covers (YYYY-MM-DD). */
export function periodFromMonths(fromMonth: string, toMonth: string): { from: string; to: string } {
  const [a, b] = fromMonth <= toMonth ? [fromMonth, toMonth] : [toMonth, fromMonth];
  return { from: firstOfMonth(a), to: lastOfMonth(b) };
}

/** Puts the two days in order, and folds a period of one day into a single day. */
export function orderedPeriod(from: string, to: string): { from: string; to: string } {
  if (!from) return { from: '', to: '' };
  const end = to || from;
  const [a, b] = from <= end ? [from, end] : [end, from];
  return { from: a, to: b === a ? '' : b };
}

const FIELD = 'h-11 min-w-0 rounded-xl border border-border bg-background px-2 text-[14px] font-semibold text-foreground';

/**
 * A day chosen from three lists (day, month, year) instead of typed digits. It reports a full YYYY-MM-DD only once
 * all three are chosen, and an empty string when any is cleared.
 */
export function DaySelect({ value, onChange, min, max, lang = 'en', label }: {
  value: string;
  onChange: (day: string) => void;
  min?: string;
  max?: string;
  lang?: 'en' | 'ar';
  label: string;
}) {
  const isAr = lang === 'ar';
  const locale = isAr ? arLocale : enUS;
  const parse = (v: string) => (v ? v.split('-').map(Number) : [0, 0, 0]);
  const [vy, vm, vd] = parse(value);
  const [y, setY] = useState(vy || 0);
  const [m, setM] = useState(vm || 0);
  const [d, setD] = useState(vd || 0);

  useEffect(() => {
    const [ny, nm, nd] = parse(value);
    setY(ny || 0); setM(nm || 0); setD(nd || 0);
  }, [value]);

  const thisYear = new Date().getFullYear();
  const lowYear = min ? Number(min.slice(0, 4)) : thisYear - 5;
  const highYear = max ? Number(max.slice(0, 4)) : thisYear;
  const years: number[] = [];
  for (let yr = highYear; yr >= Math.min(lowYear, highYear); yr -= 1) years.push(yr);
  const daysInMonth = y && m ? new Date(y, m, 0).getDate() : 31;

  const commit = (ny: number, nm: number, nd: number) => {
    setY(ny); setM(nm); setD(nd);
    if (ny && nm && nd) {
      const safeDay = Math.min(nd, new Date(ny, nm, 0).getDate());
      onChange(`${ny}-${String(nm).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`);
    } else if (!ny && !nm && !nd) {
      onChange('');
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-1" role="group" aria-label={label}>
      <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
      <span className="flex gap-1.5">
        <select className={cn(FIELD, 'w-[74px]')} value={d} onChange={e => commit(y, m, Number(e.target.value))} aria-label={isAr ? 'اليوم' : 'Day'}>
          <option value={0}>{isAr ? 'يوم' : 'Day'}</option>
          {Array.from({ length: daysInMonth }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
        <select className={cn(FIELD, 'flex-1')} value={m} onChange={e => commit(y, Number(e.target.value), d)} aria-label={isAr ? 'الشهر' : 'Month'}>
          <option value={0}>{isAr ? 'شهر' : 'Month'}</option>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{format(new Date(2000, i, 1), 'MMM', { locale })}</option>)}
        </select>
        <select className={cn(FIELD, 'w-[86px]')} value={y} onChange={e => commit(Number(e.target.value), m, d)} aria-label={isAr ? 'السنة' : 'Year'}>
          <option value={0}>{isAr ? 'سنة' : 'Year'}</option>
          {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
        </select>
      </span>
    </div>
  );
}

/**
 * The period filter of the customer portal. It shows what it is plainly, From and To, as two fields that open the
 * phone's own date picker, with one-tap shortcuts for the common periods and a Months view for "from this month to
 * that month". A day is a period whose two ends are the same.
 */
export function PeriodPicker({
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
  const isAr = lang === 'ar';
  const L = (en: string, ar: string) => (isAr ? ar : en);
  const locale = isAr ? arLocale : enUS;
  const today = startOfToday();
  const todayStr = toDayString(today);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('days');
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to || from);
  const [monthFrom, setMonthFrom] = useState(from ? from.slice(0, 7) : monthKey(today));
  const [monthTo, setMonthTo] = useState((to || from) ? (to || from).slice(0, 7) : monthKey(today));

  // The fields follow the filter whenever it is opened or changed from outside (Clear on the page).
  useEffect(() => {
    if (!open) return;
    setDraftFrom(from);
    setDraftTo(to || from);
    setMonthFrom(from ? from.slice(0, 7) : monthKey(today));
    setMonthTo((to || from) ? (to || from).slice(0, 7) : monthKey(today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, from, to]);

  const apply = (a: string, b: string) => {
    const next = orderedPeriod(a, b);
    onChange(next.from, next.to);
    setOpen(false);
  };

  const dayLabel = (day: string, withYear: boolean) => {
    const d = fromDayString(day);
    return d ? format(d, withYear ? 'd MMM yyyy' : 'd MMM', { locale }) : '';
  };
  const last = to || from;
  const active = !!from;
  const triggerText = !active
    ? emptyLabel
    : last === from
      ? dayLabel(from, true)
      : `${L('From', 'من')} ${dayLabel(from, false)} ${L('To', 'إلى')} ${dayLabel(last, true)}`;

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const shortcuts = [
    { text: L('Today', 'اليوم'), a: todayStr, b: todayStr },
    { text: L('Yesterday', 'أمس'), a: toDayString(daysAgo(1)), b: toDayString(daysAgo(1)) },
    { text: L('Last 7 days', 'آخر 7 أيام'), a: toDayString(daysAgo(6)), b: todayStr },
    { text: L('Last 30 days', 'آخر 30 يوماً'), a: toDayString(daysAgo(29)), b: todayStr },
    { text: L('This month', 'هذا الشهر'), a: toDayString(monthStart), b: todayStr },
    { text: L('Last month', 'الشهر الماضي'), a: toDayString(lastMonthStart), b: lastOfMonth(monthKey(lastMonthStart)) },
    { text: L('This year', 'هذه السنة'), a: `${today.getFullYear()}-01-01`, b: todayStr },
  ];

  const years = Array.from({ length: 6 }, (_, i) => today.getFullYear() - i);
  const monthNames = Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), 'LLLL', { locale }));
  const monthField = (label: string, value: string, onValue: (v: string) => void) => {
    const [y, m] = value.split('-').map(Number);
    return (
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
        <span className="flex gap-1.5">
          <select
            className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-2 text-[14px] font-semibold text-foreground"
            value={m}
            onChange={e => onValue(`${y}-${String(e.target.value).padStart(2, '0')}`)}
          >
            {monthNames.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <select
            className="h-11 w-[84px] rounded-xl border border-border bg-background px-2 text-[14px] font-semibold text-foreground"
            value={y}
            onChange={e => onValue(`${e.target.value}-${String(m).padStart(2, '0')}`)}
          >
            {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
          </select>
        </span>
      </label>
    );
  };

  const monthsPeriod = periodFromMonths(monthFrom, monthTo);

  const panel = (
    <>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {shortcuts.map(c => (
            <button
              key={c.text}
              type="button"
              onClick={() => apply(c.a, c.b)}
              className={cn(
                'h-9 rounded-xl border px-3 text-[13px] font-semibold transition-colors',
                from === c.a && last === c.b ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 bg-card hover:border-primary/40',
              )}
            >
              {c.text}
            </button>
          ))}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="tablist">
          {(['days', 'months'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn('h-9 rounded-lg text-[13px] font-bold transition-colors', mode === m ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground')}
            >
              {m === 'days' ? L('Days', 'أيام') : L('Months', 'أشهر')}
            </button>
          ))}
        </div>

        {mode === 'days' ? (
          <div className="flex flex-col gap-2.5">
            <DaySelect label={L('From', 'من')} value={draftFrom} max={draftTo || todayStr} onChange={setDraftFrom} lang={lang} />
            <DaySelect label={L('To', 'إلى')} value={draftTo} min={draftFrom || undefined} max={todayStr} onChange={setDraftTo} lang={lang} />
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {monthField(L('From month', 'من شهر'), monthFrom, setMonthFrom)}
            {monthField(L('To month', 'إلى شهر'), monthTo, setMonthTo)}
            <p className="text-[12px] text-muted-foreground">
              {dayLabel(monthsPeriod.from, true)} <span aria-hidden="true">→</span> {dayLabel(monthsPeriod.to, true)}
            </p>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          {active && (
            <button
              type="button"
              onClick={() => apply('', '')}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-4 text-[14px] font-semibold"
            >
              <X className="h-4 w-4" />
              {L('Clear', 'مسح')}
            </button>
          )}
          <button
            type="button"
            disabled={mode === 'days' && !draftFrom}
            onClick={() => (mode === 'days' ? apply(draftFrom, draftTo) : apply(monthsPeriod.from, monthsPeriod.to))}
            className="h-11 flex-1 rounded-xl bg-primary text-[14px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {L('Show', 'عرض')}
          </button>
        </div>
          </>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          className={triggerClassName
            ? cn(triggerClassName, active && triggerActiveClassName)
            : cn(
              'inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-colors',
              active ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card hover:border-primary/40',
            )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {triggerText}
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-[10050] w-[min(92vw,380px)] p-3" align="start" dir={isAr ? 'rtl' : 'ltr'}>
        {panel}
      </PopoverContent>
    </Popover>
  );
}
