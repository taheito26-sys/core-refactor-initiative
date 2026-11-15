import { useId, useMemo, useState, type CSSProperties } from 'react';
import { balanceAsOf, buildHistoryLines, historyView, round2, type HistoryClaim, type HistoryEvent } from '@/features/stock/utils/accountHistory';
import { csvCell, downloadTextFile } from '@/features/stock/utils/loanStatementExport';

type Lang = 'ar' | 'en';
type Preset = '30d' | 'month' | 'last_month' | 'all' | 'custom';

const TEXT = {
  title: { en: 'Account history', ar: 'كشف حساب تفصيلي' },
  hint: { en: 'Every new order and every payment, with the unpaid amount before and after it.', ar: 'كل طلب جديد وكل دفعة، مع المبلغ غير المسدد قبلها وبعدها.' },
  balanceOn: { en: 'Unpaid on', ar: 'غير المسدد بتاريخ' },
  p30d: { en: 'Last 30 days', ar: 'آخر ٣٠ يومًا' },
  month: { en: 'This month', ar: 'هذا الشهر' },
  last_month: { en: 'Last month', ar: 'الشهر الماضي' },
  all: { en: 'All', ar: 'الكل' },
  custom: { en: 'Custom', ar: 'مخصص' },
  from: { en: 'From', ar: 'من' },
  to: { en: 'To', ar: 'إلى' },
  opening: { en: 'Opening balance', ar: 'الرصيد الافتتاحي' },
  closing: { en: 'Closing balance', ar: 'الرصيد الختامي' },
  charges: { en: 'New orders', ar: 'طلبات جديدة' },
  payments: { en: 'Payments', ar: 'الدفعات' },
  before: { en: 'Unpaid before', ar: 'غير مسدد قبل' },
  after: { en: 'Unpaid after', ar: 'غير مسدد بعد' },
  charge: { en: 'New order', ar: 'طلب جديد' },
  payment: { en: 'Payment', ar: 'دفعة' },
  orders: { en: 'orders', ar: 'طلبات' },
  none: { en: 'No activity in this period.', ar: 'لا توجد حركة في هذه الفترة.' },
  csv: { en: 'Download CSV', ar: 'تحميل CSV' },
  cash: { en: 'Cash', ar: 'نقدًا' },
  bank: { en: 'Bank transfer', ar: 'تحويل بنكي' },
  credit: { en: 'credit', ar: 'رصيد دائن' },
  differs: { en: 'The unpaid total on the account is', ar: 'إجمالي غير المسدد في الحساب هو' },
  differsWhy: { en: 'The difference is an overpayment on an order that is already closed.', ar: 'الفرق دفعة زائدة على طلب مغلق.' },
  unappliedOne: { en: 'A payment that was accepted is not reflected in the balance:', ar: 'دفعة تم قبولها ولم تنعكس على الرصيد:' },
  unappliedMany: { en: 'Accepted payments that are not reflected in the balance:', ar: 'دفعات تم قبولها ولم تنعكس على الرصيد:' },
} as const;

const css = {
  card: { background: 'var(--card-bg, #fff)', border: '1px solid var(--line, #e5e7eb)', borderRadius: 14, padding: 14, color: 'var(--text, #111827)' } as CSSProperties,
  muted: { color: 'var(--muted, #6b7280)', fontSize: 12 } as CSSProperties,
  chip: (on: boolean): CSSProperties => ({ minHeight: 36, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--brand, #2563eb)' : 'var(--line, #e5e7eb)'}`, background: on ? 'var(--brand, #2563eb)' : 'transparent', color: on ? 'hsl(var(--primary-foreground, 0 0% 100%))' : 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }),
  input: { minHeight: 40, padding: '0 8px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, background: 'transparent', color: 'inherit', font: 'inherit' } as CSSProperties,
  bar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'color-mix(in srgb, var(--brand, #2563eb) 9%, transparent)', fontWeight: 800 } as CSSProperties,
};

const dayStart = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); };
const dayEnd = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999).getTime(); };
const toIso = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export interface AccountHistoryProps {
  events: HistoryEvent[];
  currency: string;
  lang: Lang;
  /** The unpaid total the account itself reports; a difference to the history is explained under it. */
  expectedBalance?: number;
  /** Accepted payments that left nothing behind, found by the merchant side. */
  unapplied?: HistoryClaim[];
  fileBase?: string;
  now?: number;
}

/**
 * The account as a bank statement: opening balance, every order and payment with the unpaid amount before and
 * after it, closing balance, for any period, plus what was unpaid on any past day. It takes plain events and
 * needs no app providers, so the merchant's statement dialog, the buyer's portal and the shared statement page
 * all render the same thing.
 */
