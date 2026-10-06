import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useTheme } from '@/lib/theme-context';
import { useTrackerState } from '@/lib/useTrackerState';
import { useIsMobile } from '@/hooks/use-mobile';
import { useT, type TranslationKey } from '@/lib/i18n';
import { deriveCashQAR, fmtTotal, getAccountBalance, uid, type CashLedgerEntry } from '@/lib/tracker-helpers';
import {
  amountToQar, applyOpeningOverride, computeMonthBridge, computeNetPosition, lineChangesOf, loanLedgerEntryIds, computeMonthPosition, type NetPositionLineKey,
} from '@/lib/trading/net-position';
import { EXPENSE_CATEGORIES, isUncategorised, type ExpenseGroup } from '@/lib/trading/expense-categories';
import { useMonthClosing, useMonthlySnapshots, useOpeningOverrideSaving, useOpeningOverrides, usePersonalLoans } from '@/features/net-position/api';
import { useExchangeBalances } from '@/features/exchanges/hooks/useExchangeBalances';
import { useExchangeP2POrders } from '@/features/exchanges/hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '@/features/exchanges/hooks/useExchangeTransfers';
import { PersonalLoansPanel } from '@/features/net-position/components/PersonalLoansPanel';
import { MANUAL_LINE_KEYS, manualOpeningTotal, offsetsFor, offsetsFromManual, recordedLineValue, type OpeningOverride } from '@/features/net-position/overrides';
import { buildNetPositionReportHtml, exportNetPositionPdf } from '@/features/net-position/report';
import { chainToFrozenOpening, closingDrift, previousMonthKey, snapshotRates } from '@/features/net-position/snapshots';
import '@/styles/tracker.css';
import { ModernSelect } from '@/components/shared/ModernSelect';

const OVERRIDES_KEY = 'net_position_rates';

const LINE_LABEL: Record<NetPositionLineKey, TranslationKey> = {
  cash_hand: 'npLineCashHand',
  cash_bank: 'npLineCashBank',
  cash_vault: 'npLineCashVault',
  cash_custody: 'npLineCashCustody',
  usdt_in_accounts: 'npLineUsdtAccounts',
  stock: 'npLineStock',
  customer_loans: 'npLineCustomerLoans',
  merchant_lent: 'npLineMerchantLent',
  merchant_borrowed: 'npLineMerchantBorrowed',
  exchange_usdt: 'npLineExchangeUsdt',
  personal_loans: 'npLinePersonalLoans',
  manual_other: 'npLineManualOther',
};

const CATEGORY_LABEL: Record<string, TranslationKey> = {
  rent: 'expCatRent',
  salaries: 'expCatSalaries',
  fees: 'expCatFees',
  transport: 'expCatTransport',
  communication: 'expCatCommunication',
  loss: 'expCatLoss',
  business_other: 'expCatBusinessOther',
  owner_draw: 'expCatOwnerDraw',
  personal_spending: 'expCatPersonalSpending',
};

const MONTH_KEYS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;

function readOverrides(): { usd: string; egp: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
    return { usd: String(raw.usd ?? ''), egp: String(raw.egp ?? '') };
  } catch {
    return { usd: '', egp: '' };
  }
}

const numeric = (v: string) => v === '' || /^\d*\.?\d*$/.test(v);

/** A category picker grouped into business and personal. */
function CategorySelect({ value, onChange, t }: { value: string; onChange: (key: string) => void; t: ReturnType<typeof useT> }) {
  const groups: ExpenseGroup[] = ['business', 'personal'];
  return (
    <ModernSelect value={value} onChange={e => onChange(e.target.value)}
      style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12, minWidth: 0 }}>
      <option value="">{t('npPick')}</option>
      {groups.map(g => (
        <optgroup key={g} label={g === 'business' ? t('expGroupBusiness') : t('expGroupPersonal')}>
          {EXPENSE_CATEGORIES.filter(c => c.group === g).map(c => <option key={c.key} value={c.key}>{t(CATEGORY_LABEL[c.key])}</option>)}
        </optgroup>
      ))}
    </ModernSelect>
  );
}

