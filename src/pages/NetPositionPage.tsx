import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTheme } from '@/lib/theme-context';
import { useTrackerState } from '@/lib/useTrackerState';
import { useIsMobile } from '@/hooks/use-mobile';
import { useT } from '@/lib/i18n';
import { fmtTotal, getAccountBalance, resolveCustomerName } from '@/lib/tracker-helpers';
import { useExchangeBalances } from '@/features/exchanges/hooks/useExchangeBalances';
import { PersonalLoansPanel } from '@/features/net-position/components/PersonalLoansPanel';
import { useNetPositionDays, useNetPositionSettings, usePersonalLoans } from '@/features/net-position/api';
import {
  LINE_ORDER, computePosition, countableAccounts, monthsAvailable, qatarDay, sameDayRow, summariseMonth, toDayRow,
  type DayRow, type LineKey, type PositionLine,
} from '@/features/net-position/position';
import { buildPositionReportHtml, exportPositionPdf } from '@/features/net-position/report';
import '@/styles/tracker.css';

const money = (n: number, signed = false) => `${signed && n > 0 ? '+' : n < 0 ? '−' : ''}${fmtTotal(Math.abs(n))}`;
const signColor = (n: number) => (n > 0.5 ? 'var(--good)' : n < -0.5 ? 'var(--bad)' : 'var(--muted)');