export function AccountHistory({ events, currency, lang, expectedBalance, unapplied = [], fileBase = 'account-history', now = Date.now() }: AccountHistoryProps) {
  const T = <K extends keyof typeof TEXT>(k: K) => TEXT[k][lang];
  const id = useId();
  const [preset, setPreset] = useState<Preset>('30d');
  const [from, setFrom] = useState(() => toIso(now - 30 * 86400000));
  const [to, setTo] = useState(() => toIso(now));
  const [asOf, setAsOf] = useState(() => toIso(now));

  const lines = useMemo(() => buildHistoryLines(events), [events]);
  const range = useMemo(() => {
    const d = new Date(now);
    if (preset === 'all') return { from: null, to: null };
    if (preset === '30d') return { from: now - 30 * 86400000, to: now };
    if (preset === 'month') return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now };
    if (preset === 'last_month') return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1 };
    return { from: from ? dayStart(from) : null, to: to ? dayEnd(to) : null };
  }, [preset, from, to, now]);
  const view = useMemo(() => historyView(lines, range.from, range.to), [lines, range]);
  const asOfValue = useMemo(() => (asOf ? balanceAsOf(lines, dayEnd(asOf)) : 0), [lines, asOf]);
  const total = lines.length ? lines[lines.length - 1].after : 0;
  const gap = expectedBalance == null ? 0 : round2(expectedBalance - total);

  const locale = lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const money = (n: number) => (n < 0 ? `−${fmt(-n)}` : fmt(n));
  /** With the currency, and a balance below zero marked as credit, after the currency. */
  const withCur = (n: number) => `${money(n)} ${currency}${n < 0 ? ` (${T('credit')})` : ''}`;
  const date = (ts: number) => new Date(ts).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
  const methodLabel = (m?: 'cash' | 'bank' | null) => (m === 'cash' ? T('cash') : m === 'bank' ? T('bank') : '');

  const exportCsv = () => {
    const head = ['Date', 'Type', 'Reference', 'Note', `Unpaid before (${currency})`, `Amount (${currency})`, `Unpaid after (${currency})`].map(csvCell).join(',');
    const rows = view.lines.map(l => [new Date(l.ts).toISOString().slice(0, 16).replace('T', ' '), l.kind === 'charge' ? 'New order' : 'Payment', l.refs.join(' '), l.description, l.before, l.kind === 'charge' ? l.amount : -l.amount, l.after].map(csvCell).join(','));
    const edge = (label: string, n: number) => ['', label, '', '', '', '', n].map(csvCell).join(',');
    downloadTextFile(`${fileBase}.csv`, [head, edge('Opening balance', view.opening), ...rows, edge('Closing balance', view.closing)].join('\r\n'));
  };

  return (
    <section dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-label={T('title')} style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'inherit' }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{T('title')}</div>
        <div style={css.muted}>{T('hint')}</div>
      </div>

      {unapplied.length > 0 && (
        <div role="alert" style={{ ...css.card, borderColor: 'var(--warn, #d97706)', background: 'color-mix(in srgb, var(--warn, #d97706) 10%, transparent)', fontSize: 13, fontWeight: 700 }}>
          {unapplied.length === 1 ? T('unappliedOne') : T('unappliedMany')}{' '}
          {unapplied.map(c => `${fmt(c.amount)} ${currency} · ${date(new Date(c.paidAt).getTime())}`).join(' | ')}
        </div>
      )}

      <div style={{ ...css.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <label htmlFor={`${id}-asof`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={css.muted}>{T('balanceOn')}</span>
          <input id={`${id}-asof`} type="date" value={asOf} max={toIso(now)} onChange={e => setAsOf(e.target.value)} style={css.input} />
        </label>
        <div style={{ fontSize: 24, fontWeight: 800, color: asOfValue > 0.005 ? 'var(--bad, #c0392b)' : 'var(--good, #1a7a3c)' }}>
          <span dir="ltr">{withCur(asOfValue)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label={T('title')}>
        {(['30d', 'month', 'last_month', 'all', 'custom'] as Preset[]).map(p => (
          <button key={p} type="button" aria-pressed={preset === p} onClick={() => setPreset(p)} style={css.chip(preset === p)}>{T(p === '30d' ? 'p30d' : p)}</button>
        ))}
        <button type="button" onClick={exportCsv} style={{ ...css.chip(false), marginInlineStart: 'auto' }}>{T('csv')}</button>
      </div>
      {preset === 'custom' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={css.muted}>{T('from')}</span><input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={css.input} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={css.muted}>{T('to')}</span><input type="date" value={to} min={from || undefined} max={toIso(now)} onChange={e => setTo(e.target.value)} style={css.input} /></label>
        </div>
      )}

      <div style={css.bar}><span>{T('opening')}</span><span dir="ltr">{withCur(view.opening)}</span></div>

      {view.lines.length === 0 ? (
        <div style={{ ...css.muted, textAlign: 'center', padding: 16 }}>{T('none')}</div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--line, #e5e7eb)', borderRadius: 14, overflow: 'hidden' }}>
          {view.lines.map((l, i) => (
            <li key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderTop: i ? '1px solid var(--line, #e5e7eb)' : 0, color: 'var(--text, #111827)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {l.kind === 'charge' ? T('charge') : T('payment')}
                  {l.parts > 1 && <span style={css.muted}> · {l.parts} {T('orders')}</span>}
                </div>
                <div style={css.muted}>{date(l.ts)}{methodLabel(l.method) ? ` · ${methodLabel(l.method)}` : ''}</div>
                {(l.refs.length > 0 || l.description) && <div style={{ ...css.muted, overflowWrap: 'anywhere' }}>{[l.refs.slice(0, 3).join(' '), l.description].filter(Boolean).join(' · ')}</div>}
              </div>
              <div style={{ textAlign: 'end', flexShrink: 0 }} dir="ltr">
                <div style={css.muted}>{T('before')} {money(l.before)}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: l.kind === 'charge' ? 'var(--bad, #c0392b)' : 'var(--good, #1a7a3c)' }}>{l.kind === 'charge' ? '+' : '−'}{fmt(l.amount)}</div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{T('after')} {money(l.after)}{l.after < 0 ? ` (${T('credit')})` : ''}</div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div style={css.bar}><span>{T('closing')}</span><span dir="ltr">{withCur(view.closing)}</span></div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', ...css.muted }}>
        <span>{T('charges')}: <b dir="ltr">{fmt(view.charges)}</b></span>
        <span>{T('payments')}: <b dir="ltr">{fmt(view.payments)}</b></span>
      </div>
      {Math.abs(gap) >= 0.01 && <div style={css.muted}>{T('differs')} <b dir="ltr">{fmt(expectedBalance as number)} {currency}</b>. {T('differsWhy')}</div>}
    </section>
  );
}