export default function NetPositionPage() {
  const { settings } = useTheme();
  const isMobile = useIsMobile();
  const t = useT();
  const { state, applyState } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
  });

  const now = new Date();
  // A reminder links here with ?month=YYYY-MM so the month to close is already open.
  const [searchParams] = useSearchParams();
  const [ym, setYm] = useState(() => {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(searchParams.get('month') || '');
    return m ? { year: Number(m[1]), month: Number(m[2]) - 1 } : { year: now.getFullYear(), month: now.getMonth() };
  });
  const [rates, setRates] = useState(readOverrides);
  useEffect(() => {
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(rates)); } catch { /* per-viewer convenience only */ }
  }, [rates]);

  const { loans: personalLoans, unavailable: personalLoansUnavailable } = usePersonalLoans();
  // USDT on Binance and OKX: today's synced balance, and every recorded movement so earlier balances can be worked back from it.
  const { data: exchangeBalances } = useExchangeBalances();
  const { data: exchangeOrders } = useExchangeP2POrders({ includeDismissed: true });
  const { data: exchangeTransfers } = useExchangeTransfers();
  const exchangeUsdt = useMemo(() => {
    if (!exchangeBalances) return undefined;
    const byExchange = { binance: 0, okx: 0 };
    for (const b of exchangeBalances) if (b.asset === 'USDT') byExchange[b.exchange] += b.free + b.locked;
    const flows: Array<{ ts: number; deltaUSDT: number }> = [];
    for (const o of exchangeOrders ?? []) {
      if (String(o.asset).toUpperCase() !== 'USDT' || !o.order_time) continue;
      flows.push({ ts: new Date(o.order_time).getTime(), deltaUSDT: o.side === 'sell' ? -Number(o.amount) : Number(o.amount) });
    }
    for (const tr of exchangeTransfers ?? []) {
      if (String(tr.asset).toUpperCase() !== 'USDT' || !tr.transfer_time) continue;
      flows.push({ ts: new Date(tr.transfer_time).getTime(), deltaUSDT: tr.direction === 'out' ? -Number(tr.amount) : Number(tr.amount) });
    }
    return { nowUSDT: byExchange.binance + byExchange.okx, byExchange, flows };
  }, [exchangeBalances, exchangeOrders, exchangeTransfers]);
  const options = useMemo(() => ({
    usdToQar: Number(rates.usd) > 0 ? Number(rates.usd) : undefined,
    egpPerUsdt: Number(rates.egp) > 0 ? Number(rates.egp) : undefined,
    personalLoans,
    exchangeUsdt,
  }), [rates, personalLoans, exchangeUsdt]);

  const recorded = useMemo(() => computeMonthPosition(state, ym.year, ym.month, options), [state, ym, options]);
  // A starting position entered by hand moves the month (and every later one) by what it differs from the records.
  const { overrides, unavailable: overridesUnavailable } = useOpeningOverrides();
  const openingSaving = useOpeningOverrideSaving();
  const manual = useMemo(() => offsetsFor(overrides, recorded.key), [overrides, recorded.key]);
  const live = useMemo(() => (manual ? applyOpeningOverride(recorded, manual.offsets) : recorded), [recorded, manual]);
  const liveBridge = useMemo(
    () => computeMonthBridge(state, live, loanLedgerEntryIds(state.customerLoans, personalLoans)),
    [state, live, personalLoans],
  );

  // A closed month shows the figures it was frozen with; any other month
  // opens from the frozen closing of the month before it.
  const { snapshots, unavailable } = useMonthlySnapshots();
  const closing = useMonthClosing();
  const snap = snapshots.get(live.key);
  const frozen = !!snap?.frozen;
  const chained = useMemo(
    () => chainToFrozenOpening({ opening: live.opening.netQAR, bridge: liveBridge }, snapshots.get(previousMonthKey(live.key))),
    [live, liveBridge, snapshots],
  );
  const month = frozen && snap ? snap.position : live;
  const bridge = frozen && snap ? snap.bridge : chained.bridge;
  const openingQAR = bridge.openingQAR;
  const changeQAR = Math.round((month.closing.netQAR - openingQAR) * 100) / 100;
  const drift = frozen && snap ? closingDrift(snap, live) : 0;
  // Why the customer-loans line can differ from the Unpaid figure on the loans screen: that one is as of today,
  // this one as of the start of the month, so repayments dated since then are the gap.
  const todayPos = useMemo(() => computeNetPosition(state, Date.now(), options), [state, options]);
  const loanRecon = useMemo(() => {
    const todayLoans = todayPos.lines.find(l => l.key === 'customer_loans')?.amountQAR ?? 0;
    const deleted = new Set(state.deletedLoanIds || []);
    let repaidSince = 0;
    for (const loan of state.customerLoans || []) {
      if (deleted.has(loan.id)) continue;
      for (const r of loan.repayments || []) {
        if (r.ts > recorded.opening.asOf) repaidSince += amountToQar(todayPos, loan.currency, Number(r.amount) || 0);
      }
    }
    return { todayLoans, repaidSince: Math.round(repaidSince * 100) / 100 };
  }, [state, todayPos, recorded.opening.asOf]);

  // ── Setting the starting position by hand ──
  const [editingOpening, setEditingOpening] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const ownOverride = overrides.get(recorded.key);
  const startEditingOpening = () => {
    const next: Record<string, string> = {};
    for (const key of MANUAL_LINE_KEYS) {
      const value = ownOverride?.manual[key] ?? recordedLineValue(live.opening, key);
      next[key] = value ? String(value) : '';
    }
    setDraft(next);
    setEditingOpening(true);
  };
  /** What a line would close the month at if the starting figure typed for it were used: the month's own movement is added on top. */
  const closingPreview = (key: NetPositionLineKey) =>
    Math.round((recordedLineValue(recorded.closing, key) + ((Number(draft[key]) || 0) - recordedLineValue(recorded.opening, key))) * 100) / 100;
  /** The figure typed is today's balance although the line has moved since the first day: the month's movement would be counted twice. */
  const looksLikeToday = (key: NetPositionLineKey) => {
    const typed = Number(draft[key]);
    if (!draft[key] || !Number.isFinite(typed)) return false;
    const today = recordedLineValue(todayPos, key);
    return Math.abs(typed - today) < 1 && Math.abs(today - recordedLineValue(recorded.opening, key)) >= 1;
  };
  const anyLooksLikeToday = MANUAL_LINE_KEYS.some(looksLikeToday);
  const previewBelowZero = MANUAL_LINE_KEYS.some(k => k !== 'manual_other' && closingPreview(k) < -0.005);

  const draftManual = useMemo(() => {
    const out: OpeningOverride['manual'] = {};
    for (const key of MANUAL_LINE_KEYS) out[key] = Number(draft[key]) || 0;
    return out;
  }, [draft]);
  const saveOpening = async () => {
    setOpeningBusy(true);
    try {
      await openingSaving.save(recorded.key, draftManual, offsetsFromManual(recorded.opening, draftManual));
      setEditingOpening(false);
      toast.success(t('npOpeningSaved'));
    } catch { toast.error(t('npClosingFailed')); } finally { setOpeningBusy(false); }
  };
  const clearOpening = async () => {
    setOpeningBusy(true);
    try {
      await openingSaving.clear(recorded.key);
      setEditingOpening(false);
      toast.success(t('npOpeningCleared'));
    } catch { toast.error(t('npClosingFailed')); } finally { setOpeningBusy(false); }
  };
  const [openingBusy, setOpeningBusy] = useState(false);
  const [closingBusy, setClosingBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportPdf = async () => {
    setExporting(true);
    try {
      const labels = {
        title: t('npReportTitle'), statusFrozen: t('npReportFrozen'), statusLive: t('npReportLive'),
        opening: t('npOpening'), closing: t('npClosing'), change: t('npChange'), revenue: t('npRevenue'),
        bridge: t('npBridge'), reference: t('npForReference'), business: t('npBusiness'), personal: t('npPersonal'), uncategorised: t('npUncategorised'),
        priorCorrections: t('npPriorCorrectionsRow'),
        breakdown: t('npBreakdown'), assets: t('npAssets'), liabilities: t('npLiabilities'), rates: t('npReportRates'),
        usdRate: t('npUsdRate'), usdtRate: t('npReportUsdtRate'), egpRate: t('npReportEgpRate'),
        footer: t('npReportFooter'), generatedOn: t('npReportGenerated'),
        lines: Object.fromEntries((Object.keys(LINE_LABEL) as NetPositionLineKey[]).map(k => [k, t(LINE_LABEL[k])])) as Record<NetPositionLineKey, string>,
        categories: Object.fromEntries(Object.entries(CATEGORY_LABEL).map(([k, v]) => [k, t(v)])),
      };
      const html = buildNetPositionReportHtml({
        labels, monthLabel, month, bridge, dir: t.isRTL ? 'rtl' : 'ltr', generatedOn: new Date().toLocaleDateString(),
        frozenAt: frozen && snap ? new Date(snap.closedAt).toLocaleDateString() : null,
      });
      await exportNetPositionPdf(html, `net-position-${month.key}.pdf`);
    } catch (err) {
      console.error('Net position export failed', err);
      toast.error(t('npExportFailed'));
    } finally {
      setExporting(false);
    }
  };
  const runClosing = async (fn: () => Promise<void>, message: string) => {
    setClosingBusy(true);
    try { await fn(); toast.success(message); } catch { toast.error(t('npClosingFailed')); } finally { setClosingBusy(false); }
  };
  const monthLabel = `${t(MONTH_KEYS[ym.month])} ${ym.year}`;
  const isCurrent = ym.year === now.getFullYear() && ym.month === now.getMonth();
  const shift = (delta: number) => setYm(prev => {
    const d = new Date(prev.year, prev.month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const money = (n: number, signed = false) => `${signed && n > 0 ? '+' : ''}${fmtTotal(n)}`;
  const signColor = (n: number) => (n > 0.005 ? 'var(--good)' : n < -0.005 ? 'var(--bad)' : 'var(--muted)');

  // ── Categorising ──
  const uncategorised = useMemo(
    () => (state.cashLedger || []).filter(e => isUncategorised(e) && e.ts >= month.start && e.ts <= month.end).sort((a, b) => b.ts - a.ts),
    [state.cashLedger, month.start, month.end],
  );
  const accountName = (id: string) => (state.cashAccounts || []).find(a => a.id === id)?.name || '';
  const setCategory = (id: string, key: string) => {
    if (!key) return;
    applyState({ ...state, cashLedger: (state.cashLedger || []).map(e => (e.id === id ? { ...e, expenseCategory: key } : e)) });
    toast.success(t('npCategorised'));
  };

  // ── Recording an expense ──
  const accounts = useMemo(() => (state.cashAccounts || []).filter(a => a.status === 'active' && a.type !== 'merchant_custody'), [state.cashAccounts]);
  const [form, setForm] = useState({ accountId: '', amount: '', category: '', note: '' });
  const accountId = form.accountId || accounts[0]?.id || '';
  const saveExpense = () => {
    const account = accounts.find(a => a.id === accountId);
    const amount = Number(form.amount);
    if (!account || !(amount > 0) || !form.category) return;
    if (amount > getAccountBalance(account.id, state.cashLedger || [])) { toast.error(t('npInsufficient')); return; }
    const entry: CashLedgerEntry = {
      id: uid(), ts: Date.now(), type: 'withdrawal', accountId: account.id, direction: 'out', amount,
      currency: account.currency, note: form.note.trim() || undefined, expenseCategory: form.category,
    };
    const ledger = [...(state.cashLedger || []), entry];
    applyState({ ...state, cashLedger: ledger, cashQAR: deriveCashQAR(state.cashAccounts, ledger) });
    setForm({ accountId: '', amount: '', category: '', note: '' });
    toast.success(t('npSaved'));
  };

  const card = (label: string, value: string, color?: string, hint?: string) => (
    <div className="panel" style={{ padding: 10, flex: 1, minWidth: isMobile ? '45%' : 140 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 17, fontWeight: 800, color: color || 'var(--text)' }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{hint}</div>}
    </div>
  );
  const row = (label: string, amount: number, opts: { sign?: '+' | '-'; muted?: boolean; bold?: boolean; indent?: boolean } = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', paddingInlineStart: opts.indent ? 14 : 0, fontSize: 12, fontWeight: opts.bold ? 800 : 500, color: opts.muted ? 'var(--muted)' : 'var(--text)' }}>
      <span>{label}</span>
      <span className="mono" style={{ color: opts.sign ? (opts.sign === '+' ? 'var(--good)' : 'var(--bad)') : undefined }}>
        {opts.sign === '-' && amount ? '−' : opts.sign === '+' && amount ? '+' : ''}{money(Math.abs(amount) < 0.005 ? 0 : opts.sign ? Math.abs(amount) : amount)}
      </span>
    </div>
  );

  const lineAmount = (pos: typeof month.opening, key: NetPositionLineKey) => pos.lines.find(l => l.key === key)?.amountQAR ?? 0;
  const lineKeys = (Object.keys(LINE_LABEL) as NetPositionLineKey[]).filter(k => lineAmount(month.opening, k) || lineAmount(month.closing, k));
  const pos = month.closing;
  const warnings = [...new Set([...month.opening.warnings, ...month.closing.warnings])];

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: isMobile ? '6px 8px' : 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>⚖️ {t('npNavTitle')}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('npSubtitle')}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <button type="button" className="rowBtn" onClick={() => shift(-1)} aria-label="previous month">‹</button>
        <div style={{ textAlign: 'center', minWidth: 150 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{monthLabel}</div>
          {month.open && <div style={{ fontSize: 10, color: 'var(--warn)' }}>{t('npInProgress')}</div>}
        </div>
        <button type="button" className="rowBtn" onClick={() => shift(1)} disabled={isCurrent} aria-label="next month">›</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {card(t('npOpening'), `${money(openingQAR)} QAR`)}
        {card(t('npClosing'), `${money(month.closing.netQAR)} QAR`)}
        {card(t('npChange'), `${money(changeQAR, true)} QAR`, signColor(changeQAR))}
        {card(t('npRevenue'), `${money(bridge.netRevenueQAR, true)} QAR`, signColor(bridge.netRevenueQAR))}
      </div>

      <div>
        <button type="button" className="btn secondary" disabled={exporting} onClick={() => { void exportPdf(); }}>
          📄 {exporting ? t('npExporting') : t('npExportPdf')}
        </button>
      </div>

      {/* ── Starting position by hand ── */}
      <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {manual && (
          <div style={{ fontSize: 11, color: 'var(--warn)' }}>
            ✎ {(manual.from === recorded.key ? t('npManualActive') : t('npManualCarried')).split('{month}').join(manual.from)}
          </div>
        )}
        {overridesUnavailable && <div style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {t('npOpeningsUnavailable')}</div>}
        {!editingOpening && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn secondary" disabled={frozen || overridesUnavailable} onClick={startEditingOpening}>
              ✎ {t('npSetOpening')}
            </button>
            {frozen && <span style={{ fontSize: 10, color: 'var(--muted)' }}>{t('npManualFrozenNote')}</span>}
          </div>
        )}
        {editingOpening && (
          <>
            <div style={{ fontSize: 12, fontWeight: 800 }}>{t('npOpeningEditTitle').split('{month}').join(monthLabel)}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('npOpeningEditHint')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto 120px auto', gap: '6px 10px', alignItems: 'center', fontSize: 12 }}>
              <span />
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'end' }}>{t('npColRecords')}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'end' }}>{t('npColToday')}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('npColYours')}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'end' }}>{t('npColClosingWould')}</span>
              {MANUAL_LINE_KEYS.map(key => (
                <div key={key} style={{ display: 'contents' }}>
                  <span>{t(LINE_LABEL[key])}</span>
                  <span className="mono" style={{ textAlign: 'end', color: 'var(--muted)' }}>{money(recordedLineValue(recorded.opening, key))}</span>
                  <button type="button" className="rowBtn mono" style={{ fontSize: 11, justifySelf: 'end' }} title={t('npUseToday')}
                    onClick={() => setDraft({ ...draft, [key]: String(recordedLineValue(todayPos, key)) })}>
                    {money(recordedLineValue(todayPos, key))}
                  </button>
                  <input inputMode="decimal" value={draft[key] ?? ''} aria-label={t(LINE_LABEL[key])}
                    onChange={e => { if (/^-?\d*\.?\d*$/.test(e.target.value)) setDraft({ ...draft, [key]: e.target.value }); }}
                    style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12, minWidth: 0 }} />
                  <span className="mono" style={{ textAlign: 'end', color: closingPreview(key) < -0.005 && key !== 'manual_other' ? 'var(--bad)' : 'var(--muted)' }}>
                    {looksLikeToday(key) && <span title={t('npLooksToday')} style={{ color: 'var(--warn)', marginInlineEnd: 4 }}>⚠</span>}
                    {money(closingPreview(key))}
                  </span>
                  {key === 'customer_loans' && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--muted)' }}>
                      {t('npLoansToday').split('{today}').join(money(loanRecon.todayLoans)).split('{repaid}').join(money(loanRecon.repaidSince))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('npTodayCaution')}</div>
            {anyLooksLikeToday && <div role="alert" style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {t('npLooksTodayWarn')}</div>}
            {previewBelowZero && <div role="alert" style={{ fontSize: 11, color: 'var(--bad)' }}>⚠ {t('npNegativeWarn')}</div>}
            <button type="button" className="rowBtn" style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                const next: Record<string, string> = {};
                for (const key of MANUAL_LINE_KEYS) { const v = recordedLineValue(todayPos, key); next[key] = v ? String(v) : ''; }
                setDraft(next);
              }}>
              {t('npUseTodayAll')}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <span>{t('npTotalYours')}</span>
              <span className="mono">{money(manualOpeningTotal(draftManual))} QAR</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
              <span>{t('npDiffFromRecords')}</span>
              <span className="mono">{money(Math.round((manualOpeningTotal(draftManual) - recorded.opening.netQAR) * 100) / 100, true)} QAR</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn" disabled={openingBusy} onClick={() => { void saveOpening(); }}>{t('npSaveOpening')}</button>
              <button type="button" className="btn secondary" disabled={openingBusy} onClick={() => setEditingOpening(false)}>{t('cancel')}</button>
              {ownOverride && <button type="button" className="rowBtn" disabled={openingBusy} onClick={() => { void clearOpening(); }}>{t('npUseRecords')}</button>}
            </div>
          </>
        )}
      </div>

      {/* ── Closing ── */}
      <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {unavailable && <div style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {t('npClosingUnavailable')}</div>}
        {!unavailable && frozen && snap && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700 }}>🔒 {t('npClosedOn').split('{date}').join(new Date(snap.closedAt).toLocaleDateString())}</div>
            {drift !== 0 && (
              <div role="alert" style={{ fontSize: 11, color: 'var(--warn)' }}>
                ⚠ {t('npDrift').split('{amount}').join(money(drift, true))}
              </div>
            )}
          </>
        )}
        {!unavailable && !frozen && snap && snap.reopenCount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('npReopened').split('{count}').join(String(snap.reopenCount))}</div>
        )}
        {!unavailable && !frozen && chained.priorCorrectionsQAR !== 0 && (
          <div style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {t('npPriorCorrections').split('{amount}').join(money(chained.priorCorrectionsQAR, true))}</div>
        )}
        {!unavailable && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {frozen && snap ? (
              <>
                {drift !== 0 && (
                  <button type="button" className="btn secondary" disabled={closingBusy}
                    onClick={() => { void runClosing(() => closing.close(live.key, live, chained.bridge, snapshotRates(live), snap), t('npClosed')); }}>
                    {t('npRefreeze')}
                  </button>
                )}
                <button type="button" className="btn secondary" disabled={closingBusy}
                  onClick={() => { void runClosing(() => closing.reopen(snap), t('npReopenedDone')); }}>
                  {t('npReopen')}
                </button>
              </>
            ) : (
              <button type="button" className="btn" disabled={closingBusy || live.open}
                onClick={() => { void runClosing(() => closing.close(live.key, live, chained.bridge, snapshotRates(live), snap), t('npClosed')); }}>
                🔒 {t('npCloseMonth')}
              </button>
            )}
            {live.open && !frozen && <span style={{ fontSize: 10, color: 'var(--muted)', alignSelf: 'center' }}>{t('npCloseAfterMonth')}</span>}
          </div>
        )}
      </div>

      {warnings.includes('egp_unpriced') && <div role="alert" style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {t('npWarnEgp')}</div>}
      {warnings.includes('usdt_unpriced') && <div role="alert" style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {t('npWarnUsdt')}</div>}

      {/* ── What moved ── */}
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{t('npBridge')}</div>
        {row(t('npOpening'), bridge.openingQAR, { bold: true })}
        {!!bridge.priorCorrectionsQAR && row(t('npPriorCorrectionsRow'), bridge.priorCorrectionsQAR, { muted: true })}
        {lineChangesOf(month).map(c => row(t(LINE_LABEL[c.key]), c.changeQAR, { sign: c.changeQAR > 0 ? '+' : '-' }))}
        <div style={{ borderTop: '1px solid var(--line)', margin: '6px 0' }} />
        {row(t('npClosing'), month.closing.netQAR, { bold: true })}

        <div style={{ fontSize: 11, fontWeight: 800, margin: '12px 0 4px', color: 'var(--muted)' }}>{t('npForReference')}</div>
        {row(t('npRevenue'), bridge.netRevenueQAR, { muted: true })}
        {row(t('npBusiness'), bridge.businessTotalQAR, { muted: true })}
        {bridge.business.map(c => row(t(CATEGORY_LABEL[c.key]), c.amountQAR, { muted: true, indent: true }))}
        {row(t('npPersonal'), bridge.personalTotalQAR, { muted: true })}
        {bridge.personal.map(c => row(t(CATEGORY_LABEL[c.key]), c.amountQAR, { muted: true, indent: true }))}
        {bridge.uncategorisedQAR > 0 && row(`${t('npUncategorised')} (${bridge.uncategorisedCount})`, bridge.uncategorisedQAR, { muted: true })}
      </div>

      {/* ── Categorise ── */}
      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>{t('npCategorise')}</div>
        {uncategorised.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('npNoUncat')}</div>}
        {uncategorised.map(e => (
          <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div className="mono" style={{ fontSize: 12, fontWeight: 800 }}>−{fmtTotal(e.amount)} {e.currency}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                {new Date(e.ts).toLocaleDateString()} · {accountName(e.accountId)}{e.note ? ` · ${e.note}` : ''}
              </div>
            </div>
            <CategorySelect value="" onChange={key => setCategory(e.id, key)} t={t} />
          </div>
        ))}
      </div>

      {/* ── Record an expense ── */}
      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>{t('npAddExpense')}</div>
        {accounts.length === 0 ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('npNoAccounts')}</div> : (
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, minmax(0, 1fr))' }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('npAccount')}
              <ModernSelect value={accountId} onChange={e => setForm({ ...form, accountId: e.target.value })}
                style={{ width: '100%', marginTop: 4, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </ModernSelect>
            </label>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('amount')}
              <input inputMode="decimal" value={form.amount} onChange={e => { if (numeric(e.target.value)) setForm({ ...form, amount: e.target.value }); }}
                style={{ width: '100%', marginTop: 4, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }} />
            </label>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('expenseCategoryLabel')}
              <div style={{ marginTop: 4 }}><CategorySelect value={form.category} onChange={category => setForm({ ...form, category })} t={t} /></div>
            </label>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('note')}
              <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
                style={{ width: '100%', marginTop: 4, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }} />
            </label>
          </div>
        )}
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} disabled={!accountId || !(Number(form.amount) > 0) || !form.category} onClick={saveExpense}>{t('npSave')}</button>
      </div>

      <PersonalLoansPanel state={state} applyState={applyState} loans={personalLoans} unavailable={personalLoansUnavailable} lang={t.lang === 'ar' ? 'ar' : 'en'} />

      {/* ── Breakdown ── */}
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{t('npBreakdown')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '4px 14px', fontSize: 12, alignItems: 'baseline' }}>
          <span />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'end' }}>{t('npOpening')}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'end' }}>{t('npClosing')}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'end' }}>{t('npColChange')}</span>
          {lineKeys.map(k => {
            const liability = (month.closing.lines.find(l => l.key === k) ?? month.opening.lines.find(l => l.key === k))?.side === 'liability';
            const sign = liability ? -1 : 1;
            return (
              <div key={k} style={{ display: 'contents' }}>
                <span>{t(LINE_LABEL[k])}</span>
                <span className="mono" style={{ textAlign: 'end' }}>{money(sign * lineAmount(month.opening, k))}</span>
                <span className="mono" style={{ textAlign: 'end' }}>{money(sign * lineAmount(month.closing, k))}</span>
                <span className="mono" style={{ textAlign: 'end', color: signColor(sign * (lineAmount(month.closing, k) - lineAmount(month.opening, k))) }}>
                  {money(sign * (lineAmount(month.closing, k) - lineAmount(month.opening, k)), true)}
                </span>
                {([['npMadeOfOpening', month.opening], ['npMadeOfClosing', month.closing]] as const).map(([labelKey, position]) => (
                  !!position.details?.[k]?.length && (
                    <details key={labelKey} style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--muted)', paddingInlineStart: 12 }}>
                      <summary style={{ cursor: 'pointer' }}>{t(labelKey)}</summary>
                      {(position.details?.[k] ?? []).map((d, i) => (
                        <div key={`${d.label}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 2 }}>
                          <span style={{ overflowWrap: 'anywhere' }}>{d.label}{d.original ? ` · ${fmtTotal(d.original.amount)} ${d.original.unit}` : ''}</span>
                          <span className="mono">{fmtTotal(d.amountQAR)}</span>
                        </div>
                      ))}
                    </details>
                  )
                ))}
              </div>
            );
          })}
          <span style={{ fontWeight: 800 }}>{t('npAssets')}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>{money(month.opening.assetsQAR)}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>{money(month.closing.assetsQAR)}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>{money(month.closing.assetsQAR - month.opening.assetsQAR, true)}</span>
          <span style={{ fontWeight: 800 }}>{t('npLiabilities')}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>−{money(month.opening.liabilitiesQAR)}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>−{money(month.closing.liabilitiesQAR)}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>{money(-(month.closing.liabilitiesQAR - month.opening.liabilitiesQAR), true)}</span>
        </div>
      </div>

      {/* ── Rates ── */}
      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>{t('npRates')}</div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('npUsdRate')}
            <input inputMode="decimal" value={rates.usd} placeholder={pos.usdToQar ? pos.usdToQar.toFixed(4) : ''}
              onChange={e => { if (numeric(e.target.value)) setRates({ ...rates, usd: e.target.value }); }}
              style={{ width: '100%', marginTop: 4, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }} />
            <div style={{ fontWeight: 400, marginTop: 2 }}>{t('npUsdRateHint').split('{rate}').join(pos.usdtRateQAR ? pos.usdtRateQAR.toFixed(4) : '—')}</div>
          </label>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('npEgpRate')}
            <input inputMode="decimal" value={rates.egp} placeholder={pos.egpPerUsdt ? pos.egpPerUsdt.toFixed(2) : ''}
              onChange={e => { if (numeric(e.target.value)) setRates({ ...rates, egp: e.target.value }); }}
              style={{ width: '100%', marginTop: 4, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }} />
            <div style={{ fontWeight: 400, marginTop: 2 }}>{t('npEgpRateHint')}</div>
          </label>
        </div>
        {(rates.usd || rates.egp) && <button type="button" className="rowBtn" style={{ alignSelf: 'flex-start' }} onClick={() => setRates({ usd: '', egp: '' })}>{t('npReset')}</button>}
      </div>
    </div>
  );
}
