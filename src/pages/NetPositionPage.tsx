import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTheme } from '@/lib/theme-context';
import { useTrackerState } from '@/lib/useTrackerState';
import { useIsMobile } from '@/hooks/use-mobile';
import { useT, type TranslationKey } from '@/lib/i18n';
import { deriveCashQAR, fmtTotal, getAccountBalance, uid, type CashLedgerEntry } from '@/lib/tracker-helpers';
import {
  computeMonthBridge, computeMonthPosition, type NetPositionLineKey,
} from '@/lib/trading/net-position';
import { EXPENSE_CATEGORIES, isUncategorised, type ExpenseGroup } from '@/lib/trading/expense-categories';
import '@/styles/tracker.css';

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
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12, minWidth: 0 }}>
      <option value="">{t('npPick')}</option>
      {groups.map(g => (
        <optgroup key={g} label={g === 'business' ? t('expGroupBusiness') : t('expGroupPersonal')}>
          {EXPENSE_CATEGORIES.filter(c => c.group === g).map(c => <option key={c.key} value={c.key}>{t(CATEGORY_LABEL[c.key])}</option>)}
        </optgroup>
      ))}
    </select>
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
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [rates, setRates] = useState(readOverrides);
  useEffect(() => {
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(rates)); } catch { /* per-viewer convenience only */ }
  }, [rates]);

  const options = useMemo(() => ({
    usdToQar: Number(rates.usd) > 0 ? Number(rates.usd) : undefined,
    egpPerUsdt: Number(rates.egp) > 0 ? Number(rates.egp) : undefined,
  }), [rates]);

  const month = useMemo(() => computeMonthPosition(state, ym.year, ym.month, options), [state, ym, options]);
  const bridge = useMemo(() => computeMonthBridge(state, month), [state, month]);
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
        {card(t('npOpening'), `${money(month.opening.netQAR)} QAR`)}
        {card(t('npClosing'), `${money(month.closing.netQAR)} QAR`)}
        {card(t('npChange'), `${money(month.changeQAR, true)} QAR`, signColor(month.changeQAR))}
        {card(t('npRevenue'), `${money(month.netRevenueQAR, true)} QAR`, signColor(month.netRevenueQAR))}
      </div>

      {warnings.includes('egp_unpriced') && <div role="alert" style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {t('npWarnEgp')}</div>}
      {warnings.includes('usdt_unpriced') && <div role="alert" style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {t('npWarnUsdt')}</div>}

      {/* ── Bridge ── */}
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{t('npBridge')}</div>
        {row(t('npOpening'), bridge.openingQAR, { bold: true })}
        {row(t('npRevenue'), bridge.netRevenueQAR, { sign: '+' })}
        {bridge.depositsQAR > 0 && row(t('npDeposits'), bridge.depositsQAR, { sign: '+' })}
        {bridge.adjustmentsInQAR > 0 && row(t('npAdjustments'), bridge.adjustmentsInQAR, { sign: '+' })}

        {row(t('npBusiness'), bridge.businessTotalQAR, { sign: '-' })}
        {bridge.business.map(c => row(t(CATEGORY_LABEL[c.key]), c.amountQAR, { muted: true, indent: true }))}

        <div style={{ borderTop: '1px dashed var(--line)', margin: '6px 0' }} />
        {row(t('npPersonal'), bridge.personalTotalQAR, { sign: '-' })}
        {bridge.personal.map(c => row(t(CATEGORY_LABEL[c.key]), c.amountQAR, { muted: true, indent: true }))}
        <div style={{ borderTop: '1px dashed var(--line)', margin: '6px 0' }} />

        {bridge.uncategorisedQAR > 0 && row(`${t('npUncategorised')} (${bridge.uncategorisedCount})`, bridge.uncategorisedQAR, { sign: '-' })}
        {row(t('npOther'), bridge.otherQAR, { muted: true })}
        <div style={{ borderTop: '1px solid var(--line)', margin: '6px 0' }} />
        {row(t('npClosing'), bridge.closingQAR, { bold: true })}
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
              <select value={accountId} onChange={e => setForm({ ...form, accountId: e.target.value })}
                style={{ width: '100%', marginTop: 4, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
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

      {/* ── Breakdown ── */}
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{t('npBreakdown')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 14px', fontSize: 12, alignItems: 'baseline' }}>
          <span />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'end' }}>{t('npOpening')}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'end' }}>{t('npClosing')}</span>
          {lineKeys.map(k => {
            const liability = (month.closing.lines.find(l => l.key === k) ?? month.opening.lines.find(l => l.key === k))?.side === 'liability';
            const sign = liability ? -1 : 1;
            return (
              <div key={k} style={{ display: 'contents' }}>
                <span>{t(LINE_LABEL[k])}</span>
                <span className="mono" style={{ textAlign: 'end' }}>{money(sign * lineAmount(month.opening, k))}</span>
                <span className="mono" style={{ textAlign: 'end' }}>{money(sign * lineAmount(month.closing, k))}</span>
              </div>
            );
          })}
          <span style={{ fontWeight: 800 }}>{t('npAssets')}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>{money(month.opening.assetsQAR)}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>{money(month.closing.assetsQAR)}</span>
          <span style={{ fontWeight: 800 }}>{t('npLiabilities')}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>−{money(month.opening.liabilitiesQAR)}</span>
          <span className="mono" style={{ textAlign: 'end', fontWeight: 800 }}>−{money(month.closing.liabilitiesQAR)}</span>
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