/** One bar per saved day, scaled between the lowest and highest net of the month. */
function DayBars({ days, label }: { days: DayRow[]; label: string }) {
  if (days.length === 0) return null;
  const values = days.map(d => d.net);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const floor = lo - Math.max(1, (hi - lo) * 0.15);
  const W = 320, H = 70, gap = 3;
  const bw = Math.max(3, (W - gap * (days.length - 1)) / days.length);
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={label}>
      {days.map((d, i) => {
        const h = Math.max(2, ((d.net - floor) / (hi - floor || 1)) * H);
        const x = i * (bw + gap);
        const last = i === days.length - 1;
        return (
          <g key={d.day}>
            <rect x={x} y={H - h} width={bw} height={h} rx={2} fill={last ? 'var(--brand)' : 'var(--muted)'} opacity={last ? 1 : 0.5} />
            {(days.length <= 12 || i % 5 === 0 || last) && (
              <text x={x + bw / 2} y={H + 12} textAnchor="middle" fontSize="8" fill="var(--muted)">{d.day.slice(8)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function NetPositionPage() {
  const { settings: theme } = useTheme();
  const isMobile = useIsMobile();
  const t = useT();
  const lang: 'en' | 'ar' = t.lang === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { state, applyState } = useTrackerState({
    lowStockThreshold: theme.lowStockThreshold,
    priceAlertThreshold: theme.priceAlertThreshold,
    range: theme.range,
    currency: theme.currency,
  });

  const { settings, loaded: settingsLoaded, unavailable: settingsUnavailable, save: saveSettings } = useNetPositionSettings();
  const { days, loaded: daysLoaded, unavailable: daysUnavailable, save: saveDay } = useNetPositionDays();
  const { loans: personalLoans, unavailable: personalLoansUnavailable } = usePersonalLoans();
  const { data: exchangeBalances } = useExchangeBalances();

  const included = useMemo(() => new Set(settings?.includedAccounts ?? []), [settings]);
  const exchange = useMemo(() => {
    if (!exchangeBalances) return null;
    const by = { binance: 0, okx: 0 };
    for (const b of exchangeBalances) if (b.asset === 'USDT') by[b.exchange] += b.free + b.locked;
    return by;
  }, [exchangeBalances]);

  const customerName = (id: string) => {
    const c = (state.customers || []).find(x => x.id === id);
    return c ? resolveCustomerName(c, lang) : '—';
  };
  const position = useMemo(() => computePosition({
    accounts: state.cashAccounts || [],
    ledger: state.cashLedger || [],
    includedAccountIds: included,
    customerLoans: state.customerLoans || [],
    deletedLoanIds: state.deletedLoanIds,
    customerName,
    personalLoans,
    exchange,
    batches: state.batches || [],
    trades: state.trades || [],
    usdtTransfers: state.usdtTransfers,
    usdRateOverride: settings?.usdRate,
    egpRateOverride: settings?.egpRate,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, included, personalLoans, exchange, settings, lang]);

  // ── Today's reading is saved as the day's row, so each month has real days to open and close on ──
  const today = qatarDay(Date.now());
  const liveRow = useMemo(() => toDayRow(position, today), [position, today]);
  const ready = settingsLoaded && daysLoaded && exchange !== null && !personalLoansUnavailable;
  const lastSaved = useRef<DayRow | null>(null);
  useEffect(() => {
    if (!ready) return;
    const saved = lastSaved.current?.day === liveRow.day ? lastSaved.current : days.find(d => d.day === liveRow.day);
    if (sameDayRow(saved, liveRow)) return;
    // Nothing counted yet and nothing saved: there is no reading worth keeping.
    if (!saved && liveRow.net === 0 && included.size === 0) return;
    const timer = window.setTimeout(() => {
      lastSaved.current = liveRow;
      saveDay(liveRow).catch(() => { lastSaved.current = null; });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [ready, liveRow, days, included.size, saveDay]);

  // ── What counts ──
  const toggleAccount = (id: string) => {
    const next = new Set(included);
    if (next.has(id)) next.delete(id); else next.add(id);
    saveSettings({ includedAccounts: [...next], usdRate: settings?.usdRate ?? null, egpRate: settings?.egpRate ?? null })
      .catch(() => toast.error(L('Could not save. Try again.', 'تعذّر الحفظ. حاول مرة أخرى.')));
  };
  const setGroup = (ids: string[], on: boolean) => {
    const next = new Set(included);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    saveSettings({ includedAccounts: [...next], usdRate: settings?.usdRate ?? null, egpRate: settings?.egpRate ?? null })
      .catch(() => toast.error(L('Could not save. Try again.', 'تعذّر الحفظ. حاول مرة أخرى.')));
  };
  const [rateDraft, setRateDraft] = useState<{ usd: string; egp: string } | null>(null);
  const rates = rateDraft ?? { usd: settings?.usdRate ? String(settings.usdRate) : '', egp: settings?.egpRate ? String(settings.egpRate) : '' };
  const commitRates = () => {
    if (!rateDraft) return;
    const usd = Number(rateDraft.usd);
    const egp = Number(rateDraft.egp);
    saveSettings({ includedAccounts: settings?.includedAccounts ?? [], usdRate: usd > 0 ? usd : null, egpRate: egp > 0 ? egp : null })
      .then(() => setRateDraft(null))
      .catch(() => toast.error(L('Could not save. Try again.', 'تعذّر الحفظ. حاول مرة أخرى.')));
  };

  // ── History ──
  const rows = useMemo(() => [...days.filter(d => d.day !== today), liveRow], [days, today, liveRow]);
  const months = useMemo(() => monthsAvailable(rows, today), [rows, today]);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked && months.includes(picked) ? picked : months[0];
  const summary = useMemo(() => summariseMonth(rows, month), [rows, month]);
  const monthLabel = new Date(`${month}-15T12:00:00`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' });
  const monthIndex = months.indexOf(month);

  const [exporting, setExporting] = useState(false);
  const exportPdf = async () => {
    setExporting(true);
    try {
      const lineName = (k: LineKey) => lineTitle(k);
      const html = buildPositionReportHtml({
        labels: {
          title: L('Net position', 'صافي المركز'), opening: L('Opening', 'الافتتاح'), closing: L('Closing', 'الإغلاق'), change: L('Change', 'التغيّر'),
          line: Object.fromEntries(LINE_ORDER.map(k => [k, lineName(k)])) as Record<LineKey, string>,
          daily: L('Day by day', 'يومًا بيوم'), day: L('Day', 'اليوم'), net: L('Net position', 'صافي المركز'),
          firstDayNote: L('No earlier day was saved, so this month opens at its first saved day.', 'لم يُحفظ يوم أسبق، لذا يبدأ هذا الشهر من أول يوم محفوظ.'),
          rates: L('Rates used', 'الأسعار المستخدمة'),
          footer: L('All amounts in QAR. USD and EGP are converted by USDT cost. USDT is only the live balance on the exchanges.', 'كل المبالغ بالريال. الدولار والجنيه يُحوَّلان بتكلفة USDT. الـ USDT هو الرصيد الحالي على المنصات فقط.'),
          generatedOn: L('Generated', 'أُنشئ في'),
        },
        monthLabel, summary, rates: position.rates, dir: t.isRTL ? 'rtl' : 'ltr', generatedOn: new Date().toLocaleDateString(),
      });
      await exportPositionPdf(html, `net-position-${month}.pdf`);
    } catch (err) {
      console.error('Net position export failed', err);
      toast.error(L('Could not create the PDF.', 'تعذّر إنشاء ملف PDF.'));
    } finally {
      setExporting(false);
    }
  };

  // ── Lines ──
  function lineTitle(k: LineKey): string {
    return {
      cash_hand: L('Cash in hand', 'النقد في اليد'),
      cash_bank: L('Money in banks', 'الأموال في البنوك'),
      exchange_usdt: L('USDT on exchanges', 'USDT على المنصات'),
      customer_loans: L('Customer loans', 'ديون العملاء'),
      personal_loans: L('Personal loans', 'القروض الشخصية'),
    }[k];
  }
  const accounts = countableAccounts(state.cashAccounts || []);
  const accountsOf = (k: LineKey) => accounts.filter(a => (k === 'cash_bank' ? a.type === 'bank' : a.type === 'hand'));
  const [open, setOpen] = useState<Record<string, boolean>>({ cash_hand: true });

  const lineBody = (line: PositionLine) => {
    if (line.key === 'cash_hand' || line.key === 'cash_bank') {
      const list = accountsOf(line.key);
      if (list.length === 0) return <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L('No accounts of this kind. Add one in Cash Management.', 'لا توجد حسابات من هذا النوع. أضف حسابًا من إدارة النقد.')}</div>;
      const ids = list.map(a => a.id);
      const allOn = ids.every(id => included.has(id));
      return (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
            {L('Tick the accounts that count. Each counts its whole balance. Money you add in Cash Management is included automatically.', 'حدّد الحسابات التي تُحتسب. كل حساب يُحتسب برصيده كاملًا. ما تضيفه في إدارة النقد يُحتسب تلقائيًا.')}
          </div>
          <button type="button" className="rowBtn" style={{ alignSelf: 'flex-start', fontSize: 10 }} onClick={() => setGroup(ids, !allOn)}>
            {allOn ? L('Untick all', 'إلغاء تحديد الكل') : L('Tick all', 'تحديد الكل')}
          </button>
          {list.map(a => {
            const balance = getAccountBalance(a.id, state.cashLedger || []);
            const counted = line.details.find(d => d.id === a.id);
            return (
              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={included.has(a.id)} onChange={() => toggleAccount(a.id)} aria-label={a.name} />
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{a.name}</span>
                <span className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{money(balance)} {a.currency}</span>
                <span className="mono" style={{ minWidth: 70, textAlign: 'end', fontWeight: 700 }}>{counted ? money(counted.qar) : '—'}</span>
              </label>
            );
          })}
        </>
      );
    }
    if (line.key === 'exchange_usdt') {
      return (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
            {L('Only the USDT sitting on the exchanges right now, priced at your USDT buying cost. USDT coming in or going out is never counted.', 'فقط الـ USDT الموجود على المنصات الآن، بسعر تكلفة شرائك. لا يُحتسب أي USDT داخل أو خارج.')}
          </div>
          {exchange === null && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L('Loading the exchange balances…', 'جارٍ تحميل أرصدة المنصات…')}</div>}
          {exchange !== null && line.details.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L('No USDT balance found. Connect and sync Binance or OKX in Stock.', 'لا يوجد رصيد USDT. اربط Binance أو OKX وزامنه من المخزون.')}</div>}
          {line.details.map(d => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
              <span>{d.label}</span>
              <span className="mono">{money(d.original?.amount ?? 0)} USDT · <b>{money(d.qar)}</b></span>
            </div>
          ))}
        </>
      );
    }
    if (line.key === 'customer_loans') {
      return (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
            {L('Every loan recorded in the system that is still unpaid, by customer. It updates as repayments are recorded.', 'كل قرض مسجّل في النظام لم يُسدَّد بعد، حسب العميل. يتحدّث مع تسجيل السداد.')}
          </div>
          {line.details.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L('No unpaid loans.', 'لا توجد ديون غير مسدّدة.')}</div>}
          {line.details.map(d => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '3px 0' }}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{d.label}</span>
              <span className="mono">{d.original && d.original.unit !== 'QAR' ? `${money(d.original.amount)} ${d.original.unit} · ` : ''}<b>{money(d.qar)}</b></span>
            </div>
          ))}
        </>
      );
    }
    return (
      <>
        {line.details.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L('No personal loans. Add one below.', 'لا توجد قروض شخصية. أضف قرضًا أدناه.')}</div>}
        {line.details.map(d => (
          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '3px 0' }}>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{d.label}</span>
            <span className="mono">{d.original && d.original.unit !== 'QAR' ? `${money(d.original.amount)} ${d.original.unit} · ` : ''}<b>{money(d.qar)}</b></span>
          </div>
        ))}
      </>
    );
  };

  const field: React.CSSProperties = { width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12, textAlign: 'end' };
  const unavailable = settingsUnavailable || daysUnavailable;

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: isMobile ? '6px 8px' : 12, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760, marginInline: 'auto', width: '100%' }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>⚖️ {t('npNavTitle')}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L('What you have right now: cash, banks, USDT on exchanges, and what people owe you.', 'ما تملكه الآن: النقد والبنوك وUSDT على المنصات وما يدين لك به الناس.')}</div>
      </div>

      {unavailable && <div role="alert" style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {L('Saving is not available yet. The numbers below are still live.', 'الحفظ غير متاح بعد. الأرقام أدناه لا تزال حيّة.')}</div>}

      {/* ── Right now ── */}
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{L('Net position now', 'صافي المركز الآن')}</div>
        <div className="mono" style={{ fontSize: 28, fontWeight: 800 }}>{money(position.netQAR)} <span style={{ fontSize: 13, color: 'var(--muted)' }}>QAR</span></div>
        {position.warnings.includes('usdt_unpriced') && <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 4 }}>⚠ {L('There is no USDT buying price yet, so USDT is not valued.', 'لا يوجد سعر شراء USDT بعد، لذا لا يُقيَّم الـ USDT.')}</div>}
        {position.warnings.includes('egp_unpriced') && <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 4 }}>⚠ {L('There is no EGP rate yet, so EGP amounts are not valued. Type one below.', 'لا يوجد سعر للجنيه بعد، لذا لا تُقيَّم مبالغ الجنيه. اكتب سعرًا أدناه.')}</div>}
      </div>

      {/* ── The five lines ── */}
      {position.lines.map(line => (
        <div key={line.key} className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setOpen(o => ({ ...o, [line.key]: !o[line.key] }))}
            aria-expanded={!!open[line.key]}
            style={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{open[line.key] ? '▾' : '▸'} {lineTitle(line.key)}</span>
              <span className="mono" style={{ fontSize: 16, fontWeight: 800 }}>{money(line.qar)}</span>
            </span>
            <span style={{ height: 4, borderRadius: 2, background: 'var(--line)', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${position.netQAR > 0 ? Math.max(0, Math.min(100, (line.qar / position.netQAR) * 100)) : 0}%`, background: 'var(--brand)' }} />
            </span>
          </button>
          {open[line.key] && (
            <div style={{ padding: '2px 14px 12px', display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              {lineBody(line)}
            </div>
          )}
        </div>
      ))}

      {/* ── Rates ── */}
      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{L('Rates', 'الأسعار')}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L('Leave empty to use the automatic rate. Used for USD and EGP amounts.', 'اتركه فارغًا لاستخدام السعر التلقائي. يُستخدم لمبالغ الدولار والجنيه.')}</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {L('QAR per USD', 'ريال لكل دولار')}
            <input inputMode="decimal" style={field} placeholder={position.rates.usdToQar.toFixed(2)} value={rates.usd} aria-label="QAR per USD"
              onChange={e => { if (/^\d*\.?\d*$/.test(e.target.value)) setRateDraft({ ...rates, usd: e.target.value }); }} onBlur={commitRates} />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {L('EGP per USDT', 'جنيه لكل USDT')}
            <input inputMode="decimal" style={field} placeholder={position.rates.egpPerUsdt ? position.rates.egpPerUsdt.toFixed(2) : '—'} value={rates.egp} aria-label="EGP per USDT"
              onChange={e => { if (/^\d*\.?\d*$/.test(e.target.value)) setRateDraft({ ...rates, egp: e.target.value }); }} onBlur={commitRates} />
          </label>
        </div>
      </div>

      {/* ── Personal loans: add and repay ── */}
      <PersonalLoansPanel state={state} applyState={applyState} loans={personalLoans} unavailable={personalLoansUnavailable} lang={lang} />

      {/* ── Month by month ── */}
      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{L('Month by month', 'شهرًا بشهر')}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {L('Today’s position is saved automatically once you open this page. A month opens at the last saved day before it and closes at its last saved day.', 'يُحفظ مركز اليوم تلقائيًا عند فتح هذه الصفحة. يبدأ الشهر من آخر يوم محفوظ قبله وينتهي عند آخر يوم محفوظ فيه.')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <button type="button" className="rowBtn" onClick={() => setPicked(months[monthIndex + 1])} disabled={monthIndex >= months.length - 1} aria-label="previous month">‹</button>
          <div style={{ fontSize: 15, fontWeight: 800, minWidth: 150, textAlign: 'center' }}>{monthLabel}</div>
          <button type="button" className="rowBtn" onClick={() => setPicked(months[monthIndex - 1])} disabled={monthIndex <= 0} aria-label="next month">›</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { k: L('Opening', 'الافتتاح'), v: summary.opening ? money(summary.opening.net) : '—', c: undefined as string | undefined },
            { k: L('Closing', 'الإغلاق'), v: summary.closing ? money(summary.closing.net) : '—', c: undefined },
            { k: L('Change', 'التغيّر'), v: money(summary.change, true), c: signColor(summary.change) },
          ].map(c => (
            <div key={c.k} style={{ flex: '1 1 90px', minWidth: 90, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{c.k}</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: c.c }}>{c.v}</div>
            </div>
          ))}
        </div>
        {summary.openingIsFirstDay && (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L('No earlier day was saved, so this month opens at its first saved day.', 'لم يُحفظ يوم أسبق، لذا يبدأ هذا الشهر من أول يوم محفوظ.')}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '4px 12px', fontSize: 12 }}>
          <span />
          {[L('Opening', 'الافتتاح'), L('Closing', 'الإغلاق'), L('Change', 'التغيّر')].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'end', textTransform: 'uppercase' }}>{h}</span>
          ))}
          {summary.perLine.map(l => (
            <div key={l.key} style={{ display: 'contents' }}>
              <span>{lineTitle(l.key)}</span>
              <span className="mono" style={{ textAlign: 'end', color: 'var(--muted)' }}>{money(l.opening)}</span>
              <span className="mono" style={{ textAlign: 'end' }}>{money(l.closing)}</span>
              <span className="mono" style={{ textAlign: 'end', color: signColor(l.change) }}>{money(l.change, true)}</span>
            </div>
          ))}
        </div>

        <DayBars days={summary.days} label={L('Net position per saved day', 'صافي المركز لكل يوم محفوظ')} />
        {summary.days.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
            {[...summary.days].reverse().map(d => (
              <div key={d.day} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderTop: '1px solid var(--line)' }}>
                <span className="mono">{d.day}</span>
                <span className="mono" style={{ color: signColor(d.change ?? 0) }}>{d.change == null ? '' : money(d.change, true)}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{money(d.net)}</span>
              </div>
            ))}
          </div>
        )}
        <div>
          <button type="button" className="btn secondary" disabled={exporting || !summary.closing} onClick={() => { void exportPdf(); }}>
            📄 {exporting ? L('Creating…', 'جارٍ الإنشاء…') : L('Export PDF', 'تصدير PDF')}
          </button>
        </div>
      </div>
    </div>
  );
}
