import { useState, useMemo, useEffect, useCallback, Fragment, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import {
  uid, fmtTotal, fmtDate, num,
  type TrackerState,
  type CashAccount, type CashAccountType, type CashCurrency,
  type CashLedgerEntry, type LedgerEntryType,
  type CustomerLoan, type LoanRepayment, type Customer, type Trade,
  getAccountBalance, getAllAccountBalances, deriveCashQAR,
  getLoanRepaid, getLoanRemaining,
} from '@/lib/tracker-helpers';
import { useT } from '@/lib/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { deleteCashAccountLedgerFromCloud, deleteCashAccountFromCloud } from '@/lib/cash-sync';
import { useCashCustodyRequests } from '@/hooks/useCashCustodyRequests';
import { normalizeCounterparties, type NormalizedCounterparty } from '@/lib/custody-relationships';
import { groupClosedLoansByMonth, isLoanClosed, loanMatchesQuery } from '@/features/stock/utils/loanGrouping';
import {
  buildBuyerStatements, statementMatchesQuery, totalsByCurrency, groupPayments,
  type StatementEntry, type BuyerStatement, type PaymentGroup,
} from '@/features/stock/utils/loanStatement';
import {
  buildReceivablesCsv, downloadTextFile, formatMoney,
} from '@/features/stock/utils/loanStatementExport';
import { statementLabels } from '@/features/stock/utils/statementLabels';
import { deleteRepayment, editRepayment, withDerivedStatus } from '@/features/stock/utils/loanRepayments';
import { LoanStatementModal } from '@/features/stock/components/LoanStatementModal';
import { PublicStatementReport, type PublicStatement } from '@/features/stock/components/PublicStatementReport';
import { useExchangeP2POrders } from '@/features/exchanges/hooks/useExchangeP2POrders';
import { findUnlinkedCompletedSellOrders, createLoanFromExchangeOrder, DEFAULT_QAR_RATE } from '@/features/exchanges/loanFromOrder';
import { EXCHANGE_LABELS, type ExchangeP2POrder } from '@/features/exchanges/types';

interface PublicStatementLink {
  id: string;
  customer_id: string;
  token: string;
  currency: string;
  created_at: string;
  revoked_at: string | null;
}

// ── Icons (inline SVG helpers) ─────────────────────────────────────
// Two sizes only: 12px for identity icons (account type), 10px for action
// icons sitting inside buttons. Keeps the page's iconography compact.
const IconHand = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
  </svg>
);
const IconBank = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/>
    <line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/>
    <line x1="18" y1="18" x2="18" y2="11"/>
    <polygon points="12 2 20 7 4 7"/>
  </svg>
);
const IconVault = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/>
    <path d="M12 8v4M12 16h.01"/>
  </svg>
);
const IconMerchant = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const IconTransfer = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
    <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
  </svg>
);
const IconPlus = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const IconMinus = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

const ACCOUNT_TYPE_ICON: Record<CashAccountType, React.FC> = {
  hand: IconHand, 
  bank: IconBank, 
  vault: IconVault,
  merchant_custody: IconMerchant,
};
const CURRENCY_SYMBOLS: Record<CashCurrency, string> = { QAR: 'QAR', USDT: 'USDT', USD: 'USD', EGP: 'EGP' };

// ── Helpers ────────────────────────────────────────────────────────
function fmtAmt(n: number, currency: CashCurrency = 'QAR'): string {
  return fmtTotal(Math.abs(n)) + ' ' + CURRENCY_SYMBOLS[currency];
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function get24hMovement(accountId: string, ledger: CashLedgerEntry[]): number {
  const since = Date.now() - 86400000;
  return (ledger || [])
    .filter(e => e.accountId === accountId && e.ts >= since)
    .reduce((sum, e) => sum + (e.direction === 'in' ? e.amount : -e.amount), 0);
}

// ── Sub-components ─────────────────────────────────────────────────

interface KpiBoxProps {
  icon: string;
  label: string;
  value: string;
  /** Currency/unit rendered smaller next to the value. */
  unit?: string;
  /** Small caption under the value — counts, breakdowns, share of total. */
  sub?: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'good' | 'bad' | 'warn';
  /** 0–100. Renders a thin bar at the bottom of the box when set. */
  progress?: number;
  /** Makes the box a button — used to jump to the matching tab. */
  onClick?: () => void;
}
function KpiBox({ icon, label, value, unit, sub, tone = 'neutral', progress, onClick }: KpiBoxProps) {
  const body = (
    <>
      <div className="cash-kpi-label"><span className="cash-kpi-icon">{icon}</span>{label}</div>
      <div className="cash-kpi-value mono">
        {value}{unit && <span className="cash-kpi-unit">{unit}</span>}
      </div>
      <div className="cash-kpi-sub">{sub || ' '}</div>
      {typeof progress === 'number' && (
        <div className="cash-kpi-bar"><span style={{ width: `${Math.max(0, Math.min(100, progress)).toFixed(1)}%` }} /></div>
      )}
    </>
  );
  const cls = `cash-kpi tone-${tone}${onClick ? ' clickable' : ''}`;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

interface AddAccountModalProps {
  existingAccount?: CashAccount;
  onSave: (account: CashAccount) => void;
  onClose: () => void;
  isMobile?: boolean;
}
function AddAccountModal({ existingAccount, onSave, onClose, isMobile = false }: AddAccountModalProps) {
  const t = useT();
  const [name, setName] = useState(existingAccount?.name || '');
  const [type, setType] = useState<CashAccountType>(existingAccount?.type || 'hand');
  const [currency, setCurrency] = useState<CashCurrency>(existingAccount?.currency || 'QAR');
  const [bankName, setBankName] = useState(existingAccount?.bankName || '');
  const [branch, setBranch] = useState(existingAccount?.branch || '');
  const [merchantId, setMerchantId] = useState(existingAccount?.merchantId || '');
  const [relationshipId, setRelationshipId] = useState(existingAccount?.relationshipId || '');
  const [notes, setNotes] = useState(existingAccount?.notes || '');
  const [err, setErr] = useState('');
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return;
    const updateViewport = () => {
      const vv = window.visualViewport;
      setViewportHeight(vv ? vv.height : window.innerHeight);
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [isMobile]);

  const handleSave = () => {
    if (!name.trim()) { setErr(t('accountNameRequired')); return; }
    const account: CashAccount = {
      id: existingAccount?.id || uid(),
      name: name.trim(),
      type,
      currency,
      status: existingAccount?.status || 'active',
      bankName: bankName.trim() || undefined,
      branch: branch.trim() || undefined,
      merchantId: type === 'merchant_custody' ? merchantId : undefined,
      relationshipId: type === 'merchant_custody' ? relationshipId : undefined,
      isMerchantAccount: type === 'merchant_custody',
      purpose: type === 'merchant_custody' ? 'custody' : undefined,
      notes: notes.trim() || undefined,
      lastReconciled: existingAccount?.lastReconciled,
      createdAt: existingAccount?.createdAt || Date.now(),
    };
    onSave(account);
  };

  const selectStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 42,
    padding: '8px 10px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid var(--line)',
    /* Hardcoded: CSS vars don't resolve in native OS dropdown popup */
    background: '#1a1d38',
    color: '#e8eaff',
    cursor: 'pointer',
    outline: 'none',
    colorScheme: 'dark',
  };

  const optionStyle: React.CSSProperties = {
    /* Hardcoded: CSS vars don't resolve in native OS dropdown popup */
    backgroundColor: '#1a1d38',
    color: '#e8eaff',
  };

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          background: 'var(--panel2)',
          border: '1px solid var(--line)',
          borderRadius: isMobile ? 14 : 12,
          padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px',
          width: '100%',
          maxWidth: 460,
          boxShadow: '0 20px 60px rgba(0,0,0,.5)',
          maxHeight: isMobile ? Math.max(320, (viewportHeight || window.innerHeight) - 16) : '88vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
            {existingAccount ? t('editAccountTitle') : t('addCashAccount')}
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, minHeight: 36, minWidth: 36 }}>✕</button>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('accountName')}</div>
          <div className="inputBox"><input value={name} onChange={e => setName(e.target.value)} placeholder={t('accountNamePh')} /></div>
        </div>

        <div className="g2tight" style={{ marginBottom: 10 }}>
          <div className="field2">
            <div className="lbl">{t('accountTypeLbl')}</div>
            <select value={type} onChange={e => setType(e.target.value as CashAccountType)} style={selectStyle}>
              <option value="hand" style={optionStyle}>💵 {t('accTypeHand')}</option>
              <option value="bank" style={optionStyle}>🏦 {t('accTypeBank')}</option>
              <option value="vault" style={optionStyle}>🔒 {t('accTypeVault')}</option>
              <option value="merchant_custody" style={optionStyle}>🤝 {t('accTypeMerchant') || 'Merchant Custody'}</option>
            </select>
          </div>
          <div className="field2">
            <div className="lbl">{t('accountCurrencyLbl')}</div>
            <select value={currency} onChange={e => setCurrency(e.target.value as CashCurrency)} style={selectStyle}>
              <option value="QAR" style={optionStyle}>🇶🇦 QAR</option>
              <option value="EGP" style={optionStyle}>🇪🇬 EGP</option>
              <option value="USDT" style={optionStyle}>💲 USDT</option>
              <option value="USD" style={optionStyle}>🇺🇸 USD</option>
            </select>
          </div>
        </div>

        {type === 'bank' && (
          <div className="g2tight" style={{ marginBottom: 10 }}>
            <div className="field2">
              <div className="lbl">{t('bankNameLbl')}</div>
              <div className="inputBox"><input value={bankName} onChange={e => setBankName(e.target.value)} placeholder={t('bankNamePh')} /></div>
            </div>
            <div className="field2">
              <div className="lbl">{t('branchLbl')}</div>
              <div className="inputBox"><input value={branch} onChange={e => setBranch(e.target.value)} placeholder={t('branchPh')} /></div>
            </div>
          </div>
        )}

        {type === 'merchant_custody' && (
          <div className="field2" style={{ marginBottom: 10 }}>
            <div className="lbl">{t('linkToMerchant')}</div>
            <select value={relationshipId} onChange={e => setRelationshipId(e.target.value)} style={selectStyle}>
              <option value="" style={optionStyle}>{t('selectRelationship')}</option>
            </select>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{t('noApprovedRelationships')}</div>
          </div>
        )}

        <div className="field2" style={{ marginBottom: 16 }}>
          <div className="lbl">{t('notesOptionalAcc')}</div>
          <div className="inputBox"><input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('notesAccPh')} /></div>
        </div>

        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        <div className="formActions" style={{ position: isMobile ? 'sticky' : 'static', bottom: isMobile ? 0 : undefined, background: isMobile ? 'linear-gradient(to top, var(--panel2) 70%, transparent)' : undefined, paddingTop: isMobile ? 8 : 0 }}>
          <button className="btn secondary" style={{ minHeight: isMobile ? 42 : undefined }} onClick={onClose}>{t('cancel')}</button>
          <button className="btn" onClick={handleSave}>
            {existingAccount ? t('saveChanges') : t('createAccountBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DepositWithdrawModalProps {
  account: CashAccount;
  currentBalance: number;
  mode: 'deposit' | 'withdrawal' | 'funding' | 'proceeds' | 'settlement';
  onSave: (entry: CashLedgerEntry) => void;
  onClose: () => void;
  isMobile?: boolean;
}
function DepositWithdrawModal({ account, currentBalance, mode, onSave, onClose, isMobile = false }: DepositWithdrawModalProps) {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const amtNum = num(amount, 0);

  const MODE_LABELS: Record<string, string> = {
    deposit: t('depositTitle'),
    withdrawal: t('withdrawTitle'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    funding: t('fundMerchant' as any) || 'Fund Merchant',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proceeds: t('recordProceeds' as any) || 'Record Proceeds',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settlement: t('settleBack' as any) || 'Settle Back'
  };

  const LEDGER_TYPES: Record<string, LedgerEntryType> = {
    deposit: 'deposit',
    withdrawal: 'withdrawal',
    funding: 'merchant_funding_out',
    proceeds: 'merchant_sale_proceeds',
    settlement: 'merchant_settlement_out'
  };

  const DIRECTIONS: Record<string, 'in' | 'out'> = {
    deposit: 'in', withdrawal: 'out', funding: 'in', proceeds: 'in', settlement: 'out'
  };

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return;
    const updateViewport = () => {
      const vv = window.visualViewport;
      setViewportHeight(vv ? vv.height : window.innerHeight);
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [isMobile]);

  const handle = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isMobile && !confirmChecked) { setErr(t('confirmBeforeSubmit' as any)); return; }
    if (!(amtNum > 0)) { setErr(t('enterValidAmount')); return; }
    if (amtNum > currentBalance && (mode === 'withdrawal' || mode === 'settlement')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setErr(`${t('insufficientBalMsg' as any)} ${fmtTotal(currentBalance)} ${account.currency}`);
      return;
    }
    const entry: CashLedgerEntry = {
      id: uid(), ts: Date.now(),
      type: LEDGER_TYPES[mode],
      accountId: account.id,
      direction: DIRECTIONS[mode],
      amount: amtNum,
      currency: account.currency,
      note: note.trim() || undefined,
      merchantId: account.merchantId,
      relationshipId: account.relationshipId,
    };
    onSave(entry);
  };

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px', width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,.5)', maxHeight: isMobile ? Math.max(320, (viewportHeight || window.innerHeight) - 16) : '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
            {DIRECTIONS[mode] === 'in' ? '➕' : '➖'} {MODE_LABELS[mode]} — {account.name}
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ background: 'color-mix(in srgb, var(--brand) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 20%, transparent)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 11 }}>
          <span style={{ color: 'var(--muted)' }}>{t('currentBalanceLbl')}: </span>
          <span className="mono" style={{ fontWeight: 800, color: 'var(--brand)', fontSize: 13 }}>{fmtTotal(currentBalance)} {account.currency}</span>
        </div>
        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('amount')} ({account.currency})</div>
          <div className="inputBox"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus /></div>
        </div>
        {amtNum > 0 && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
            {t('balanceAfterLbl')}: <strong style={{ color: DIRECTIONS[mode] === 'in' ? 'var(--good)' : 'var(--warn)' }}>
              {fmtTotal(currentBalance + (DIRECTIONS[mode] === 'in' ? amtNum : -amtNum))} {account.currency}
            </strong>
          </div>
        )}
        <div className="field2" style={{ marginBottom: 14 }}>
          <div className="lbl">{t('noteOptional')}</div>
          <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} placeholder={t('sourceReasonPh')} /></div>
        </div>
        {isMobile && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, color: 'var(--muted)' }}>
            <input type="checkbox" checked={confirmChecked} onChange={e => setConfirmChecked(e.target.checked)} />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {mode === 'deposit' ? t('confirmDeposit' as any) : t('confirmWithdrawal' as any)}
          </label>
        )}
        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        <div className="formActions" style={{ position: isMobile ? 'sticky' : 'static', bottom: isMobile ? 0 : undefined, background: isMobile ? 'linear-gradient(to top, var(--panel2) 70%, transparent)' : undefined, paddingTop: isMobile ? 8 : 0 }}>
          <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn" style={{ minHeight: isMobile ? 42 : undefined, background: DIRECTIONS[mode] === 'in' ? 'var(--good)' : 'var(--warn)', color: '#000' }} onClick={handle}>
            {MODE_LABELS[mode]}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TransferModalProps {
  accounts: CashAccount[];
  balances: Map<string, number>;
  defaultFromId?: string;
  onSave: (entries: [CashLedgerEntry, CashLedgerEntry]) => void;
  onClose: () => void;
  isMobile?: boolean;
}
function TransferModal({ accounts, balances, defaultFromId, onSave, onClose, isMobile = false }: TransferModalProps) {
  const t = useT();
  const active = accounts.filter(a => a.status === 'active');
  const [fromId, setFromId] = useState(defaultFromId || (active[0]?.id || ''));
  const [toId, setToId] = useState(active.find(a => a.id !== fromId)?.id || '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  const fromAcc = active.find(a => a.id === fromId);
  const toAcc = active.find(a => a.id === toId);
  const fromBal = balances.get(fromId) || 0;
  const amtNum = num(amount, 0);

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return;
    const updateViewport = () => {
      const vv = window.visualViewport;
      setViewportHeight(vv ? vv.height : window.innerHeight);
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [isMobile]);

  const handle = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isMobile && !confirmChecked) { setErr(t('confirmBeforeTransfer' as any)); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!fromId || !toId) { setErr(t('selectBothAccounts' as any)); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (fromId === toId) { setErr(t('cannotSameAccount' as any)); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(amtNum > 0)) { setErr(t('enterValidAmount' as any)); return; }
    if (amtNum > fromBal) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setErr((t('insufficientFundsMsg' as any)) + ` ${fmtTotal(fromBal)} ${fromAcc?.currency}`);
      return;
    }
    const ts = Date.now();
    const outEntry: CashLedgerEntry = {
      id: uid(), ts, type: 'transfer_out', accountId: fromId, contraAccountId: toId,
      direction: 'out', amount: amtNum, currency: fromAcc!.currency,
      note: note.trim() || `Transfer to ${toAcc?.name}`,
    };
    const inEntry: CashLedgerEntry = {
      id: uid(), ts, type: 'transfer_in', accountId: toId, contraAccountId: fromId,
      direction: 'in', amount: amtNum, currency: toAcc!.currency,
      note: note.trim() || `Transfer from ${fromAcc?.name}`,
    };
    onSave([outEntry, inEntry]);
  };

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid var(--line)',
    background: 'var(--panel)',
    color: 'var(--text)',
    cursor: 'pointer',
    outline: 'none'
  };

  const optionStyle: React.CSSProperties = {
    background: 'var(--panel)',
    color: 'var(--text)'
  };

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px', width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,.5)', maxHeight: isMobile ? Math.max(320, (viewportHeight || window.innerHeight) - 16) : '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{t('quickTransfer' as any)}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div className="g2tight" style={{ marginBottom: 10, alignItems: 'end', ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
          <div className="field2">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <div className="lbl">{t('transferFromLbl' as any)}</div>
            <select value={fromId} onChange={e => setFromId(e.target.value)} style={selectStyle}>
              {active.map(a => <option key={a.id} value={a.id} style={optionStyle}>{a.name} ({fmtTotal(balances.get(a.id) || 0)} {a.currency})</option>)}
            </select>
          </div>
          <div className="field2">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <div className="lbl">{t('transferToLbl' as any)}</div>
            <select value={toId} onChange={e => setToId(e.target.value)} style={selectStyle}>
              {active.filter(a => a.id !== fromId).map(a => <option key={a.id} value={a.id} style={optionStyle}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('amount')}</div>
          <div className="inputBox"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus /></div>
        </div>
        {amtNum > 0 && fromAcc && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {fromAcc.name} {(t('balanceAfterLbl' as any)).toLowerCase()}: <strong style={{ color: 'var(--warn)' }}>{fmtTotal(fromBal - amtNum)} {fromAcc.currency}</strong>
          </div>
        )}
        <div className="field2" style={{ marginBottom: 14 }}>
          <div className="lbl">{t('noteOptional')}</div>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} placeholder={t('reasonTransferPh' as any)} /></div>
        </div>
        {isMobile && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, color: 'var(--muted)' }}>
            <input type="checkbox" checked={confirmChecked} onChange={e => setConfirmChecked(e.target.checked)} />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {t('confirmTransferReview' as any)}
          </label>
        )}
        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        <div className="formActions" style={{ position: isMobile ? 'sticky' : 'static', bottom: isMobile ? 0 : undefined, background: isMobile ? 'linear-gradient(to top, var(--panel2) 70%, transparent)' : undefined, paddingTop: isMobile ? 8 : 0 }}>
          <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <button className="btn" style={{ minHeight: isMobile ? 42 : undefined }} onClick={handle}>{t('transferFundsBtn' as any)}</button>
        </div>
      </div>
    </div>
  );
}

interface ReconcileEntryModalProps {
  account: CashAccount;
  currentBalance: number;
  onSave: (entry: CashLedgerEntry) => void;
  onClose: () => void;
  isMobile?: boolean;
}
function ReconcileEntryModal({ account, currentBalance, onSave, onClose, isMobile = false }: ReconcileEntryModalProps) {
  const t = useT();
  const [actualBal, setActualBal] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  
  const handle = () => {
    const val = num(actualBal, -1);
    if (val < 0) { setErr(t('enterValidAmount')); return; }
    
    const diff = val - currentBalance;
    if (Math.abs(diff) < 0.0001) {
      // Just mark as reconciled
      onSave({
        id: uid(), ts: Date.now(), type: 'reconcile', accountId: account.id,
        direction: 'in', amount: 0, currency: account.currency,
        note: `Reconciled. Balance: ${fmtTotal(val)}`,
      });
      return;
    }

    const type: LedgerEntryType = account.type === 'merchant_custody' ? 'merchant_adjustment' : 'reconcile';
    onSave({
      id: uid(), ts: Date.now(), type, accountId: account.id,
      direction: diff > 0 ? 'in' : 'out',
      amount: Math.abs(diff),
      currency: account.currency,
      note: reason.trim() || `Market adjustment / Reconciliation. Diff: ${fmtTotal(diff)}`,
    });
  };

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} />
      <div style={{ position: 'relative', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>🔄 {t('reconcileBtn')} — {account.name}</div>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>{t('reconcileDesc' as any) || 'Enter the actual physical balance to create an adjustment entry.'}</div>
        <div className="field2" style={{ marginBottom: 10 }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <div className="lbl">{t('physicalBalanceLbl' as any) || 'Physical Balance'}</div>
          <div className="inputBox"><input inputMode="decimal" value={actualBal} onChange={e => setActualBal(e.target.value)} placeholder="0.00" autoFocus /></div>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{t('systemBalance' as any) || 'System'}: {fmtTotal(currentBalance)} {account.currency}</div>
        </div>

        <div className="field2" style={{ marginBottom: 16 }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <div className="lbl">{t('adjustmentReason' as any) || 'Reason'}</div>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <div className="inputBox"><input value={reason} onChange={e => setReason(e.target.value)} placeholder={t('adjustmentReasonPh' as any) || 'e.g. Rounding, unknown loss...'} /></div>
        </div>

        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        
        <div className="formActions">
          <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <button className="btn" onClick={handle}>{t('confirmReconcile' as any) || 'Confirm Reconciliation'}</button>
        </div>
      </div>
    </div>
  );
}

// ── MerchantCustodyModal ──────────────────────────────────────────
interface MerchantCustodyModalProps {
  counterparties: NormalizedCounterparty[];
  myMerchantId: string;
  myUserId: string;
  onSubmit: (input: {
    custodianMerchantId: string;
    custodianUserId: string;
    requesterMerchantId: string;
    amount: number;
    currency: string;
    note?: string;
    relationshipId?: string;
  }) => void;
  onClose: () => void;
  isMobile?: boolean;
}
function MerchantCustodyModal({ counterparties, myMerchantId, myUserId, onSubmit, onClose, isMobile = false }: MerchantCustodyModalProps) {
  const t = useT();
  const [selectedIdx, setSelectedIdx] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CashCurrency>('QAR');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const selected = selectedIdx !== '' ? counterparties[Number(selectedIdx)] : null;

  const handle = () => {
    if (!selected) { setErr(t('invalidRelationship')); return; }
    if (!(num(amount, 0) > 0)) { setErr(t('enterValidAmount')); return; }
    if (!selected.counterpartyUserId) { setErr(t('missingMerchantUserMapping')); return; }
    if (selected.counterpartyMerchantId === myMerchantId) { setErr(t('cannotSendToYourself')); return; }
    if (selected.counterpartyUserId === myUserId) { setErr(t('cannotSendToYourself')); return; }
    onSubmit({
      custodianMerchantId: selected.counterpartyMerchantId,
      custodianUserId: selected.counterpartyUserId,
      requesterMerchantId: myMerchantId,
      amount: num(amount, 0),
      currency,
      note: note.trim() || undefined,
      relationshipId: selected.relationshipId,
    });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px', width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>🤝 {t('merchantCashCustody')}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
          {t('custodyRequestDesc')}
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('selectMerchantCustodian')}</div>
          <select value={selectedIdx} onChange={e => setSelectedIdx(e.target.value)}
            style={{ width: '100%', minHeight: 42, padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: '#1a1d38', color: '#e8eaff', cursor: 'pointer', outline: 'none', colorScheme: 'dark' }}>
            <option value="">{t('selectRelationship')}</option>
            {counterparties.map((cp, i) => (
              <option key={cp.relationshipId} value={String(i)}>{cp.counterpartyLabel}</option>
            ))}
          </select>
          {counterparties.length === 0 && (
            <div style={{ fontSize: 10, color: 'var(--warn)', marginTop: 4 }}>{t('noApprovedRelationships')}</div>
          )}
        </div>

        <div className="g2tight" style={{ marginBottom: 10 }}>
          <div className="field2">
            <div className="lbl">{t('amount')}</div>
            <div className="inputBox"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus /></div>
          </div>
          <div className="field2">
            <div className="lbl">{t('currency')}</div>
            <select value={currency} onChange={e => setCurrency(e.target.value as CashCurrency)}
              style={{ width: '100%', minHeight: 42, padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: '#1a1d38', color: '#e8eaff', cursor: 'pointer', outline: 'none', colorScheme: 'dark' }}>
              <option value="QAR">🇶🇦 QAR</option>
              <option value="EGP">🇪🇬 EGP</option>
              <option value="USDT">💲 USDT</option>
              <option value="USD">🇺🇸 USD</option>
            </select>
          </div>
        </div>

        <div className="field2" style={{ marginBottom: 16 }}>
          <div className="lbl">{t('custodyNoteOptional')}</div>
          <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} placeholder="..." /></div>
        </div>

        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        <div className="formActions">
          <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn" onClick={handle}>{t('sendCustodyRequest')}</button>
        </div>
      </div>
    </div>
  );
}

interface NewLoanModalProps {
  customers: Customer[];
  trades: Trade[];
  accounts: CashAccount[];
  balances: Map<string, number>;
  /** Trade ids that already have a loan (open or closed) against them — offered but flagged, not hidden, so a legitimate second partial loan on the same order is still possible. */
  loanedTradeIds: Set<string>;
  onSave: (input: { customerId: string; tradeId?: string; principal: number; currency: CashCurrency; fundingAccountId?: string; note?: string }) => void;
  onClose: () => void;
  isMobile?: boolean;
}
function NewLoanModal({ customers, trades, accounts, balances, loanedTradeIds, onSave, onClose, isMobile = false }: NewLoanModalProps) {
  const t = useT();
  const [customerId, setCustomerId] = useState(customers[0]?.id || '');
  const [tradeId, setTradeId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [principalTouched, setPrincipalTouched] = useState(false);
  const [currency, setCurrency] = useState<CashCurrency>('QAR');
  const [fundingAccountId, setFundingAccountId] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const principalNum = num(principal, 0);
  const fundingAcc = accounts.find(a => a.id === fundingAccountId);
  const custTrades = trades.filter(tr => tr.customerId === customerId && !tr.voided);

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 6,
    border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)', cursor: 'pointer', outline: 'none',
  };
  const optionStyle: React.CSSProperties = { background: 'var(--panel)', color: 'var(--text)' };

  const isDuplicateOrder = !!tradeId && loanedTradeIds.has(tradeId);

  const handle = () => {
    if (!customerId) { setErr(t('loanSelectCustomer')); return; }
    if (!(principalNum > 0)) { setErr(t('enterValidAmount')); return; }
    if (fundingAccountId) {
      const bal = balances.get(fundingAccountId) || 0;
      if (bal < principalNum) { setErr(`${t('insufficientInAcc')} "${fundingAcc?.name}"`); return; }
    }
    if (isDuplicateOrder && !confirmDuplicate) { setErr(t('loanDuplicateOrderWarning')); return; }
    onSave({ customerId, tradeId: tradeId || undefined, principal: principalNum, currency, fundingAccountId: fundingAccountId || undefined, note: note.trim() || undefined });
  };

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px', width: '100%', maxWidth: 420, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{t('newLoan')}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanCustomer')}</div>
          <select value={customerId} onChange={e => { setCustomerId(e.target.value); setTradeId(''); setPrincipal(''); setPrincipalTouched(false); }} style={selectStyle}>
            <option value="" style={optionStyle}>{t('loanSelectCustomer')}</option>
            {customers.map(c => <option key={c.id} value={c.id} style={optionStyle}>{c.name}</option>)}
          </select>
        </div>

        {custTrades.length > 0 && (
          <div className="field2" style={{ marginBottom: 10 }}>
            <div className="lbl">{t('loanLinkedOrder')}</div>
            <select
              value={tradeId}
              onChange={e => {
                const newTradeId = e.target.value;
                setTradeId(newTradeId);
                setConfirmDuplicate(false);
                const tr = custTrades.find(x => x.id === newTradeId);
                if (tr && !principalTouched) {
                  const orderTotal = tr.amountUSDT * tr.sellPriceQAR - (tr.feeQAR || 0);
                  setPrincipal(String(Math.max(0, Math.round(orderTotal * 100) / 100)));
                  setCurrency('QAR');
                }
              }}
              style={selectStyle}
            >
              <option value="" style={optionStyle}>—</option>
              {custTrades.map(tr => (
                <option key={tr.id} value={tr.id} style={optionStyle}>
                  {fmtDate(tr.ts)} · {tr.amountUSDT} USDT{loanedTradeIds.has(tr.id) ? ` — ${t('loanAlreadyLinked')}` : ''}
                </option>
              ))}
            </select>
            {isDuplicateOrder && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--warn)', marginBottom: 4 }}>⚠ {t('loanDuplicateOrderWarning')}</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={confirmDuplicate} onChange={e => setConfirmDuplicate(e.target.checked)} />
                  {t('loanDuplicateOrderConfirm')}
                </label>
              </div>
            )}
          </div>
        )}

        <div className="g2tight" style={{ marginBottom: 10, ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
          <div className="field2">
            <div className="lbl">{t('loanPrincipal')}</div>
            <div className="inputBox">
              <input
                inputMode="decimal"
                value={principal}
                onChange={e => { setPrincipal(e.target.value); setPrincipalTouched(true); }}
                placeholder="0.00"
                autoFocus
              />
            </div>
            {tradeId && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>{t('loanPrincipalAdjustHint')}</div>}
          </div>
          <div className="field2">
            <div className="lbl">{t('currencyMode')}</div>
            <select value={currency} onChange={e => setCurrency(e.target.value as CashCurrency)} style={selectStyle}>
              {(['QAR', 'USDT', 'EGP', 'USD'] as CashCurrency[]).map(c => <option key={c} value={c} style={optionStyle}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanFundingSource')}</div>
          <select value={fundingAccountId} onChange={e => setFundingAccountId(e.target.value)} style={selectStyle}>
            <option value="" style={optionStyle}>—</option>
            {accounts.map(a => <option key={a.id} value={a.id} style={optionStyle}>{a.name} ({fmtTotal(balances.get(a.id) || 0)} {a.currency})</option>)}
          </select>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>{t('loanFundingSourceHint')}</div>
        </div>

        <div className="field2" style={{ marginBottom: 14 }}>
          <div className="lbl">{t('loanNoteLabel')}</div>
          <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} placeholder="..." /></div>
        </div>

        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        <div className="formActions">
          <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn" onClick={handle}>{t('newLoan')}</button>
        </div>
      </div>
    </div>
  );
}

/** `datetime-local` wants local wall-clock time, not the UTC ISO string. */
function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface RepayLoanModalProps {
  loan: CustomerLoan;
  /** How much this payment may cover — the loan's balance with `existing` taken back out. */
  remaining: number;
  accounts: CashAccount[];
  /** The payment being corrected. Absent when recording a new one. */
  existing?: LoanRepayment;
  /**
   * Returns (or throws) so the modal can show a spinner while it's in flight
   * and surface a failure inline instead of leaving the click looking like
   * it did nothing — the caller's own commit() already toasts on failure,
   * but a synchronous error thrown before that point had nowhere to land.
   */
  onSave: (accountId: string, amount: number, ts: number, note?: string) => void | Promise<void>;
  onClose: () => void;
  isMobile?: boolean;
}
function RepayLoanModal({ loan, remaining, accounts, existing, onSave, onClose, isMobile = false }: RepayLoanModalProps) {
  const t = useT();
  const editing = !!existing;
  const [accountId, setAccountId] = useState(
    existing?.accountId || accounts.find(a => a.currency === loan.currency)?.id || accounts[0]?.id || ''
  );
  const [amount, setAmount] = useState(String(existing?.amount ?? (remaining || '')));
  const [date, setDate] = useState(() => toLocalInput(existing?.ts ?? Date.now()));
  const [note, setNote] = useState(existing?.note || '');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const amtNum = num(amount, 0);

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 6,
    border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)', cursor: 'pointer', outline: 'none',
  };
  const optionStyle: React.CSSProperties = { background: 'var(--panel)', color: 'var(--text)' };

  const handle = async () => {
    if (saving) return;
    setErr('');
    if (!accountId) { setErr(t('loanRepaymentAccount')); return; }
    if (!(amtNum > 0)) { setErr(t('enterValidAmount')); return; }
    const ts = new Date(date).getTime();
    if (!Number.isFinite(ts)) { setErr(t('date')); return; }
    setSaving(true);
    try {
      await onSave(accountId, amtNum, ts, note.trim() || undefined);
    } catch (error) {
      // A failure here is unexpected -- commit() itself already toasts on a
      // save failure and returns without throwing, so reaching this catch
      // means something threw before that point. Surface it instead of
      // leaving the click looking like it silently did nothing.
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px', width: '100%', maxWidth: 380, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{editing ? t('loanEditPayment') : t('loanAddRepayment')}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
          {editing ? t('loanPaymentCap') : t('loanRemaining')}: <strong className="mono" style={{ color: 'var(--text)' }}>{fmtTotal(remaining)} {loan.currency}</strong>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanRepaymentAccount')}</div>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} style={selectStyle}>
            {accounts.map(a => <option key={a.id} value={a.id} style={optionStyle}>{a.name} ({a.currency})</option>)}
          </select>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanRepaymentAmount')}</div>
          <div className="inputBox"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus /></div>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanRepaymentDate')}</div>
          <div className="inputBox"><input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></div>
        </div>

        <div className="field2" style={{ marginBottom: 14 }}>
          <div className="lbl">{t('loanNoteLabel')}</div>
          <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} placeholder={t('loanRepaymentNotePh')} /></div>
        </div>

        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        <div className="formActions">
          <button className="btn secondary" onClick={onClose} disabled={saving}>{t('cancel')}</button>
          <button className="btn" onClick={handle} disabled={saving}>
            {saving ? `${t('saving') || 'Saving…'}` : (editing ? t('saveChanges') : t('loanAddRepayment'))}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CashCounterModal ─────────────────────────────────────────────
// Physical banknote tally → total → what to do with it: add it onto a
// cash account, apply it against one open customer loan, or split it
// across several loans at once (mirrors SplitRepaymentModal's per-order
// split, just driven by a note count instead of a buyer statement).
// The merchant only ever handles 500/200/100/50 notes, so that's the
// fixed denomination set — no per-currency variation.
const NOTE_DENOMINATIONS = [500, 200, 100, 50];

const COUNTER_STEPS = ['count', 'action', 'confirm'] as const;
type CounterStep = typeof COUNTER_STEPS[number];

interface CashCounterModalProps {
  accounts: CashAccount[];
  balances: Map<string, number>;
  loans: CustomerLoan[];
  customers: Customer[];
  getLoanRemaining: (loan: CustomerLoan) => number;
  onAddToCash: (entry: CashLedgerEntry) => void;
  onRepayLoan: (loan: CustomerLoan, accountId: string, amount: number, ts: number, note?: string) => void | Promise<void>;
  onSplitRepay: (allocations: Array<{ loan: CustomerLoan; amount: number }>, accountId: string, ts: number, note?: string) => Promise<boolean> | void;
  onClose: () => void;
  isMobile?: boolean;
}
function CashCounterModal({
  accounts, balances, loans, customers, getLoanRemaining, onAddToCash, onRepayLoan, onSplitRepay, onClose, isMobile = false,
}: CashCounterModalProps) {
  const t = useT();
  const countableAccounts = useMemo(
    () => accounts.filter(a => a.status === 'active' && a.currency !== 'USDT'),
    [accounts]
  );
  const [accountId, setAccountId] = useState(countableAccounts[0]?.id || '');
  const account = countableAccounts.find(a => a.id === accountId) || countableAccounts[0];

  const [counts, setCounts] = useState<Record<number, string>>({});
  const [step, setStep] = useState<CounterStep>('count');
  // Actions are not mutually exclusive: a merchant can put part of the same
  // counted cash onto the account balance and use the rest to repay one or
  // more open loans, all in a single pass.
  const [actions, setActions] = useState<Set<'add' | 'repay'>>(new Set());
  const [cashAmount, setCashAmount] = useState('');
  const [splitSelected, setSplitSelected] = useState<Set<string>>(new Set());
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const total = useMemo(
    () => NOTE_DENOMINATIONS.reduce((sum, d) => sum + d * num(counts[d], 0), 0),
    [counts]
  );
  const noteCountEntries = useMemo(
    () => NOTE_DENOMINATIONS.filter(d => num(counts[d], 0) > 0).map(d => ({ d, n: num(counts[d], 0) })),
    [counts]
  );
  const noteCountSummary = useMemo(
    () => noteCountEntries.map(({ d, n }) => `${n}×${d}`).join(' + '),
    [noteCountEntries]
  );

  const relevantLoans = useMemo(
    () => account ? loans.filter(l => l.currency === account.currency && getLoanRemaining(l) > 0) : [],
    [loans, account, getLoanRemaining]
  );
  const customerName = (id: string) => customers.find(c => c.id === id)?.name || id;

  const cashAllocated = actions.has('add') ? num(cashAmount, 0) : 0;
  const splitAllocated = useMemo(
    () => Array.from(splitSelected).reduce((sum, id) => sum + num(splitAmounts[id], 0), 0),
    [splitSelected, splitAmounts]
  );
  const totalAllocated = cashAllocated + (actions.has('repay') ? splitAllocated : 0);
  const splitLeftover = total - totalAllocated;

  // Cash is the "remainder" bucket: whenever loans are also being repaid,
  // keep the cash amount in sync with whatever the checked loans don't
  // absorb, the same way an unchecked-but-implied leftover works in the
  // pure loan-split flow. Loans are auto-filled first (see toggleSplitLoan)
  // and cash simply mops up what's left.
  useEffect(() => {
    if (!actions.has('add')) return;
    const leftover = actions.has('repay') ? Math.max(0, total - splitAllocated) : total;
    setCashAmount(String(leftover));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.has('add'), actions.has('repay'), splitAllocated, total]);

  const setCount = (denom: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    setCounts(prev => ({ ...prev, [denom]: value }));
  };
  const bumpCount = (denom: number, delta: number) => setCount(denom, String(Math.max(0, num(counts[denom], 0) + delta)));

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '9px 10px', fontSize: 12, borderRadius: 8,
    border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)', cursor: 'pointer', outline: 'none',
  };
  const optionStyle: React.CSSProperties = { background: 'var(--panel)', color: 'var(--text)' };

  const resetForClose = () => {
    setCounts({}); setStep('count'); setActions(new Set()); setCashAmount('');
    setSplitSelected(new Set()); setSplitAmounts({}); setNote(''); setErr('');
  };
  const closeAndReset = () => { resetForClose(); onClose(); };

  const defaultNote = () => note.trim() || `${t('noteCountLbl') || 'Note count'}: ${noteCountSummary}`;

  const toggleAction = (a: 'add' | 'repay') => {
    setActions(prev => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a); else next.add(a);
      return next;
    });
  };

  const toggleSplitLoan = (loan: CustomerLoan) => {
    setSplitSelected(prev => {
      const next = new Set(prev);
      if (next.has(loan.id)) {
        next.delete(loan.id);
      } else {
        next.add(loan.id);
        // Loans take priority over cash: fill this loan from what the other
        // checked loans haven't claimed. Cash (if also selected) absorbs
        // whatever loans leave over, via the effect above.
        const already = Array.from(next).reduce((sum, id) => sum + (id === loan.id ? 0 : num(splitAmounts[id], 0)), 0);
        const room = Math.max(0, total - already);
        setSplitAmounts(a => ({ ...a, [loan.id]: String(Math.min(getLoanRemaining(loan), room)) }));
      }
      return next;
    });
  };
  const setSplitAmount = (loanId: string, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    setSplitAmounts(prev => ({ ...prev, [loanId]: value }));
  };

  const handleConfirm = async () => {
    if (saving || !account) return;
    setErr('');
    const wantsAdd = actions.has('add');
    const wantsRepay = actions.has('repay');
    if (!wantsAdd && !wantsRepay) { setErr(t('enterValidAmount') || 'Choose at least one action.'); return; }

    const addAmt = wantsAdd ? num(cashAmount, 0) : 0;
    if (wantsAdd && !(addAmt > 0)) { setErr(t('enterValidAmount')); return; }

    const allocations = wantsRepay
      ? Array.from(splitSelected)
          .map(id => ({ loan: relevantLoans.find(l => l.id === id)!, amount: num(splitAmounts[id], 0) }))
          .filter(a => a.loan && a.amount > 0)
      : [];
    if (wantsRepay && allocations.length === 0) { setErr(t('loanRepaymentAccount') || 'Select at least one loan.'); return; }
    for (const a of allocations) {
      if (a.amount > getLoanRemaining(a.loan) + 0.005) { setErr(`${customerName(a.loan.customerId)}: ${t('loanPaymentCap') || 'amount exceeds what is owed'}`); return; }
    }
    if (addAmt + allocations.reduce((s, a) => s + a.amount, 0) > total + 0.005) {
      setErr(t('cashCounterSplitOverAllocated') || 'Allocated amount exceeds what you counted.');
      return;
    }

    setSaving(true);
    try {
      if (addAmt > 0) {
        const entry: CashLedgerEntry = {
          id: uid(), ts: Date.now(), type: 'deposit', accountId: account.id,
          direction: 'in', amount: addAmt, currency: account.currency,
          note: defaultNote(),
        };
        onAddToCash(entry);
      }
      if (allocations.length === 1) {
        await onRepayLoan(allocations[0].loan, account.id, allocations[0].amount, Date.now(), defaultNote());
      } else if (allocations.length > 1) {
        const ok = await onSplitRepay(allocations, account.id, Date.now(), defaultNote());
        if (ok === false) { setErr(t('saveFailed') || 'Save failed'); setSaving(false); return; }
      }
      closeAndReset();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const stepIndex = COUNTER_STEPS.indexOf(step);
  const stepLabel: Record<CounterStep, string> = {
    count: t('cashCounterStepCount') || 'Count',
    action: t('cashCounterStepChoose') || 'Choose',
    confirm: t('cashCounterStepConfirm') || 'Confirm',
  };

  if (!account) {
    return (
      <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} onClick={onClose}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
        <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360 }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>🧮 {t('countCashBtn') || 'Count Cash'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>{t('noCashAccountsTitle')}</div>
          <div className="formActions"><button className="btn secondary" onClick={onClose}>{t('cancel')}</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px', width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,.5)', maxHeight: isMobile ? '92vh' : '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>🧮 {t('countCashBtn') || 'Count Cash'}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          {COUNTER_STEPS.map((s, i) => (
            <Fragment key={s}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 999, fontSize: 9, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: i <= stepIndex ? 'var(--brand)' : 'var(--panel)',
                  color: i <= stepIndex ? '#fff' : 'var(--muted)',
                  border: i <= stepIndex ? 'none' : '1px solid var(--line)',
                }}>{i + 1}</div>
                <span style={{ fontSize: 10, fontWeight: 700, color: i <= stepIndex ? 'var(--text)' : 'var(--muted)' }}>{stepLabel[s]}</span>
              </div>
              {i < COUNTER_STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: i < stepIndex ? 'var(--brand)' : 'var(--line)' }} />}
            </Fragment>
          ))}
        </div>

        {step === 'count' && (
          <>
            <div className="field2" style={{ marginBottom: 14 }}>
              <div className="lbl">{t('cashAccountsTab')}</div>
              <select value={accountId || account.id} onChange={e => { setAccountId(e.target.value); setCounts({}); }} style={selectStyle}>
                {countableAccounts.map(a => (
                  <option key={a.id} value={a.id} style={optionStyle}>{a.name} — {fmtTotal(balances.get(a.id) || 0)} {a.currency}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
              {NOTE_DENOMINATIONS.map(d => {
                const n = num(counts[d], 0);
                return (
                  <div key={d} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
                    border: '1px solid ' + (n > 0 ? 'color-mix(in srgb, var(--brand) 35%, transparent)' : 'var(--line)'),
                    background: n > 0 ? 'color-mix(in srgb, var(--brand) 6%, transparent)' : 'var(--panel)',
                  }}>
                    <div style={{
                      width: 46, height: 30, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 900, flexShrink: 0, background: 'color-mix(in srgb, var(--brand) 14%, transparent)', color: 'var(--brand)',
                    }} className="mono">{d}</div>
                    <button
                      className="rowBtn" style={{ width: 32, height: 32, padding: 0, fontSize: 16, fontWeight: 800, flexShrink: 0 }}
                      onClick={() => bumpCount(d, -1)}
                      disabled={n === 0}
                    >−</button>
                    <input
                      inputMode="numeric" value={counts[d] ?? ''} onChange={e => setCount(d, e.target.value)}
                      placeholder="0" style={{ width: 48, textAlign: 'center', padding: '6px 4px', fontSize: 14, fontWeight: 700, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)' }}
                    />
                    <button
                      className="rowBtn" style={{ width: 32, height: 32, padding: 0, fontSize: 16, fontWeight: 800, flexShrink: 0 }}
                      onClick={() => bumpCount(d, 1)}
                    >+</button>
                    <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: n > 0 ? 'var(--text)' : 'var(--muted)' }} className="mono">
                      {n > 0 ? fmtAmt(d * n, account.currency) : '—'}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{
              background: total > 0 ? 'color-mix(in srgb, var(--good) 10%, transparent)' : 'color-mix(in srgb, var(--brand) 8%, transparent)',
              border: '1px solid ' + (total > 0 ? 'color-mix(in srgb, var(--good) 30%, transparent)' : 'color-mix(in srgb, var(--brand) 20%, transparent)'),
              borderRadius: 10, padding: '12px 14px', marginBottom: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('cashCounterTotalLbl') || 'Total counted'}</span>
                <span className="mono" style={{ fontWeight: 900, fontSize: 20, color: total > 0 ? 'var(--good)' : 'var(--brand)' }}>{fmtTotal(total)} {account.currency}</span>
              </div>
              {noteCountEntries.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{noteCountSummary}</div>
              )}
            </div>

            <div className="formActions">
              <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
              <button className="btn" disabled={!(total > 0)} onClick={() => setStep('action')}>
                {t('continueBtn') || 'Continue'}
              </button>
            </div>
          </>
        )}

        {step === 'action' && (
          <>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
              background: 'color-mix(in srgb, var(--good) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 25%, transparent)', borderRadius: 10, padding: '10px 14px',
            }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('cashCounterCountedLbl') || 'You counted'}</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 900 }}>{fmtTotal(total)} {account.currency}</div>
              </div>
              <button className="rowBtn" style={{ fontSize: 10 }} onClick={() => setStep('count')}>{t('cashCounterRecount') || '✏️ Recount'}</button>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{t('cashCounterActionPrompt') || 'What do you want to do with this cash? (pick one or both)'}</div>
            <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
              <button
                className="rowBtn" style={{
                  padding: '14px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-start', fontSize: 12, fontWeight: 700, textAlign: 'left',
                  border: '1px solid ' + (actions.has('add') ? 'color-mix(in srgb, var(--brand) 45%, transparent)' : 'var(--line)'),
                  background: actions.has('add') ? 'color-mix(in srgb, var(--brand) 8%, transparent)' : undefined,
                }}
                onClick={() => toggleAction('add')}
              >
                <input type="checkbox" checked={actions.has('add')} readOnly style={{ width: 16, height: 16, flexShrink: 0 }} />
                <span style={{ fontSize: 18 }}>➕</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>{t('cashCounterAddToCash') || 'Add to cash balance'}</span>
                  <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)' }}>{t('cashCounterAddToCashDesc') || `Deposit into ${account.name}`}</span>
                </span>
              </button>
              <button
                className="rowBtn" style={{
                  padding: '14px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-start', fontSize: 12, fontWeight: 700, textAlign: 'left',
                  border: '1px solid ' + (actions.has('repay') ? 'color-mix(in srgb, var(--brand) 45%, transparent)' : 'var(--line)'),
                  background: actions.has('repay') ? 'color-mix(in srgb, var(--brand) 8%, transparent)' : undefined,
                }}
                disabled={relevantLoans.length === 0}
                onClick={() => {
                  toggleAction('repay');
                  if (!actions.has('repay')) {
                    const first = relevantLoans[0];
                    if (first) toggleSplitLoan(first);
                  } else {
                    setSplitSelected(new Set()); setSplitAmounts({});
                  }
                }}
              >
                <input type="checkbox" checked={actions.has('repay')} readOnly style={{ width: 16, height: 16, flexShrink: 0 }} />
                <span style={{ fontSize: 18 }}>💳</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                  <span>{t('cashCounterRepayLoan') || 'Repay loan(s)'}</span>
                  <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)' }}>
                    {relevantLoans.length === 0 ? t('kpiNoLoans') : (t('cashCounterRepayLoanDesc') || 'Apply part or all of this cash to one or more customers')}
                  </span>
                </span>
              </button>
            </div>

            <div className="formActions">
              <button className="btn secondary" onClick={() => setStep('count')}>{t('back') || 'Back'}</button>
              <button className="btn" disabled={actions.size === 0} onClick={() => setStep('confirm')}>
                {t('continueBtn') || 'Continue'}
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            {actions.has('add') && (
              <div className="field2" style={{ marginBottom: 14 }}>
                <div className="lbl">{t('cashCounterAddToCash') || 'Add to cash balance'} → {account.name}</div>
                <div className="inputBox"><input inputMode="decimal" value={cashAmount} onChange={e => setCashAmount(e.target.value)} placeholder="0.00" /></div>
              </div>
            )}

            {actions.has('repay') && (
              <>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                  {t('cashCounterSplitHint') || 'Check off which customers this payment covers — the amount auto-fills up to what each owes.'}
                </div>
                <div style={{ display: 'grid', gap: 6, marginBottom: 12, maxHeight: 220, overflowY: 'auto' }}>
                  {relevantLoans.map(l => {
                    const checked = splitSelected.has(l.id);
                    const remaining = getLoanRemaining(l);
                    return (
                      <div key={l.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                        border: '1px solid ' + (checked ? 'color-mix(in srgb, var(--brand) 35%, transparent)' : 'var(--line)'),
                        background: checked ? 'color-mix(in srgb, var(--brand) 6%, transparent)' : 'var(--panel)',
                      }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleSplitLoan(l)} style={{ width: 16, height: 16, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customerName(l.customerId)}</div>
                          <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('loanRemaining')}: {fmtTotal(remaining)} {l.currency}</div>
                        </div>
                        {checked && (
                          <input
                            inputMode="decimal" value={splitAmounts[l.id] ?? ''} onChange={e => setSplitAmount(l.id, e.target.value)}
                            style={{ width: 72, textAlign: 'right', padding: '5px 6px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)' }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, marginBottom: 14,
              background: Math.abs(splitLeftover) < 0.005 ? 'color-mix(in srgb, var(--good) 10%, transparent)' : 'color-mix(in srgb, var(--warn) 10%, transparent)',
              border: '1px solid ' + (Math.abs(splitLeftover) < 0.005 ? 'color-mix(in srgb, var(--good) 30%, transparent)' : 'color-mix(in srgb, var(--warn) 30%, transparent)'),
            }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {splitLeftover > 0.005 ? (t('cashCounterLeftToAllocate') || 'Left to allocate') : splitLeftover < -0.005 ? (t('cashCounterOverAllocated') || 'Over-allocated') : (t('cashCounterFullyAllocated') || 'Fully allocated')}
              </span>
              <span className="mono" style={{ fontWeight: 900, fontSize: 14, color: Math.abs(splitLeftover) < 0.005 ? 'var(--good)' : 'var(--warn)' }}>
                {fmtTotal(Math.abs(splitLeftover))} {account.currency}
              </span>
            </div>

            <div className="field2" style={{ marginBottom: 14 }}>
              <div className="lbl">{t('noteOptional')}</div>
              <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} placeholder={noteCountSummary} /></div>
            </div>
            {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
            <div className="formActions">
              <button className="btn secondary" onClick={() => setStep('action')} disabled={saving}>{t('back') || 'Back'}</button>
              <button className="btn" style={{ background: 'var(--good)', color: '#000' }} onClick={handleConfirm} disabled={saving}>
                {saving ? `${t('saving') || 'Saving…'}` : (t('cashCounterConfirmAdd') || 'Confirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── AccountLedgerModal ────────────────────────────────────────────
// Per-account drill-down: everything added to or withdrawn from one
// specific cash account, newest first, with a running balance. Opened
// by tapping an account card in the Accounts tab — this is the detail
// view that used to live behind the standalone Ledger tab.
interface AccountLedgerModalProps {
  account: CashAccount;
  entries: CashLedgerEntry[];
  accounts: CashAccount[];
  balance: number;
  typeLabels: Record<LedgerEntryType, string>;
  onClose: () => void;
  isMobile?: boolean;
}
function AccountLedgerModal({ account, entries, accounts, balance, typeLabels, onClose, isMobile = false }: AccountLedgerModalProps) {
  const t = useT();
  const [typeFilter, setTypeFilter] = useState('');

  const sorted = useMemo(() => [...entries].sort((a, b) => a.ts - b.ts), [entries]);
  const runningBalances = useMemo(() => {
    const map = new Map<string, number>();
    let running = 0;
    for (const e of sorted) {
      running += e.direction === 'in' ? e.amount : -e.amount;
      map.set(e.id, running);
    }
    return map;
  }, [sorted]);

  const rows = useMemo(() => {
    let list = [...sorted].reverse();
    if (typeFilter) list = list.filter(e => e.type === typeFilter);
    return list;
  }, [sorted, typeFilter]);

  const totalsIn = useMemo(() => entries.filter(e => e.direction === 'in').reduce((s, e) => s + e.amount, 0), [entries]);
  const totalsOut = useMemo(() => entries.filter(e => e.direction === 'out').reduce((s, e) => s + e.amount, 0), [entries]);

  const usedTypes = useMemo(() => Array.from(new Set(entries.map(e => e.type))), [entries]);

  const selectStyle: React.CSSProperties = {
    padding: '6px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--line)',
    background: 'var(--panel)', color: 'var(--text)', cursor: 'pointer', outline: 'none',
  };
  const optionStyle: React.CSSProperties = { background: 'var(--panel)', color: 'var(--text)' };

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 12 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '20px 22px', width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,.5)', maxHeight: isMobile ? '92vh' : '86vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{account.name}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
              {account.bankName ? `${account.bankName}${account.branch ? ` · ${account.branch}` : ''} · ` : ''}{account.currency}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 14 }}>
          <div style={{ background: 'color-mix(in srgb, var(--brand) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 20%, transparent)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('availableBalanceLbl')}</div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 900, color: balance < 0 ? 'var(--bad)' : 'var(--text)' }}>{fmtTotal(balance)}</div>
          </div>
          <div style={{ background: 'color-mix(in srgb, var(--good) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 20%, transparent)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('ledgerTransferIn')}</div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 900, color: 'var(--good)' }}>+{fmtTotal(totalsIn)}</div>
          </div>
          <div style={{ background: 'color-mix(in srgb, var(--bad) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 20%, transparent)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('ledgerTransferOut')}</div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 900, color: 'var(--bad)' }}>−{fmtTotal(totalsOut)}</div>
          </div>
        </div>

        {usedTypes.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={selectStyle}>
              <option value="" style={optionStyle}>{t('allTypesOpt')}</option>
              {usedTypes.map(lType => (
                <option key={lType} value={lType} style={optionStyle}>{typeLabels[lType]}</option>
              ))}
            </select>
            {typeFilter && <button className="rowBtn" onClick={() => setTypeFilter('')}>✕ {t('clearAll')}</button>}
            <span className="muted" style={{ fontSize: 10 }}>{rows.length} {t('entriesCount')}</span>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="empty" style={{ padding: '24px 0' }}>
            <div className="empty-t">{t('noLedgerEntries')}</div>
            <div className="empty-s">{t('cashMovementsAppear')}</div>
          </div>
        ) : isMobile ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map(entry => {
              const contraAcc = entry.contraAccountId ? accounts.find(a => a.id === entry.contraAccountId) : null;
              const runBal = runningBalances.get(entry.id);
              const isIn = entry.direction === 'in';
              const isStockType = entry.type === 'stock_purchase' || entry.type === 'stock_refund' || entry.type === 'stock_edit_adjust';
              return (
                <div key={entry.id} className="panel" style={{ padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <span className={`pill ${isStockType ? 'warn' : isIn ? 'good' : 'bad'}`} style={{ fontSize: 10 }}>{typeLabels[entry.type]}</span>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{fmtDate(entry.ts)}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                    <div><span className="muted">{t('ledgerColAmount')}:</span> <strong className="mono" style={{ color: isIn ? 'var(--good)' : 'var(--bad)' }}>{isIn ? '+' : '−'}{fmtAmt(entry.amount, entry.currency)}</strong></div>
                    <div><span className="muted">{t('ledgerColBalance')}:</span> <strong className="mono">{runBal !== undefined ? fmtTotal(runBal) : '—'}</strong></div>
                    {contraAcc && <div style={{ gridColumn: 'span 2' }}><span className="muted">{t('transferLbl')}:</span> <strong>↔ {contraAcc.name}</strong></div>}
                    {entry.note && <div style={{ gridColumn: 'span 2', color: 'var(--muted)' }}>{entry.note}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ledgerColTime')}</th>
                  <th>{t('ledgerColType')}</th>
                  <th className="r">{t('ledgerColAmount')}</th>
                  <th className="r">{t('ledgerColBalance')}</th>
                  <th>{t('ledgerColLinked')}</th>
                  <th>{t('note')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(entry => {
                  const contraAcc = entry.contraAccountId ? accounts.find(a => a.id === entry.contraAccountId) : null;
                  const runBal = runningBalances.get(entry.id);
                  const isIn = entry.direction === 'in';
                  const isStockType = entry.type === 'stock_purchase' || entry.type === 'stock_refund' || entry.type === 'stock_edit_adjust';
                  return (
                    <tr key={entry.id}>
                      <td className="mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{fmtTs(entry.ts)}</td>
                      <td>
                        <span className={`pill ${isStockType ? 'warn' : isIn ? 'good' : 'bad'}`} style={{ fontSize: 9 }}>
                          {typeLabels[entry.type]}
                        </span>
                        {contraAcc && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>↔ {contraAcc.name}</span>}
                      </td>
                      <td className="mono r" style={{ color: isIn ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                        {isIn ? '+' : '−'}{fmtAmt(entry.amount, entry.currency)}
                      </td>
                      <td className="mono r" style={{ color: 'var(--muted)', fontSize: 11 }}>
                        {runBal !== undefined ? fmtTotal(runBal) : '—'}
                      </td>
                      <td style={{ fontSize: 10 }}>
                        {entry.linkedEntityType === 'batch' && (
                          <span className="pill" style={{ fontSize: 9 }}>📦 Batch</span>
                        )}
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.note || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface SplitRepaymentModalProps {
  statement: BuyerStatement;
  accounts: CashAccount[];
  onSave: (allocations: Array<{ loan: CustomerLoan; amount: number }>, accountId: string, ts: number, note?: string) => void;
  onClose: () => void;
  isMobile?: boolean;
}
/**
 * Records one physical payment that the buyer used to close several orders
 * at once. The merchant types the amount actually received, checks off
 * which open orders it covers, and the amount auto-fills into each order
 * as it's checked (capped at what that order still owes) — any leftover
 * is easy to see and nudge by hand before saving.
 */
function SplitRepaymentModal({ statement, accounts, onSave, onClose, isMobile = false }: SplitRepaymentModalProps) {
  const t = useT();
  const openLoans = useMemo(() => statement.loans.filter(r => !r.settled), [statement]);
  const [accountId, setAccountId] = useState(
    accounts.find(a => a.currency === statement.currency)?.id || accounts[0]?.id || ''
  );
  const [amountReceived, setAmountReceived] = useState('');
  const [date, setDate] = useState(() => toLocalInput(Date.now()));
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 6,
    border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)', cursor: 'pointer', outline: 'none',
  };
  const optionStyle: React.CSSProperties = { background: 'var(--panel)', color: 'var(--text)' };

  const receivedNum = num(amountReceived, 0) || 0;
  const allocatedTotal = useMemo(() => (
    Array.from(selected).reduce((sum, id) => sum + (num(amounts[id], 0) || 0), 0)
  ), [selected, amounts]);
  const unallocated = Math.round((receivedNum - allocatedTotal) * 100) / 100;

  const toggle = (loanId: string, remaining: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(loanId)) {
        next.delete(loanId);
      } else {
        next.add(loanId);
        // Auto-fill with whatever of the entered amount is still unallocated
        // (capped at what this order owes) — falls back to the full balance
        // when no amount has been typed in yet.
        const fill = receivedNum > 0
          ? Math.max(0, Math.min(remaining, Math.round((receivedNum - allocatedTotal) * 100) / 100))
          : remaining;
        setAmounts(a => (a[loanId] ? a : { ...a, [loanId]: String(fill || remaining) }));
      }
      return next;
    });
  };

  const handle = () => {
    if (!accountId) { setErr(t('loanRepaymentAccount')); return; }
    if (!(receivedNum > 0)) { setErr(t('loanSplitPaymentEnterAmount')); return; }
    if (selected.size === 0) { setErr(t('loanSplitPaymentPickOne')); return; }
    if (Math.abs(unallocated) > 0.01) { setErr(t('loanSplitPaymentMustMatch')); return; }
    const ts = new Date(date).getTime();
    if (!Number.isFinite(ts)) { setErr(t('date')); return; }
    const allocations: Array<{ loan: CustomerLoan; amount: number }> = [];
    for (const row of openLoans) {
      if (!selected.has(row.loan.id)) continue;
      const amt = num(amounts[row.loan.id], 0) || 0;
      if (!(amt > 0)) { setErr(t('enterValidAmount')); return; }
      if (amt > row.remaining + 0.005) { setErr(t('loanPaymentCap')); return; }
      allocations.push({ loan: row.loan, amount: amt });
    }
    onSave(allocations, accountId, ts, note.trim() || undefined);
  };

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px', width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{t('loanSplitPayment')}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>{t('loanSplitPaymentHint')}</div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanSplitPaymentAmountReceived')}</div>
          <div className="inputBox">
            <input
              inputMode="decimal"
              value={amountReceived}
              onChange={e => setAmountReceived(e.target.value)}
              placeholder="50000"
              autoFocus
            />
          </div>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanRepaymentAccount')}</div>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} style={selectStyle}>
            {accounts.map(a => <option key={a.id} value={a.id} style={optionStyle}>{a.name} ({a.currency})</option>)}
          </select>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanRepaymentDate')}</div>
          <div className="inputBox"><input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></div>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanNoteLabel')}</div>
          <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} placeholder={t('loanRepaymentNotePh')} /></div>
        </div>

        <div className="lbl" style={{ marginBottom: 6 }}>{t('loanSplitPaymentOrders')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, maxHeight: 240, overflowY: 'auto' }}>
          {openLoans.map(row => {
            const checked = selected.has(row.loan.id);
            return (
              <label
                key={row.loan.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
                  border: '1px solid var(--line)', background: checked ? 'var(--panel)' : 'transparent', cursor: 'pointer',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(row.loan.id, row.remaining)} />
                <span className="mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{row.ref}</span>
                <span style={{ flex: 1, fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.loan.note || '—'}
                </span>
                <span className="mono" style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {t('loanRemaining')}: {fmtTotal(row.remaining)}
                </span>
                {checked && (
                  <input
                    inputMode="decimal"
                    value={amounts[row.loan.id] ?? ''}
                    onChange={e => setAmounts(a => ({ ...a, [row.loan.id]: e.target.value }))}
                    style={{ width: 80, padding: '4px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' }}
                  />
                )}
              </label>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>{t('loanSplitPaymentAmountReceived')}</span>
            <strong className="mono">{fmtTotal(receivedNum)} {statement.currency}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>{t('loanSplitPaymentAllocated')}</span>
            <strong className="mono">{fmtTotal(allocatedTotal)} {statement.currency}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>{t('loanSplitPaymentUnallocated')}</span>
            <strong className="mono" style={{ color: Math.abs(unallocated) > 0.01 ? 'var(--bad)' : 'var(--good)' }}>
              {fmtTotal(unallocated)} {statement.currency}
            </strong>
          </div>
        </div>

        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        <div className="formActions">
          <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn" onClick={handle}>{t('loanSplitPaymentSave')}</button>
        </div>
      </div>
    </div>
  );
}

interface EditLoanModalProps {
  loan: CustomerLoan;
  customers: Customer[];
  onSave: (loanId: string, updates: { customerId: string; principal: number; note?: string }) => void;
  onClose: () => void;
  isMobile?: boolean;
}
function EditLoanModal({ loan, customers, onSave, onClose, isMobile = false }: EditLoanModalProps) {
  const t = useT();
  const [customerId, setCustomerId] = useState(loan.customerId);
  const [principal, setPrincipal] = useState(String(loan.principal));
  const [note, setNote] = useState(loan.note || '');
  const [err, setErr] = useState('');

  const principalNum = num(principal, 0);
  const alreadyRepaid = getLoanRepaid(loan);

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 6,
    border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)', cursor: 'pointer', outline: 'none',
  };
  const optionStyle: React.CSSProperties = { background: 'var(--panel)', color: 'var(--text)' };

  const handle = () => {
    if (!customerId) { setErr(t('loanSelectCustomer')); return; }
    if (!(principalNum > 0)) { setErr(t('enterValidAmount')); return; }
    if (principalNum < alreadyRepaid) { setErr(`${t('loanPrincipal')} < ${t('loanReceived')} (${fmtTotal(alreadyRepaid)})`); return; }
    onSave(loan.id, { customerId, principal: principalNum, note: note.trim() || undefined });
  };

  return (
    <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px', width: '100%', maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{t('edit')} — {t('loans')}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanCustomer')}</div>
          <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={selectStyle}>
            {customers.map(c => <option key={c.id} value={c.id} style={optionStyle}>{c.name}</option>)}
          </select>
        </div>

        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('loanPrincipal')} ({loan.currency})</div>
          <div className="inputBox"><input inputMode="decimal" value={principal} onChange={e => setPrincipal(e.target.value)} placeholder="0.00" autoFocus /></div>
        </div>

        <div className="field2" style={{ marginBottom: 14 }}>
          <div className="lbl">{t('loanNoteLabel')}</div>
          <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} placeholder="..." /></div>
        </div>

        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        <div className="formActions">
          <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn" onClick={handle}>{t('save') || t('edit')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Main CashManagement Component ─────────────────────────────────
interface CashManagementProps {
  state: TrackerState;
  applyState: (next: TrackerState) => void;
  /** DB-first commit variant — resolves only after the server acks. */
  applyStateAndCommit?: (next: TrackerState) => Promise<void>;
  /** Ref to the set of account IDs whose ledger was cleared — prevents sync from restoring them */
  clearedAccountIds?: MutableRefObject<Set<string>>;
}

export function CashManagement({ state, applyState, applyStateAndCommit, clearedAccountIds }: CashManagementProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const { user, merchantProfile } = useAuth();
  const accounts = state.cashAccounts || [];
  const ledger = state.cashLedger || [];
  const deletedLoanIds = state.deletedLoanIds || [];
  const loans = (state.customerLoans || []).filter(l => !deletedLoanIds.includes(l.id));

  // ── Pending exchange-order → loan queue ──
  const { data: exchangeOrders } = useExchangeP2POrders();
  const unlinkedSellOrders = useMemo(
    () => findUnlinkedCompletedSellOrders(exchangeOrders || [], state.customerLoans || []),
    [exchangeOrders, state.customerLoans],
  );
  const [pendingRateByOrderId, setPendingRateByOrderId] = useState<Record<string, number>>({});
  const [pendingCustomerByOrderId, setPendingCustomerByOrderId] = useState<Record<string, string>>({});
  const [creatingLoanOrderId, setCreatingLoanOrderId] = useState<string | null>(null);
  const rateForOrder = (orderId: string) => pendingRateByOrderId[orderId] ?? DEFAULT_QAR_RATE;
  const loanedTradeIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of loans) { if (l.tradeId) s.add(l.tradeId); }
    return s;
  }, [loans]);

  // ── Loans view: open loans by customer, closed loans by settlement month ──
  // A settled loan leaves the active list entirely — it belongs to the archive,
  // not to the "who still owes me" view.
  const [loanView, setLoanView] = useState<'active' | 'closed'>('active');
  const [loanQuery, setLoanQuery] = useState('');

  const customerList = useMemo(() => state.customers || [], [state.customers]);
  const filteredLoans = useMemo(() => {
    if (!loanQuery.trim()) return loans;
    return loans.filter(l => loanMatchesQuery(l, customerList.find(c => c.id === l.customerId)?.name, loanQuery));
  }, [loans, loanQuery, customerList]);

  const closedLoanMonths = useMemo(() => groupClosedLoansByMonth(filteredLoans, customerList), [filteredLoans, customerList]);

  // ── Buyer accounts ──────────────────────────────────────────────
  // One statement per buyer per currency, covering their whole history. The
  // receivables list shows only the buyers still carrying a balance; the
  // statement behind each row keeps the settled loans, so the document the
  // buyer receives is the full account and not just what is overdue today.
  const buyerStatements = useMemo(
    () => buildBuyerStatements({
      loans,
      customers: customerList,
      trades: state.trades || [],
      accounts,
    }),
    [loans, customerList, state.trades, accounts],
  );
  const bookTotals = useMemo(() => totalsByCurrency(buyerStatements), [buyerStatements]);
  const receivableStatements = useMemo(() => (
    buyerStatements.filter(s => s.outstanding > 0 && statementMatchesQuery(s, loanQuery))
  ), [buyerStatements, loanQuery]);

  /** The live loan and repayment behind a statement payment row, for editing it. */
  const findRepayment = useCallback((entry: StatementEntry) => {
    if (!entry.repaymentId) return null;
    const loan = loans.find(l => l.id === entry.loanId);
    const repayment = (loan?.repayments || []).find(r => r.id === entry.repaymentId);
    return loan && repayment ? { loan, repayment } : null;
  }, [loans]);

  // Tab counts ignore the search box — they describe the book, not the query.
  const activeLoanCount = useMemo(() => loans.filter(l => !isLoanClosed(l)).length, [loans]);
  const closedLoanCount = useMemo(() => loans.filter(isLoanClosed).length, [loans]);
  const monthLabel = useCallback((year: number, month: number) => (
    new Date(year, month, 1).toLocaleDateString(t.lang === 'ar' ? 'ar' : 'en', { month: 'long', year: 'numeric' })
  ), [t]);

  // Expanded buyer rows, keyed by `${customerId}:${currency}` — a buyer with
  // both QAR and USDT credit has one row per currency.
  const [expandedBuyerKeys, setExpandedBuyerKeys] = useState<Set<string>>(new Set());
  const toggleBuyer = (key: string) => {
    setExpandedBuyerKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  /** Which buyer's statement is open, by statement key. */
  const [statementKey, setStatementKey] = useState<string | null>(null);
  const openStatement = useMemo(
    () => buyerStatements.find(s => s.key === statementKey) || null,
    [buyerStatements, statementKey],
  );

  // ── Public statement links ───────────────────────────────────────
  const [statementLinks, setStatementLinks] = useState<PublicStatementLink[]>([]);
  const [statementLinksLoaded, setStatementLinksLoaded] = useState(false);
  const [creatingLinkKey, setCreatingLinkKey] = useState<string | null>(null);
  const [revokingLinkId, setRevokingLinkId] = useState<string | null>(null);
  /** Buyer statement key currently expanded inline, and its fetched report (not a link — the report itself, rendered on this page). */
  const [viewingReportKey, setViewingReportKey] = useState<string | null>(null);
  const [reportByKey, setReportByKey] = useState<Record<string, PublicStatement | 'loading' | 'error'>>({});

  const loadStatementLinks = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('buyer_statement_links')
      .select('id, customer_id, token, currency, created_at, revoked_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) { toast.error(t('statementLinkLoadFailed')); return; }
    setStatementLinks((data || []) as PublicStatementLink[]);
    setStatementLinksLoaded(true);
  }, [user?.id, t]);

  const activeLinkFor = useCallback(
    (customerId: string, currency: string) => statementLinks.find(
      l => l.customer_id === customerId && l.currency === currency && !l.revoked_at,
    ) || null,
    [statementLinks],
  );

  /** Creates the token record (needed for the edge function's service-role lookup) without surfacing a URL. */
  const ensureStatementLink = async (stmt: BuyerStatement): Promise<PublicStatementLink | null> => {
    const existing = activeLinkFor(stmt.customerId, stmt.currency);
    if (existing) return existing;
    if (!user?.id) return null;
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    const { data, error } = await supabase
      .from('buyer_statement_links')
      .insert({ user_id: user.id, customer_id: stmt.customerId, token, currency: stmt.currency })
      .select('id, customer_id, token, currency, created_at, revoked_at')
      .single();
    if (error || !data) return null;
    setStatementLinks(prev => [data as PublicStatementLink, ...prev]);
    return data as PublicStatementLink;
  };

  /** Fetches the report body itself (same shape the public page renders) so it can show inline, on this page — not just a link. */
  const viewStatementReport = async (stmt: BuyerStatement) => {
    if (viewingReportKey === stmt.key) { setViewingReportKey(null); return; }
    setViewingReportKey(stmt.key);
    if (reportByKey[stmt.key] && reportByKey[stmt.key] !== 'error') return;
    setReportByKey(prev => ({ ...prev, [stmt.key]: 'loading' }));
    setCreatingLinkKey(stmt.key);
    try {
      const link = await ensureStatementLink(stmt);
      if (!link) throw new Error('no link');
      // internal=1 keeps the USDT/rate columns in this merchant-facing preview —
      // the public /statements/:token page never sends that flag, so it never
      // gets those fields back from the edge function.
      const { data, error } = await supabase.functions.invoke(
        `public-buyer-statement?token=${encodeURIComponent(link.token)}&internal=1`,
        { method: 'GET' },
      );
      if (error || !data || (data as { error?: string }).error) throw new Error('fetch failed');
      setReportByKey(prev => ({ ...prev, [stmt.key]: data as PublicStatement }));
    } catch {
      setReportByKey(prev => ({ ...prev, [stmt.key]: 'error' }));
      toast.error(t('statementLinkCreateFailed'));
    } finally {
      setCreatingLinkKey(null);
    }
  };

  const copyStatementLink = async (link: PublicStatementLink) => {
    const url = `${window.location.origin}/statements/${link.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('statementLinkCopied'));
    } catch {
      toast.error(t('statementLinkCopyFailed'));
    }
  };

  const revokeStatementLink = async (link: PublicStatementLink) => {
    setRevokingLinkId(link.id);
    try {
      const { error } = await supabase
        .from('buyer_statement_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', link.id);
      if (error) throw error;
      await loadStatementLinks();
      const stmt = buyerStatements.find(s => s.customerId === link.customer_id && s.currency === link.currency);
      if (stmt) {
        setReportByKey(prev => { const next = { ...prev }; delete next[stmt.key]; return next; });
        if (viewingReportKey === stmt.key) setViewingReportKey(null);
      }
      toast.success(t('statementLinkRevoked'));
    } catch {
      toast.error(t('statementLinkRevokeFailed'));
    } finally {
      setRevokingLinkId(null);
    }
  };

  // Closed months start collapsed except the most recent one — the archive is
  // for looking things up, not for scrolling past.
  const [collapsedClosedMonths, setCollapsedClosedMonths] = useState<Set<string>>(new Set());
  const isClosedMonthOpen = (key: string) => (
    closedLoanMonths[0]?.key === key ? !collapsedClosedMonths.has(key) : collapsedClosedMonths.has(key)
  );
  const toggleClosedMonth = (key: string) => {
    setCollapsedClosedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const [expandedClosedLoanIds, setExpandedClosedLoanIds] = useState<Set<string>>(new Set());
  const toggleClosedLoan = (loanId: string) => {
    setExpandedClosedLoanIds(prev => {
      const next = new Set(prev);
      if (next.has(loanId)) next.delete(loanId); else next.add(loanId);
      return next;
    });
  };

  // ── Localized label maps (recomputed when language changes) ────
  const ACCOUNT_TYPE_LABELS: Record<CashAccountType, string> = useMemo(() => ({
    hand: t('accTypeHand'), 
    bank: t('accTypeBank'), 
    vault: t('accTypeVault'),
    merchant_custody: t('accTypeMerchant') || 'Merchant Custody',
  }), [t]);

  const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = useMemo(() => ({
    opening: t('ledgerOpening'),
    deposit: t('ledgerDeposit'),
    sale_deposit: 'Sale deposit',
    withdrawal: t('ledgerWithdrawal'),
    transfer_in: t('ledgerTransferIn'),
    transfer_out: t('ledgerTransferOut'),
    stock_purchase: t('ledgerStockPurchase'),
    stock_refund: t('ledgerStockRefund'),
    stock_edit_adjust: t('ledgerEditAdjust'),
    reconcile: t('ledgerReconcile'),
    merchant_funding_out: t('ledgerMerchantFundingOut') || 'Funding Merchant',
    merchant_funding_return: t('ledgerMerchantFundingReturn') || 'Funding Return',
    merchant_sale_proceeds: t('ledgerMerchantSaleProceeds') || 'Sale Proceeds',
    merchant_settlement_in: t('ledgerMerchantSettlementIn') || 'Settlement In',
    merchant_settlement_out: t('ledgerMerchantSettlementOut') || 'Settlement Out',
    merchant_fee: t('ledgerMerchantFee') || 'Merchant Fee',
    merchant_adjustment: t('ledgerMerchantAdjustment') || 'Merchant Adjustment',
    loan_disbursement: t('ledgerLoanDisbursement'),
    loan_repayment: t('ledgerLoanRepayment'),
  }), [t]);

  const [innerTab, setInnerTab] = useState<'accounts' | 'loans' | 'statements'>('accounts');
  useEffect(() => {
    if (innerTab === 'statements' && !statementLinksLoaded) loadStatementLinks();
  }, [innerTab, statementLinksLoaded, loadStatementLinks]);
  /** Account whose own ledger is currently open in the drill-down panel. */
  const [accountDetailId, setAccountDetailId] = useState<string | null>(null);
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [repayingLoan, setRepayingLoan] = useState<CustomerLoan | null>(null);
  /** Buyer statement whose open orders can be closed with one split payment. */
  const [splitPaymentStatement, setSplitPaymentStatement] = useState<BuyerStatement | null>(null);
  /** Which grouped-payment rows are expanded to show their per-order breakdown. */
  const [expandedPaymentGroups, setExpandedPaymentGroups] = useState<Set<string>>(new Set());
  const togglePaymentGroup = (id: string) => {
    setExpandedPaymentGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  /** Buyer statement key currently picking payments to merge into one, and which rows are checked. */
  const [mergePaymentsKey, setMergePaymentsKey] = useState<string | null>(null);
  const [mergePaymentSelection, setMergePaymentSelection] = useState<Set<string>>(new Set());
  const toggleMergeSelection = (groupId: string) => {
    setMergePaymentSelection(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };
  /** The payment being corrected, with the loan it belongs to. */
  const [editingRepayment, setEditingRepayment] = useState<{ loan: CustomerLoan; repayment: LoanRepayment } | null>(null);
  const [deletingRepayment, setDeletingRepayment] = useState<{ loan: CustomerLoan; repayment: LoanRepayment } | null>(null);
  const [editingLoan, setEditingLoan] = useState<CustomerLoan | null>(null);
  const [deleteLoanConfirmId, setDeleteLoanConfirmId] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<CashAccount | undefined>();
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFromId, setTransferFromId] = useState<string | undefined>();
  const [showDeposit, setShowDeposit] = useState<{ account: CashAccount; mode: 'deposit' | 'withdrawal' | 'funding' | 'proceeds' | 'settlement' } | null>(null);
  const [clearLedgerPromptId, setClearLedgerPromptId] = useState<string | null>(null);
  const [showCashCounter, setShowCashCounter] = useState(false);
  const [deleteAccountPromptId, setDeleteAccountPromptId] = useState<string | null>(null);
  const [showMerchantCustody, setShowMerchantCustody] = useState(false);

  const [counterparties, setCounterparties] = useState<NormalizedCounterparty[]>([]);

  const {
    pendingIncoming,
    pendingOutgoing,
    createRequest,
    respondRequest,
    cancelRequest,
  } = useCashCustodyRequests();

  const myMerchantId = merchantProfile?.merchant_id ?? '';
  const myUserId = user?.id ?? '';

  useEffect(() => {
    if (!myMerchantId || !myUserId) return;
    Promise.all([
      supabase.from('merchant_relationships').select('id, merchant_a_id, merchant_b_id, status'),
      supabase.from('merchant_profiles').select('merchant_id, user_id, display_name, nickname'),
    ]).then(([relRes, profRes]) => {
      const rels = relRes.data ?? [];
      const profs = profRes.data ?? [];
      const normalized = normalizeCounterparties(myMerchantId, myUserId, rels, profs);
      setCounterparties(normalized);
    });
  }, [myMerchantId, myUserId]);

  const balances = useMemo(() => getAllAccountBalances(accounts, ledger), [accounts, ledger]);

  const activeAccounts = accounts.filter(a => a.status === 'active');
  const totalQAR = useMemo(() => deriveCashQAR(accounts, ledger), [accounts, ledger]);
  const inHandQAR = useMemo(() => {
    return accounts.filter(a => a.type === 'hand' && a.status === 'active' && a.currency === 'QAR')
      .reduce((sum, a) => sum + (balances.get(a.id) || 0), 0);
  }, [accounts, balances]);
  const bankQAR = useMemo(() => {
    return accounts.filter(a => a.type === 'bank' && a.status === 'active' && a.currency === 'QAR')
      .reduce((sum, a) => sum + (balances.get(a.id) || 0), 0);
  }, [accounts, balances]);
  const vaultQAR = useMemo(() => {
    return accounts.filter(a => a.type === 'vault' && a.status === 'active' && a.currency === 'QAR')
      .reduce((sum, a) => sum + (balances.get(a.id) || 0), 0);
  }, [accounts, balances]);

  const custodyQAR = useMemo(() => {
    return accounts.filter(a => a.type === 'merchant_custody' && a.status === 'active' && a.currency === 'QAR')
      .reduce((sum, a) => sum + (balances.get(a.id) || 0), 0);
  }, [accounts, balances]);

  /** Active QAR account count per type — the "3 accounts" caption on each KPI box. */
  const accountCounts = useMemo(() => {
    const counts: Record<CashAccountType, number> = { hand: 0, bank: 0, vault: 0, merchant_custody: 0 };
    for (const a of accounts) {
      if (a.status === 'active' && a.currency === 'QAR') counts[a.type]++;
    }
    return counts;
  }, [accounts]);

  const total24hMovement = useMemo(() => {
    const since = Date.now() - 86400000;
    return ledger.filter(e => e.ts >= since).reduce((sum, e) => sum + (e.direction === 'in' ? e.amount : -e.amount), 0);
  }, [ledger]);

  // Loans can be issued in several currencies, and the header must not sum
  // them into one meaningless number. Totals stay per-currency: the currency
  // with the most outstanding leads each KPI box, the rest ride along in the
  // caption underneath it.
  const loanKpi = useMemo(() => {
    const byCurrency = new Map<CashCurrency, { given: number; received: number; remaining: number }>();
    const debtors = new Set<string>();
    let openCount = 0;
    for (const l of loans) {
      const agg = byCurrency.get(l.currency) || { given: 0, received: 0, remaining: 0 };
      const remaining = getLoanRemaining(l);
      agg.given += l.principal;
      agg.received += getLoanRepaid(l);
      agg.remaining += remaining;
      byCurrency.set(l.currency, agg);
      if (l.status === 'open') openCount++;
      if (remaining > 0) debtors.add(l.customerId);
    }
    const rows = Array.from(byCurrency.entries())
      .map(([currency, v]) => ({ currency, ...v }))
      .sort((a, b) => (b.remaining - a.remaining) || (b.given - a.given));
    const lead = rows[0];
    return {
      rows,
      lead,
      others: rows.slice(1),
      openCount,
      debtorCount: debtors.size,
      hasLoans: loans.length > 0,
      repaidPct: lead && lead.given > 0 ? (lead.received / lead.given) * 100 : 0,
    };
  }, [loans]);

  // ── Mutation helpers ───────────────────────────────────────────
  const commit = async (next: TrackerState): Promise<boolean> => {
    if (applyStateAndCommit) {
      try {
        await applyStateAndCommit(next);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Save failed: ${msg}`);
        return false;
      }
    }
    applyState(next);
    return true;
  };

  const addAccount = async (account: CashAccount, openingBalance: number) => {
    const newLedger = [...ledger];
    if (openingBalance > 0) {
      newLedger.push({
        id: uid(), ts: Date.now(), type: 'opening', accountId: account.id,
        direction: 'in', amount: openingBalance, currency: account.currency,
        note: 'Opening balance',
      });
    }
    const newAccounts = [...accounts, account];
    const newCashQAR = deriveCashQAR(newAccounts, newLedger);
    const ok = await commit({ ...state, cashAccounts: newAccounts, cashLedger: newLedger, cashQAR: newCashQAR });
    if (ok) setShowAddAccount(false);
  };

  const saveAccount = async (account: CashAccount) => {
    const newAccounts = accounts.map(a => a.id === account.id ? account : a);
    const ok = await commit({ ...state, cashAccounts: newAccounts });
    if (ok) setEditingAccount(undefined);
  };

  const deactivateAccount = async (id: string) => {
    const newAccounts = accounts.map(a => a.id === id ? { ...a, status: 'inactive' as const } : a);
    await commit({ ...state, cashAccounts: newAccounts });
  };

  const addLedgerEntry = async (entry: CashLedgerEntry) => {
    const newLedger = [...ledger, entry];
    const newCashQAR = deriveCashQAR(accounts, newLedger);
    const acc = accounts.find(a => a.id === entry.accountId);
    const legacyEntry = {
      id: entry.id,
      ts: entry.ts,
      type: (entry.direction === 'in' ? 'deposit' : 'withdraw') as 'deposit' | 'withdraw' | 'batch_purchase' | 'sale_deposit',
      amount: entry.amount,
      balanceAfter: newCashQAR,
      owner: acc?.name ?? '',
      bankAccount: acc?.bankName ?? '',
      note: entry.note ?? '',
    };
    const newCashHistory = [...(state.cashHistory || []), legacyEntry];
    const ok = await commit({ ...state, cashLedger: newLedger, cashQAR: newCashQAR, cashHistory: newCashHistory });
    if (ok) setShowDeposit(null);
  };

  const addTransfer = async (entries: [CashLedgerEntry, CashLedgerEntry]) => {
    const newLedger = [...ledger, ...entries];
    const newCashQAR = deriveCashQAR(accounts, newLedger);
    const ok = await commit({ ...state, cashLedger: newLedger, cashQAR: newCashQAR });
    if (ok) setShowTransfer(false);
  };

  const addLoan = async (input: { customerId: string; tradeId?: string; principal: number; currency: CashCurrency; fundingAccountId?: string; note?: string }) => {
    const loanId = uid();
    let newLedger = ledger;
    let disbursementLedgerEntryId: string | undefined;
    if (input.fundingAccountId) {
      const entry: CashLedgerEntry = {
        id: uid(), ts: Date.now(), type: 'loan_disbursement', accountId: input.fundingAccountId,
        direction: 'out', amount: input.principal, currency: input.currency,
        note: input.note || t('loans'),
      };
      newLedger = [...ledger, entry];
      disbursementLedgerEntryId = entry.id;
    }
    const loan: CustomerLoan = {
      id: loanId, ts: Date.now(), customerId: input.customerId, tradeId: input.tradeId,
      principal: input.principal, currency: input.currency, fundingAccountId: input.fundingAccountId,
      disbursementLedgerEntryId, repayments: [], note: input.note, status: 'open', createdAt: Date.now(),
    };
    const newCashQAR = deriveCashQAR(accounts, newLedger);
    const ok = await commit({ ...state, cashLedger: newLedger, cashQAR: newCashQAR, customerLoans: [...loans, loan] });
    if (ok) setShowNewLoan(false);
  };

  // Turns one pending exchange sell order into a customer loan at the rate
  // currently entered for that row. No cash account moves — the USDT already
  // left the exchange, so unlike addLoan there is no disbursement ledger
  // entry, only the loan record itself.
  const createLoanFromPendingOrder = async (order: ExchangeP2POrder) => {
    const customerId = pendingCustomerByOrderId[order.id];
    if (!customerId) { toast.error(t('exchangeLoanPickCustomer')); return; }
    const loan = createLoanFromExchangeOrder(order, customerId, rateForOrder(order.id));
    if (!loan) { toast.error(t('exchangeLoanCreateFailed')); return; }
    setCreatingLoanOrderId(order.id);
    try {
      const ok = await commit({ ...state, customerLoans: [...loans, loan] });
      if (ok) toast.success(t('exchangeLoanCreated'));
      else toast.error(t('exchangeLoanCreateFailed'));
    } finally {
      setCreatingLoanOrderId(null);
    }
  };

  const createLoansForAllPendingOrders = async () => {
    const ready = unlinkedSellOrders.filter(o => pendingCustomerByOrderId[o.id]);
    if (ready.length === 0) { toast.error(t('exchangeLoanPickCustomer')); return; }
    const newLoans = ready
      .map(o => createLoanFromExchangeOrder(o, pendingCustomerByOrderId[o.id], rateForOrder(o.id)))
      .filter((l): l is CustomerLoan => l !== null);
    if (newLoans.length === 0) return;
    setCreatingLoanOrderId('bulk');
    try {
      const ok = await commit({ ...state, customerLoans: [...loans, ...newLoans] });
      if (ok) toast.success(t('exchangeLoanCreated'));
      else toast.error(t('exchangeLoanCreateFailed'));
    } finally {
      setCreatingLoanOrderId(null);
    }
  };

  /** Default note on the cash-side row when the payment itself carries none. */
  const repaymentLedgerNote = (loan: CustomerLoan, note?: string) => {
    const customerName = (state.customers || []).find(c => c.id === loan.customerId)?.name || '';
    return note || `${t('loanAddRepayment')}${customerName ? ` — ${customerName}` : ''}`;
  };

  /** The loan list with `loan` swapped in. */
  const replaceLoan = (loan: CustomerLoan) => loans.map(l => (l.id === loan.id ? loan : l));

  const addLoanRepayment = async (loan: CustomerLoan, accountId: string, amount: number, ts: number, note?: string) => {
    // Wrapped end-to-end: a throw anywhere in here used to reject silently
    // (this runs from the modal's fire-and-forget onSave), leaving the click
    // looking like it did nothing. Now the modal awaits this and shows
    // whatever the error was instead.
    try {
      // The repayment itself is recorded ON the loan — the cash_ledger row is
      // only the money side. Deriving repaid totals from the ledger loses them:
      // its schema rejects loan-linked rows and strips the link column.
      const entry: CashLedgerEntry = {
        id: uid(), ts, type: 'loan_repayment', accountId,
        direction: 'in', amount, currency: loan.currency,
        note: repaymentLedgerNote(loan, note),
      };
      const repayment: LoanRepayment = {
        id: uid(), ts, amount, accountId, ledgerEntryId: entry.id, note,
      };
      const newLedger = [...ledger, entry];
      const updatedLoan = withDerivedStatus({ ...loan, repayments: [...(loan.repayments || []), repayment] });
      const newLoans = replaceLoan(updatedLoan);
      const newCashQAR = deriveCashQAR(accounts, newLedger);
      const ok = await commit({ ...state, cashLedger: newLedger, cashQAR: newCashQAR, customerLoans: newLoans });
      if (ok) {
        setRepayingLoan(null);
        toast.success(t('loanRepaymentAdded') || t('loanAddRepayment'));
      } else {
        // commit() already toasted the specific reason; still reject so the
        // modal's button stops showing "Saving…" instead of hanging on it.
        throw new Error('Save failed');
      }
    } catch (err) {
      console.error('[CashManagement] addLoanRepayment failed:', err);
      throw err;
    }
  };

  /**
   * Record one physical payment that the buyer used to close several
   * orders/loans at once. Each allocation still becomes its own ledger row
   * and repayment (a loan's balance can only be reduced by a repayment on
   * that loan), but every row shares one `batchId` so the statement can
   * show them as a single payment instead of one per order.
   */
  const addSplitLoanRepayment = async (
    allocations: Array<{ loan: CustomerLoan; amount: number }>,
    accountId: string,
    ts: number,
    note?: string,
  ) => {
    const batchId = uid();
    let newLedger = ledger;
    let newLoans = loans;
    for (const { loan, amount } of allocations) {
      const entry: CashLedgerEntry = {
        id: uid(), ts, type: 'loan_repayment', accountId,
        direction: 'in', amount, currency: loan.currency,
        note: repaymentLedgerNote(loan, note), batchId,
      };
      const repayment: LoanRepayment = {
        id: uid(), ts, amount, accountId, ledgerEntryId: entry.id, note, batchId,
      };
      newLedger = [...newLedger, entry];
      const updatedLoan = withDerivedStatus({ ...loan, repayments: [...(loan.repayments || []), repayment] });
      newLoans = newLoans.map(l => (l.id === updatedLoan.id ? updatedLoan : l));
    }
    const newCashQAR = deriveCashQAR(accounts, newLedger);
    const ok = await commit({ ...state, cashLedger: newLedger, cashQAR: newCashQAR, customerLoans: newLoans });
    if (ok) setSplitPaymentStatement(null);
    return ok;
  };

  /**
   * Retroactively link payments that were already recorded as separate rows
   * — because one physical payment was applied to several orders one at a
   * time, before there was a way to record that in one step — into a single
   * grouped payment. Only the `batchId` on each repayment changes; amounts,
   * accounts and dates are left exactly as recorded.
   */
  const mergeExistingPayments = async (targets: Array<{ loan: CustomerLoan; repayment: LoanRepayment }>) => {
    if (targets.length < 2) return false;
    const batchId = uid();
    let newLoans = loans;
    for (const { loan, repayment } of targets) {
      const live = newLoans.find(l => l.id === loan.id) || loan;
      const updatedRepayments = (live.repayments || []).map(r => (r.id === repayment.id ? { ...r, batchId } : r));
      newLoans = newLoans.map(l => (l.id === live.id ? { ...live, repayments: updatedRepayments } : l));
    }
    const ok = await commit({ ...state, customerLoans: newLoans });
    if (ok) { setMergePaymentsKey(null); setMergePaymentSelection(new Set()); }
    return ok;
  };

  /**
   * Correct a payment that was already recorded — amount, date, account or note.
   *
   * The companion cash row moves with it so account balances keep matching the
   * payments. A row that is no longer there (its account was cleared, or a sync
   * dropped it) is not recreated: only the recorded payment changes.
   */
  const updateLoanRepayment = async (
    loan: CustomerLoan, repaymentId: string, accountId: string, amount: number, ts: number, note?: string,
  ) => {
    // The dialog holds a snapshot; a sync may have landed another payment on
    // this loan since it opened, so edit the loan as it stands now.
    const live = loans.find(l => l.id === loan.id) || loan;
    const next = editRepayment(
      live, repaymentId, { accountId, amount, ts, note }, ledger, repaymentLedgerNote(live, note),
    );
    if (!next) { setEditingRepayment(null); return; }

    const ok = await commit({
      ...state,
      cashLedger: next.ledger,
      cashQAR: deriveCashQAR(accounts, next.ledger),
      customerLoans: replaceLoan(next.loan),
    });
    if (ok) { setEditingRepayment(null); toast.success(t('loanPaymentUpdated')); }
  };

  /** Drop a payment and the cash it credited — the loan reopens if this settled it. */
  const deleteLoanRepayment = async (loan: CustomerLoan, repaymentId: string) => {
    const next = deleteRepayment(loans.find(l => l.id === loan.id) || loan, repaymentId, ledger);
    if (!next) { setDeletingRepayment(null); return; }

    const ok = await commit({
      ...state,
      cashLedger: next.ledger,
      cashQAR: deriveCashQAR(accounts, next.ledger),
      customerLoans: replaceLoan(next.loan),
    });
    if (ok) { setDeletingRepayment(null); toast.success(t('loanPaymentDeleted')); }
  };

  const updateLoan = async (loanId: string, updates: { customerId: string; principal: number; note?: string }) => {
    const newLoans = loans.map(l => (l.id === loanId
      ? withDerivedStatus({ ...l, customerId: updates.customerId, principal: updates.principal, note: updates.note })
      : l));
    const ok = await commit({ ...state, customerLoans: newLoans });
    if (ok) setEditingLoan(null);
  };

  const deleteLoan = async (loanId: string) => {
    const loan = loans.find(l => l.id === loanId);
    if (!loan) { setDeleteLoanConfirmId(null); return; }
    // Reverse every cash-side effect this loan produced (disbursement +
    // repayments) so account balances stay correct after it's gone.
    const linkedLedgerIds = new Set([
      loan.disbursementLedgerEntryId,
      ...(loan.repayments || []).map(r => r.ledgerEntryId),
    ].filter(Boolean));
    const newLedger = ledger.filter(e => !linkedLedgerIds.has(e.id));
    const newLoans = loans.filter(l => l.id !== loanId);
    // Tombstone the id — see TrackerState.deletedLoanIds doc for why a plain
    // removal isn't enough to make a delete stick across tabs/devices.
    const newDeletedLoanIds = Array.from(new Set([...(state.deletedLoanIds || []), loanId])).slice(-500);
    const newCashQAR = deriveCashQAR(accounts, newLedger);
    const ok = await commit({ ...state, cashLedger: newLedger, cashQAR: newCashQAR, customerLoans: newLoans, deletedLoanIds: newDeletedLoanIds });
    if (ok) setDeleteLoanConfirmId(null);
  };

  // Printed as the issuer on every exported statement.
  const businessName = merchantProfile?.display_name || merchantProfile?.nickname || '';
  const stmtLabels = useMemo(() => statementLabels(t), [t]);

  /** The receivables book as a spreadsheet — every buyer, every loaned order. */
  const exportReceivablesBook = () => {
    const rows = receivableStatements.length > 0 ? receivableStatements : buyerStatements;
    if (rows.length === 0) return;
    const csv = buildReceivablesCsv(rows, stmtLabels, { businessName, lang: t.lang });
    downloadTextFile(`receivables-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success(t('loanExported'));
  };

  const clearLedgerEntries = async (id: string) => {
    // 1. Register this account as "cleared" so refreshFromCloud won't re-merge
    //    local-only entries for it during the sync window.
    clearedAccountIds?.current.add(id);

    // 2. Delete from cloud FIRST — so when the realtime postgres_changes event
    //    fires and refreshFromCloud() runs, the cloud is already empty and
    //    won't restore the cleared entries back into local state.
    try {
      await deleteCashAccountLedgerFromCloud(id);
    } catch (err) {
      console.error('[CashManagement] deleteCashAccountLedgerFromCloud failed:', err);
    }
    // 3. Commit the cleared state to cloud immediately (not debounced) so
    //    refreshFromCloud sees the cleared ledger and doesn't re-merge old entries.
    const newLedger = ledger.filter(e => e.accountId !== id && e.contraAccountId !== id);
    const newCashQAR = deriveCashQAR(accounts, newLedger);
    const nextState = { ...state, cashLedger: newLedger, cashQAR: newCashQAR };
    if (applyStateAndCommit) {
      try {
        await applyStateAndCommit(nextState);
      } catch (err) {
        console.error('[CashManagement] applyStateAndCommit after clear failed:', err);
        applyState(nextState);
      }
    } else {
      applyState(nextState);
    }

    // 4. Keep the account suppressed for 5s to cover any delayed realtime events,
    //    then remove it so future legitimate entries can sync normally.
    setTimeout(() => { clearedAccountIds?.current.delete(id); }, 5000);
  };

  const deleteAccount = async (id: string) => {
    // 1. Register this account as "cleared" so refreshFromCloud won't re-merge
    //    the account or its local-only ledger entries during the sync window.
    clearedAccountIds?.current.add(id);

    // 2. Delete from cloud FIRST — ledger rows before the account row (no FK
    //    ordering requirement, but this mirrors clearLedgerEntries) — so the
    //    realtime postgres_changes event finds the cloud already empty and
    //    doesn't restore anything into local state.
    try {
      await deleteCashAccountLedgerFromCloud(id);
      await deleteCashAccountFromCloud(id);
    } catch (err) {
      console.error('[CashManagement] deleteAccount cloud delete failed:', err);
    }

    // 3. Commit the account and its ledger entries removed from local state,
    //    with reconcile so this device's cloud copy matches (not debounced,
    //    so refreshFromCloud sees the deletion and doesn't re-merge it back).
    const newAccounts = accounts.filter(a => a.id !== id);
    const newLedger = ledger.filter(e => e.accountId !== id && e.contraAccountId !== id);
    const newCashQAR = deriveCashQAR(newAccounts, newLedger);
    const nextState = { ...state, cashAccounts: newAccounts, cashLedger: newLedger, cashQAR: newCashQAR };
    if (applyStateAndCommit) {
      try {
        await applyStateAndCommit(nextState);
      } catch (err) {
        console.error('[CashManagement] applyStateAndCommit after delete failed:', err);
        applyState(nextState);
      }
    } else {
      applyState(nextState);
    }

    // 4. Keep the account suppressed for 5s to cover any delayed realtime events.
    setTimeout(() => { clearedAccountIds?.current.delete(id); }, 5000);
  };

  const batchFundingSources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of state.batches || []) {
      if (b.fundingAccountId) {
        counts.set(b.fundingAccountId, (counts.get(b.fundingAccountId) || 0) + 1);
      }
    }
    return counts;
  }, [state.batches]);

  const concentrationWarning = useMemo(() => {
    if (totalQAR <= 0) return null;
    for (const acc of activeAccounts) {
      const bal = balances.get(acc.id) || 0;
      const pct = (bal / totalQAR) * 100;
      if (pct > 80 && totalQAR > 10000) return { account: acc, pct: Math.round(pct) };
    }
    return null;
  }, [activeAccounts, balances, totalQAR]);

  const tabBtn = (tab: typeof innerTab, label: string) => (
    <button
      onClick={() => setInnerTab(tab)}
      style={{
        padding: '6px 14px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
        borderRadius: 6, background: innerTab === tab ? 'var(--brand)' : 'transparent',
        color: innerTab === tab ? '#fff' : 'var(--muted)',
      }}>
      {label}
    </button>
  );

  // Add account modal with opening balance
  const [newOpeningBalance, setNewOpeningBalance] = useState('');
  const [pendingAccount, setPendingAccount] = useState<CashAccount | null>(null);

  const handleAccountSaved = (account: CashAccount) => {
    if (editingAccount) { saveAccount(account); return; }
    setPendingAccount(account);
  };

  return (
    <div className="tracker-root" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: isMobile ? 'max(8px, env(safe-area-inset-bottom))' : undefined }}>
      {/* ── KPI boxes ── */}
      <div className="cash-kpi-grid">
        <KpiBox
          icon="✋"
          label={t('inHandLbl')}
          value={fmtTotal(inHandQAR)}
          unit="QAR"
          tone="brand"
          onClick={() => setInnerTab('accounts')}
          sub={accountCounts.hand > 0
            ? `${accountCounts.hand} ${accountCounts.hand === 1 ? t('kpiAccountUnit') : t('kpiAccountsUnit')}${totalQAR > 0 ? ` · ${Math.round((inHandQAR / totalQAR) * 100)}% ${t('kpiOfPortfolio')}` : ''}`
            : t('kpiNoneYet')}
        />
        <KpiBox
          icon="🏦"
          label={t('banksLbl')}
          value={fmtTotal(bankQAR)}
          unit="QAR"
          tone="brand"
          onClick={() => setInnerTab('accounts')}
          sub={accountCounts.bank > 0
            ? `${accountCounts.bank} ${accountCounts.bank === 1 ? t('kpiAccountUnit') : t('kpiAccountsUnit')}${totalQAR > 0 ? ` · ${Math.round((bankQAR / totalQAR) * 100)}% ${t('kpiOfPortfolio')}` : ''}`
            : t('kpiNoneYet')}
        />
        {(vaultQAR !== 0 || accountCounts.vault > 0) && (
          <KpiBox
            icon="🔒"
            label={t('vaultLbl')}
            value={fmtTotal(vaultQAR)}
            unit="QAR"
            tone="brand"
            onClick={() => setInnerTab('accounts')}
            sub={`${accountCounts.vault} ${accountCounts.vault === 1 ? t('kpiAccountUnit') : t('kpiAccountsUnit')}`}
          />
        )}
        {(custodyQAR !== 0 || accountCounts.merchant_custody > 0) && (
          <KpiBox
            icon="🤝"
            label={t('kpiCustody')}
            value={fmtTotal(custodyQAR)}
            unit="QAR"
            tone="warn"
            onClick={() => setShowMerchantCustody(true)}
            sub={`${accountCounts.merchant_custody} ${accountCounts.merchant_custody === 1 ? t('kpiAccountUnit') : t('kpiAccountsUnit')}`}
          />
        )}
        <KpiBox
          icon="📤"
          label={t('kpiLoansOut')}
          value={loanKpi.lead ? fmtTotal(loanKpi.lead.remaining) : fmtTotal(0)}
          unit={loanKpi.lead ? loanKpi.lead.currency : 'QAR'}
          tone={loanKpi.lead && loanKpi.lead.remaining > 0 ? 'bad' : 'good'}
          progress={loanKpi.hasLoans ? loanKpi.repaidPct : undefined}
          onClick={() => setInnerTab('loans')}
          sub={!loanKpi.hasLoans ? t('kpiNoLoans') : (
            <>
              {loanKpi.openCount > 0
                ? `${loanKpi.openCount} ${t('loanCustomerOpenCount')} · ${loanKpi.debtorCount} ${loanKpi.debtorCount === 1 ? t('kpiCustomerUnit') : t('kpiCustomersUnit')}`
                : t('loanCustomerAllClosed')}
              {loanKpi.others.length > 0 && (
                <span className="cash-kpi-more">
                  {' + '}{loanKpi.others.map(o => `${fmtTotal(o.remaining)} ${o.currency}`).join(' · ')}
                </span>
              )}
            </>
          )}
        />
        <KpiBox
          icon="🤲"
          label={t('kpiLoansGiven')}
          value={loanKpi.lead ? fmtTotal(loanKpi.lead.given) : fmtTotal(0)}
          unit={loanKpi.lead ? loanKpi.lead.currency : 'QAR'}
          tone="neutral"
          onClick={() => setInnerTab('loans')}
          sub={loanKpi.others.length > 0
            ? loanKpi.others.map(o => `${fmtTotal(o.given)} ${o.currency}`).join(' · ')
            : loanKpi.hasLoans
              ? `${loans.length} ${t('loanCustomerCount')} · ${loanKpi.debtorCount} ${loanKpi.debtorCount === 1 ? t('kpiCustomerUnit') : t('kpiCustomersUnit')}`
              : t('kpiNoLoans')}
        />
        <KpiBox
          icon="📥"
          label={t('kpiLoansRepaid')}
          value={loanKpi.lead ? fmtTotal(loanKpi.lead.received) : fmtTotal(0)}
          unit={loanKpi.lead ? loanKpi.lead.currency : 'QAR'}
          tone="good"
          onClick={() => setInnerTab('loans')}
          sub={loanKpi.hasLoans && loanKpi.lead && loanKpi.lead.given > 0
            ? `${Math.round(loanKpi.repaidPct)}% ${t('kpiRepaidPct')}`
            : t('kpiNoLoans')}
        />
      </div>

      {/* ── Inner Tabs ── */}
      <div className="cash-inner-tabs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabBtn('accounts', t('cashAccountsTab'))}
          {tabBtn('loans', t('cashLoansTab'))}
          {tabBtn('statements', t('cashStatementsTab'))}
        </div>
        <button
          className="btn"
          style={{ padding: '6px 14px', fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', minHeight: isMobile ? 38 : undefined }}
          onClick={() => setShowCashCounter(true)}
        >
          <span className="cash-emoji">🧮</span> {t('countCashBtn') || 'Count Cash'}
        </button>
      </div>

      {/* ── ACCOUNTS TAB ── */}
      {innerTab === 'accounts' && (
        <div>
          {accounts.length === 0 ? (
            <div className="empty" style={{ padding: '32px 0' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 36, height: 36 }}>
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="9" y1="21" x2="9" y2="9"/>
              </svg>
              <div className="empty-t">{t('noCashAccountsTitle')}</div>
              <div className="empty-s">{t('noCashAccountsDesc')}</div>
              <button className="btn" style={{ marginTop: 12 }} onClick={() => setShowAddAccount(true)}>{t('addFirstAccountBtn')}</button>
            </div>
          ) : (
            <div className="cash-accounts-grid" style={isMobile ? { display: 'grid', gridTemplateColumns: '1fr', gap: 10 } : undefined}>
              {accounts.map(acc => {
                const bal = balances.get(acc.id) || 0;
                const mov24h = get24hMovement(acc.id, ledger);
                const batchCount = batchFundingSources.get(acc.id) || 0;
                const lastActivityEntry = [...ledger].filter(e => e.accountId === acc.id).sort((a, b) => b.ts - a.ts)[0];
                const isInactive = acc.status === 'inactive';
                const TypeIcon = ACCOUNT_TYPE_ICON[acc.type];

                return (
                  <div
                    key={acc.id} className="cash-account-card"
                    style={{ opacity: isInactive ? 0.5 : 1, padding: isMobile ? '10px 10px 12px' : undefined, cursor: 'pointer' }}
                    onClick={() => setAccountDetailId(acc.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: `color-mix(in srgb, var(--brand) 12%, transparent)`, border: '1px solid color-mix(in srgb, var(--brand) 25%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand)', flexShrink: 0 }}>
                          <TypeIcon />
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{acc.name}</div>
                          {acc.bankName && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{acc.bankName}{acc.branch ? ` · ${acc.branch}` : ''}</div>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span className={`pill ${isInactive ? '' : 'good'}`} style={{ fontSize: 9 }}>{ACCOUNT_TYPE_LABELS[acc.type]}</span>
                        <span className="pill" style={{ fontSize: 9 }}>{acc.currency}</span>
                        <span className={`pill ${isInactive ? '' : 'good'}`} style={{ fontSize: 9 }}>{isInactive ? t('accountInactiveLbl') : t('active')}</span>
                      </div>
                    </div>

                    {/* Balance */}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{t('availableBalanceLbl')}</div>
                      <div className="mono" style={{ fontSize: isMobile ? 'clamp(18px, 5vw, 24px)' : 18, fontWeight: 900, color: bal < 0 ? 'var(--bad)' : 'var(--text)', lineHeight: 1.05 }}>
                        {fmtTotal(bal)}<span style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', marginLeft: 4 }}>{acc.currency}</span>
                      </div>
                      {mov24h !== 0 && (
                        <div style={{ fontSize: 10, marginTop: 2, color: mov24h > 0 ? 'var(--good)' : 'var(--bad)' }}>
                          {mov24h > 0 ? '▲' : '▼'} {fmtTotal(Math.abs(mov24h))} {t('in24h')}
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, fontSize: 10, color: 'var(--muted)' }}>
                      {lastActivityEntry && <span>{t('lastActivity')}: {fmtDate(lastActivityEntry.ts)}</span>}
                      {batchCount > 0 && <span>• {batchCount} {t('batchesFunded')}</span>}
                    </div>

                    {/* Actions */}
                    {!isInactive && (
                      <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(2, 1fr)' }} onClick={e => e.stopPropagation()}>
                        {acc.type === 'merchant_custody' ? (
                          <>
                            <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setShowDeposit({ account: acc, mode: 'funding' })}>
                              <IconPlus /> {t('fundMerchant') || 'Fund'}
                            </button>
                            <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setShowDeposit({ account: acc, mode: 'proceeds' })}>
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              <span className="cash-emoji">📥</span> {t('recordProceeds' as any) || 'Proceeds'}
                            </button>
                            <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setShowDeposit({ account: acc, mode: 'settlement' })}>
                              <span className="cash-emoji">📤</span> {t('settleBack') || 'Settle'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setShowDeposit({ account: acc, mode: 'deposit' })}>
                              <IconPlus /> {t('depositTitle')}
                            </button>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setShowDeposit({ account: acc, mode: 'withdrawal' })}>
                              <IconMinus /> {t('withdrawTitle')}
                            </button>
                          </>
                        )}
                        <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => { setTransferFromId(acc.id); setShowTransfer(true); }}>
                          <IconTransfer /> {t('transferLbl')}
                        </button>
                        <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined }} onClick={() => setEditingAccount(acc)}><span className="cash-emoji">✏️</span> {t('edit')}</button>
                        <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 30%, transparent)' }} onClick={() => setClearLedgerPromptId(acc.id)}><span className="cash-emoji">🗑️</span> {t('clearLedger')}</button>
                        <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 30%, transparent)' }} onClick={() => setDeleteAccountPromptId(acc.id)}><span className="cash-emoji">❌</span> {t('deleteAccountBtn')}</button>
                      </div>
                    )}
                    {isInactive && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>{t('accountInactiveLbl')}</div>
                    )}
                  </div>
                );
              })}

              {/* Add account card */}
              <div className="cash-account-card cash-add-account-card" onClick={() => setShowAddAccount(true)}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--muted)' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 50, border: '1.5px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconPlus />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{t('addAccountBtn')}</div>
                  <div style={{ fontSize: 10, textAlign: 'center', lineHeight: 1.4 }}>{t('bankWalletHandDesc')}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PENDING CUSTODY REQUESTS (accounts tab inline) ── */}
      {innerTab === 'accounts' && (pendingIncoming.length > 0 || pendingOutgoing.length > 0) && (
        <div className="panel" style={{ marginTop: 4 }}>
          <div className="panel-head"><h2><span className="cash-emoji">🤝</span> {t('pendingCustodyRequests')}</h2></div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingIncoming.map(req => (
              <div key={req.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid color-mix(in srgb, var(--brand) 25%, transparent)', borderRadius: 8, background: 'color-mix(in srgb, var(--brand) 5%, transparent)' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{t('custodyIncoming')}: {req.requesterMerchantId}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {fmtTotal(req.amount)} {req.currency}{req.note ? ` — ${req.note}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn" style={{ fontSize: 10, padding: '5px 10px', background: 'var(--good)', color: '#000' }}
                    onClick={() => {
                      respondRequest.mutate({ id: req.id, action: 'accept' });
                      const existingCustodyAcc = accounts.find(a => a.type === 'merchant_custody' && ((req.relationshipId && a.relationshipId === req.relationshipId) || a.merchantId === req.requesterMerchantId));
                      const custodyAccId = existingCustodyAcc?.id ?? uid();
                      const newAccounts = existingCustodyAcc ? accounts : [...accounts, {
                        id: custodyAccId,
                        name: `Custody — ${req.requesterMerchantId}`,
                        type: 'merchant_custody' as CashAccountType,
                        currency: req.currency as CashCurrency,
                        status: 'active' as const,
                        merchantId: req.requesterMerchantId,
                        relationshipId: req.relationshipId,
                        isMerchantAccount: true,
                        purpose: 'custody' as const,
                        createdAt: Date.now(),
                      }];
                      const inEntry: CashLedgerEntry = {
                        id: uid(), ts: Date.now(),
                        type: 'transfer_in',
                        accountId: custodyAccId,
                        direction: 'in',
                        amount: req.amount,
                        currency: req.currency as CashCurrency,
                        note: `${t('custodyAcceptedFrom')} ${req.requesterMerchantId}`,
                        merchantId: req.requesterMerchantId,
                        relationshipId: req.relationshipId,
                      };
                      const newLedger = [...ledger, inEntry];
                      applyState({ ...state, cashAccounts: newAccounts, cashLedger: newLedger, cashQAR: deriveCashQAR(newAccounts, newLedger) });
                    }}>
                    ✓ {t('custodyAccept')}
                  </button>
                  <button className="rowBtn" style={{ fontSize: 10 }}
                    onClick={() => respondRequest.mutate({ id: req.id, action: 'reject' })}>
                    ✕ {t('custodyReject')}
                  </button>
                </div>
              </div>
            ))}
            {pendingOutgoing.map(req => (
              <div key={req.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid color-mix(in srgb, var(--muted) 25%, transparent)', borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{t('custodyOutgoingTo')}: {req.custodianMerchantId}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {fmtTotal(req.amount)} {req.currency}{req.note ? ` — ${req.note}` : ''} · <span style={{ color: 'var(--warn)' }}>{t('custodyPending')}</span>
                  </div>
                </div>
                <button className="rowBtn" style={{ fontSize: 10, color: 'var(--bad)' }}
                  onClick={() => cancelRequest.mutate(req.id)}>
                  {t('custodyCancel')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LOANS TAB ── */}
      {innerTab === 'loans' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{t('loanReceivables')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {buyerStatements.length > 0 && (
                <button className="rowBtn" onClick={exportReceivablesBook}>📊 {t('loanExportExcel')}</button>
              )}
              <button className="btn" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => setShowNewLoan(true)}>{t('newLoan')}</button>
            </div>
          </div>

          {/* Completed Binance/OKX sell orders waiting to become a customer loan */}
          {unlinkedSellOrders.length > 0 && (
            <div className="panel" style={{ marginBottom: 12, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, fontWeight: 800 }}>
                  {t('exchangeLoanQueueTitle')} ({unlinkedSellOrders.length})
                </div>
                <button
                  className="rowBtn"
                  disabled={creatingLoanOrderId !== null}
                  onClick={createLoansForAllPendingOrders}
                >
                  {t('exchangeLoanCreateAllBtn')}
                </button>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {unlinkedSellOrders.map(order => (
                  <div
                    key={order.id}
                    style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700 }}>{EXCHANGE_LABELS[order.exchange]}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{order.counterparty || '—'}</span>
                    <span style={{ fontSize: 11 }}>{order.total} {order.fiat}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>@ {order.price}</span>
                    {order.order_time && (
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(order.order_time).toLocaleString()}</span>
                    )}
                    <span style={{ fontSize: 9, color: 'var(--muted)' }}>{order.order_number}</span>

                    <select
                      className="input"
                      style={{ fontSize: 11, padding: '4px 6px', minWidth: 120 }}
                      value={pendingCustomerByOrderId[order.id] || ''}
                      onChange={e => setPendingCustomerByOrderId(prev => ({ ...prev, [order.id]: e.target.value }))}
                    >
                      <option value="">{t('exchangeLoanSelectCustomer')}</option>
                      {(state.customers || []).map((c: Customer) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--muted)' }}>
                      {t('exchangeLoanRateLabel')}
                      <input
                        type="number"
                        step="0.01"
                        className="input"
                        style={{ fontSize: 11, padding: '4px 6px', width: 70 }}
                        value={rateForOrder(order.id)}
                        onChange={e => setPendingRateByOrderId(prev => ({ ...prev, [order.id]: Number(e.target.value) || 0 }))}
                      />
                    </label>

                    <button
                      className="btn"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      disabled={creatingLoanOrderId !== null}
                      onClick={() => createLoanFromPendingOrder(order)}
                    >
                      {creatingLoanOrderId === order.id ? '…' : t('exchangeLoanCreateBtn')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The book in one line per currency: loaned, repaid, still owed */}
          {bookTotals.length > 0 && (
            <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
              {bookTotals.map(row => (
                <div key={row.currency} className="panel loan-totals">
                  <div className="loan-totals-cur">
                    <span className="pill" style={{ fontSize: 9 }}>{row.currency}</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)' }}>
                      {row.buyersOwing} {t('loanBuyersOwing')}
                    </span>
                  </div>
                  <div>
                    <div className="loan-totals-lbl">{t('loanColLoaned')}</div>
                    <div className="loan-num">{formatMoney(row.loaned)}</div>
                  </div>
                  <div>
                    <div className="loan-totals-lbl">{t('loanColRepaid')}</div>
                    <div className="loan-num" style={{ color: 'var(--good)' }}>{formatMoney(row.repaid)}</div>
                  </div>
                  <div>
                    <div className="loan-totals-lbl">{t('loanColOutstanding')}</div>
                    <div className="loan-num" style={{ color: row.outstanding > 0 ? 'var(--bad)' : 'var(--good)', fontSize: 14 }}>
                      {formatMoney(row.outstanding)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Active ↔ Closed */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {([
              ['active', t('loanTabActive'), activeLoanCount],
              ['closed', t('loanTabClosed'), closedLoanCount],
            ] as const).map(([view, label, count]) => {
              const on = loanView === view;
              return (
                <button
                  key={view}
                  onClick={() => setLoanView(view)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: isMobile ? '8px 12px' : '5px 12px', borderRadius: 999,
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    minHeight: isMobile ? 38 : undefined,
                    border: on ? '1.5px solid var(--brand)' : '1px solid var(--line)',
                    background: on ? 'color-mix(in srgb, var(--brand) 14%, transparent)' : 'var(--panel2)',
                    color: on ? 'var(--brand)' : 'var(--t2)',
                  }}
                >
                  {label}
                  <span className="mono" style={{ fontSize: 9, opacity: .8 }}>{count}</span>
                </button>
              );
            })}
          </div>

          {loans.length > 0 && (
            <div className="inputBox" style={{ marginBottom: 10 }}>
              <input
                value={loanQuery}
                onChange={e => setLoanQuery(e.target.value)}
                placeholder={t('loanSearchPlaceholder')}
                style={isMobile ? { fontSize: 16, minHeight: 40 } : undefined}
              />
            </div>
          )}

          {loans.length === 0 ? (
            <div className="empty" style={{ padding: '24px 0' }}>
              <div className="empty-t">{t('noLoansYet')}</div>
            </div>
          ) : loanView === 'active' ? (
            receivableStatements.length === 0 ? (
              <div className="empty" style={{ padding: '24px 0' }}>
                <div className="empty-t">{loanQuery.trim() ? t('loanNoSearchMatch') : t('loanNoOutstanding')}</div>
              </div>
            ) : (
              /* One row per buyer account — the receivables ledger */
              <div className="loan-book">
                <div className="loan-book-head loan-cols">
                  <span>{t('loanColBuyer')}</span>
                  <span className="r">{t('loanColOrders')}</span>
                  <span className="r">{t('loanColLoaned')}</span>
                  <span className="r">{t('loanColRepaid')}</span>
                  <span className="r">{t('loanColOutstanding')}</span>
                  <span className="r">{t('loanColLastPayment')}</span>
                  <span />
                </div>

                {receivableStatements.map(stmt => {
                  const expanded = expandedBuyerKeys.has(stmt.key);
                  const pct = stmt.totalLoaned > 0
                    ? Math.min(100, Math.round((stmt.totalRepaid / stmt.totalLoaned) * 100))
                    : 0;
                  const overdue = stmt.oldestOpenDays > 30;
                  const payments = stmt.entries.filter(e => e.kind === 'payment');
                  const paymentGroups = groupPayments(payments);
                  const isMergingHere = mergePaymentsKey === stmt.key;
                  return (
                    <div key={stmt.key} className="panel" style={{ padding: 0, overflow: 'hidden' }}>
                      <button className="loan-row loan-cols" onClick={() => toggleBuyer(stmt.key)}>
                        <div className="loan-cell-buyer">
                          <div style={{ fontSize: 12.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {stmt.customerName}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <span className="pill" style={{ fontSize: 9 }}>{stmt.currency}</span>
                            <span className={`pill ${overdue ? 'bad' : 'warn'}`} style={{ fontSize: 9 }}>
                              {stmt.oldestOpenDays}{t('loanDaysShort')}{overdue ? ` · ${t('loanOverdueTag')}` : ''}
                            </span>
                            {stmt.phone && <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>{stmt.phone}</span>}
                          </div>
                        </div>
                        <div className="r">
                          <div className="loan-cell-lbl">{t('loanColOrders')}</div>
                          <span className="mono" style={{ fontSize: 11 }}>{stmt.openCount}/{stmt.loans.length}</span>
                        </div>
                        <div className="r">
                          <div className="loan-cell-lbl">{t('loanColLoaned')}</div>
                          <span className="loan-num">{formatMoney(stmt.totalLoaned)}</span>
                        </div>
                        <div className="r">
                          <div className="loan-cell-lbl">{t('loanColRepaid')}</div>
                          <span className="loan-num" style={{ color: 'var(--good)' }}>{formatMoney(stmt.totalRepaid)}</span>
                        </div>
                        <div className="r">
                          <div className="loan-cell-lbl">{t('loanColOutstanding')}</div>
                          <span className="loan-num" style={{ color: 'var(--bad)', fontSize: 13 }}>{formatMoney(stmt.outstanding)}</span>
                          <div className="prog loan-prog" style={{ height: 4 }}>
                            <span style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--good)' : 'var(--warn)' }} />
                          </div>
                          <div style={{ fontSize: 8.5, color: 'var(--muted)', marginTop: 2 }}>{pct}% {t('loanRepaidPctLabel')}</div>
                        </div>
                        <div className="r">
                          <div className="loan-cell-lbl">{t('loanColLastPayment')}</div>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {stmt.lastPaymentTs != null ? fmtDate(stmt.lastPaymentTs) : t('loanNoPaymentsYet')}
                          </span>
                        </div>
                        <span
                          className="loan-cell-chev mono"
                          style={{ fontSize: 11, color: 'var(--muted)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
                        >
                          ▾
                        </span>
                      </button>

                      {expanded && (
                        <div className="loan-detail">
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <button
                              className="btn"
                              style={{ padding: '6px 14px', fontSize: 11 }}
                              onClick={() => setStatementKey(stmt.key)}
                            >
                              📄 {t('loanStatementOpen')}
                            </button>
                            {stmt.openCount > 0 && (
                              <button
                                className="rowBtn"
                                style={{ padding: '6px 14px', fontSize: 11 }}
                                onClick={() => setSplitPaymentStatement(stmt)}
                              >
                                🔗 {t('loanSplitPayment')}
                              </button>
                            )}
                          </div>

                          {/* Every open loaned order on this account. Once an order is closed it
                              belongs on the dedicated Closed tab, not mixed in here — this list
                              stays scoped to what the buyer still owes. */}
                          {(() => {
                            const openLoanRows = stmt.loans.filter(row => !row.settled);
                            const loanRow = (row: typeof stmt.loans[number]) => (
                              <tr key={row.loan.id}>
                                <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                                  {row.loan.tradeId ? '🔗 ' : ''}{row.ref}
                                </td>
                                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.loan.ts)}</td>
                                <td style={{ color: 'var(--muted)', minWidth: 150 }}>{row.loan.note || '—'}</td>
                                <td className="r loan-num">{formatMoney(row.principal)}</td>
                                <td className="r loan-num" style={{ color: 'var(--good)' }}>{formatMoney(row.repaid)}</td>
                                <td className="r loan-num" style={{ color: row.remaining > 0 ? 'var(--bad)' : 'var(--good)' }}>
                                  {formatMoney(row.remaining)}
                                </td>
                                <td>
                                  <span className={`pill ${row.settled ? 'good' : 'warn'}`} style={{ fontSize: 9 }}>
                                    {row.settled ? t('loanStatusClosed') : `${t('loanStatusOpen')} · ${row.ageDays}${t('loanDaysShort')}`}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                    {!row.settled && (
                                      <button
                                        className="rowBtn"
                                        style={{ padding: '2px 8px', fontSize: 9, minHeight: 22, whiteSpace: 'nowrap' }}
                                        onClick={() => setRepayingLoan(row.loan)}
                                      >
                                        + {t('loanAddRepayment')}
                                      </button>
                                    )}
                                    <button
                                      className="rowBtn"
                                      style={{ padding: '2px 8px', fontSize: 9, minHeight: 22 }}
                                      onClick={() => setEditingLoan(row.loan)}
                                    >
                                      {t('edit')}
                                    </button>
                                    <button
                                      className="rowBtn"
                                      style={{ padding: '2px 8px', fontSize: 9, minHeight: 22, color: 'var(--bad)' }}
                                      onClick={() => setDeleteLoanConfirmId(row.loan.id)}
                                    >
                                      {t('delete')}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                            return (
                              <div>
                                <div className="acct-sec">{t('stmtLoanedOrders')} · {openLoanRows.length}</div>
                                <div className="tableWrap">
                                  <table className="acct-table">
                                    <thead>
                                      <tr>
                                        <th>{t('loanColRef')}</th>
                                        <th>{t('loanColDate')}</th>
                                        <th>{t('loanColDescription')}</th>
                                        <th className="r">{t('loanColAmount')}</th>
                                        <th className="r">{t('loanColPaid')}</th>
                                        <th className="r">{t('loanColRemaining')}</th>
                                        <th>{t('loanColStatus')}</th>
                                        <th />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {openLoanRows.length === 0 ? (
                                        <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 14 }}>{t('loanNoOpenOrders')}</td></tr>
                                      ) : openLoanRows.map(loanRow)}
                                    </tbody>
                                    <tfoot>
                                      <tr>
                                        <td colSpan={3} style={{ fontWeight: 700 }}>{t('stmtSummary')}</td>
                                        <td className="r loan-num">{formatMoney(stmt.totalLoaned)}</td>
                                        <td className="r loan-num" style={{ color: 'var(--good)' }}>{formatMoney(stmt.totalRepaid)}</td>
                                        <td className="r loan-num" style={{ color: 'var(--bad)' }}>{formatMoney(stmt.outstanding)}</td>
                                        <td colSpan={2} />
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Every payment this buyer has made, newest first — payments split
                              across several orders in one physical transaction are shown as
                              a single grouped row, expandable to the per-order breakdown. */}
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                              <div className="acct-sec">{t('stmtPaymentsReceived')} · {payments.length}</div>
                              {paymentGroups.length > 1 && (
                                isMergingHere ? (
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <span style={{ fontSize: 9, color: 'var(--muted)' }}>
                                      {t('loanMergeSelectedCount').replace('{n}', String(mergePaymentSelection.size))}
                                    </span>
                                    <button
                                      className="rowBtn"
                                      style={{ padding: '4px 10px', fontSize: 10 }}
                                      onClick={() => { setMergePaymentsKey(null); setMergePaymentSelection(new Set()); }}
                                    >
                                      {t('cancel')}
                                    </button>
                                    <button
                                      className="btn"
                                      style={{ padding: '4px 10px', fontSize: 10 }}
                                      disabled={mergePaymentSelection.size < 2}
                                      onClick={() => {
                                        const targets = paymentGroups
                                          .filter(g => mergePaymentSelection.has(g.id))
                                          .flatMap(g => g.members)
                                          .map(findRepayment)
                                          .filter((x): x is { loan: CustomerLoan; repayment: LoanRepayment } => !!x);
                                        mergeExistingPayments(targets);
                                      }}
                                    >
                                      {t('loanMergeConfirm').replace('{n}', String(mergePaymentSelection.size))}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    className="rowBtn"
                                    style={{ padding: '4px 10px', fontSize: 10 }}
                                    onClick={() => { setMergePaymentsKey(stmt.key); setMergePaymentSelection(new Set()); }}
                                  >
                                    🔗 {t('loanMergePayments')}
                                  </button>
                                )
                              )}
                            </div>
                            <div className="tableWrap">
                              <table className="acct-table">
                                <thead>
                                  <tr>
                                    {isMergingHere && <th />}
                                    <th>{t('loanColDate')}</th>
                                    <th>{t('loanColRef')}</th>
                                    <th className="r">{t('loanColAmount')}</th>
                                    <th>{t('loanColAccount')}</th>
                                    <th>{t('loanNoteLabel')}</th>
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {payments.length === 0 ? (
                                    <tr>
                                      <td colSpan={isMergingHere ? 7 : 6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 14 }}>
                                        {t('loanNoPaymentsYet')}
                                      </td>
                                    </tr>
                                  ) : [...paymentGroups].reverse().map(group => {
                                    const isBatch = group.members.length > 1;
                                    const isExpanded = expandedPaymentGroups.has(group.id);
                                    const single = !isBatch ? group.members[0] : null;
                                    const target = single ? findRepayment(single) : null;
                                    return (
                                      <Fragment key={group.id}>
                                        <tr>
                                          {isMergingHere && (
                                            <td>
                                              <input
                                                type="checkbox"
                                                checked={mergePaymentSelection.has(group.id)}
                                                onChange={() => toggleMergeSelection(group.id)}
                                              />
                                            </td>
                                          )}
                                          <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtTs(group.ts)}</td>
                                          <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                                            {isBatch ? (
                                              <button
                                                className="rowBtn"
                                                style={{ padding: '1px 6px', fontSize: 9, minHeight: 18 }}
                                                onClick={() => togglePaymentGroup(group.id)}
                                              >
                                                {isExpanded ? '▾' : '▸'} {t('loanSplitPaymentBadge').replace('{n}', String(group.members.length))}
                                              </button>
                                            ) : group.refs[0]}
                                          </td>
                                          <td className="r loan-num" style={{ color: 'var(--good)' }}>+{formatMoney(group.credit)}</td>
                                          <td style={{ color: 'var(--muted)' }}>{group.accountName || '—'}</td>
                                          <td style={{ color: 'var(--muted)', minWidth: 140 }}>{group.description || '—'}</td>
                                          <td>
                                            {!isMergingHere && target && (
                                              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                                <button
                                                  className="rowBtn"
                                                  style={{ padding: '2px 8px', fontSize: 9, minHeight: 22 }}
                                                  onClick={() => setEditingRepayment(target)}
                                                >
                                                  {t('edit')}
                                                </button>
                                                <button
                                                  className="rowBtn"
                                                  style={{ padding: '2px 8px', fontSize: 9, minHeight: 22, color: 'var(--bad)' }}
                                                  onClick={() => setDeletingRepayment(target)}
                                                >
                                                  {t('delete')}
                                                </button>
                                              </div>
                                            )}
                                            {/* A split payment is several separate repayment records, not one --
                                                there's nothing here to edit as a single row. Point at the expand
                                                toggle instead of leaving this cell looking broken/empty. */}
                                            {!isMergingHere && !target && isBatch && (
                                              <span style={{ fontSize: 9, color: 'var(--muted)', fontStyle: 'italic' }}>
                                                {isExpanded ? t('loanSplitEditHintExpanded') : t('loanSplitEditHint')}
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                        {isBatch && isExpanded && group.members.map(m => {
                                          const memberTarget = findRepayment(m);
                                          return (
                                            <tr key={m.id} style={{ background: 'var(--panel2)' }}>
                                              {isMergingHere && <td />}
                                              <td className="mono" style={{ whiteSpace: 'nowrap', paddingInlineStart: 20, color: 'var(--muted)' }}>{fmtTs(m.ts)}</td>
                                              <td className="mono" style={{ whiteSpace: 'nowrap' }}>{m.ref}</td>
                                              <td className="r loan-num" style={{ color: 'var(--good)' }}>+{formatMoney(m.credit)}</td>
                                              <td style={{ color: 'var(--muted)' }}>{m.accountName || '—'}</td>
                                              <td style={{ color: 'var(--muted)', minWidth: 140 }}>{m.description || '—'}</td>
                                              <td>
                                                {!isMergingHere && memberTarget && (
                                                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                                    <button
                                                      className="rowBtn"
                                                      style={{ padding: '2px 8px', fontSize: 9, minHeight: 22 }}
                                                      onClick={() => setEditingRepayment(memberTarget)}
                                                    >
                                                      {t('edit')}
                                                    </button>
                                                    <button
                                                      className="rowBtn"
                                                      style={{ padding: '2px 8px', fontSize: 9, minHeight: 22, color: 'var(--bad)' }}
                                                      onClick={() => setDeletingRepayment(memberTarget)}
                                                    >
                                                      {t('delete')}
                                                    </button>
                                                  </div>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                                {payments.length > 0 && (
                                  <tfoot>
                                    <tr>
                                      <td colSpan={isMergingHere ? 3 : 2} style={{ fontWeight: 700 }}>{t('loanColRepaid')}</td>
                                      <td className="r loan-num" style={{ color: 'var(--good)' }}>{formatMoney(stmt.totalRepaid)}</td>
                                      <td colSpan={3} />
                                    </tr>
                                  </tfoot>
                                )}
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : closedLoanMonths.length === 0 ? (
            <div className="empty" style={{ padding: '24px 0' }}>
              <div className="empty-t">{loanQuery.trim() ? t('loanNoSearchMatch') : t('loanNoClosedLoans')}</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {closedLoanMonths.map(month => {
                const open = isClosedMonthOpen(month.key);
                return (
                  <div key={month.key} className="panel" style={{ padding: 0, overflow: 'hidden' }}>
                    <button
                      onClick={() => toggleClosedMonth(month.key)}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%',
                        padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                        minHeight: isMobile ? 44 : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
                        <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'capitalize' }}>{monthLabel(month.year, month.month)}</span>
                        <span className="pill good" style={{ fontSize: 9 }}>{month.entries.length} {t('loanSettledInMonth')}</span>
                      </div>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--good)', fontWeight: 700, textAlign: 'right' }}>
                        {month.totalsByCurrency.map(([currency, totals]) => fmtAmt(totals.received, currency)).join(' · ')}
                      </span>
                    </button>

                    {open && (
                      <div style={{ display: 'grid', gap: 6, padding: '0 12px 12px' }}>
                        {month.entries.map(({ loan, customer, closedAt }) => {
                          const repayments = [...(loan.repayments || [])].sort((a, b) => b.ts - a.ts);
                          const showDetail = expandedClosedLoanIds.has(loan.id);
                          return (
                            <div key={loan.id} className="panel" style={{ padding: 10, background: 'var(--panel2)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {customer?.name || loan.customerId}
                                  </div>
                                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>
                                    <span className="mono">{t('loanClosedOn')} {fmtDate(closedAt)}</span>
                                    {repayments.length > 0 && <span> · {repayments.length} {t('loanPaymentCount')}</span>}
                                    {loan.tradeId && <span> · 🔗</span>}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                  <span className="mono" style={{ fontSize: 12, fontWeight: 800 }}>{fmtAmt(loan.principal, loan.currency)}</span>
                                  <button
                                    className="rowBtn"
                                    style={{ padding: '2px 6px', fontSize: 9, minHeight: 22 }}
                                    onClick={() => toggleClosedLoan(loan.id)}
                                  >
                                    {showDetail ? t('loanHideDetails') : t('loanViewDetails')}
                                  </button>
                                </div>
                              </div>

                              {showDetail && (
                                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line2)' }}>
                                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>
                                    <span className="mono">{t('loanIssuedOn')} {fmtDate(loan.ts)}</span>
                                    {loan.note ? ` · ${loan.note}` : ''}
                                  </div>
                                  {repayments.length > 0 && (
                                    <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                                      {repayments.map(r => {
                                        const acc = accounts.find(a => a.id === r.accountId);
                                        return (
                                          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10 }}>
                                            <span className="mono" style={{ color: 'var(--muted)' }}>{fmtTs(r.ts)}</span>
                                            <span className="mono" style={{ color: 'var(--good)', fontWeight: 700 }}>+{fmtTotal(r.amount)}</span>
                                            <span style={{ color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {acc?.name || ''}{r.note ? ` · ${r.note}` : ''}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    {/* A settled account still gets a statement — it is the buyer's receipt. */}
                                    <button
                                      className="rowBtn"
                                      style={{ padding: '2px 8px', fontSize: 9, minHeight: 22 }}
                                      onClick={() => setStatementKey(`${loan.customerId}:${loan.currency}`)}
                                    >
                                      📄 {t('loanStatement')}
                                    </button>
                                    <button className="rowBtn" style={{ padding: '2px 8px', fontSize: 9, minHeight: 22 }} onClick={() => setEditingLoan(loan)}>{t('edit')}</button>
                                    <button className="rowBtn" style={{ padding: '2px 8px', fontSize: 9, minHeight: 22, color: 'var(--bad)' }} onClick={() => setDeleteLoanConfirmId(loan.id)}>{t('delete')}</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── PUBLIC STATEMENTS TAB ── */}
      {innerTab === 'statements' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', background: 'color-mix(in srgb, var(--brand) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 25%, transparent)', borderRadius: 8, padding: '8px 12px' }}>
            💡 {t('statementsTabDesc')}
          </div>

          {buyerStatements.length === 0 ? (
            <div className="empty" style={{ padding: '32px 0' }}>
              <div className="empty-t">{t('noLoansYet')}</div>
            </div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('name')}</th>
                    <th>Currency</th>
                    <th className="r">{t('stmtTotalDue')}</th>
                    <th>{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {buyerStatements.map(stmt => {
                    const link = activeLinkFor(stmt.customerId, stmt.currency);
                    const isOpen = viewingReportKey === stmt.key;
                    const report = reportByKey[stmt.key];
                    return (
                      <Fragment key={stmt.key}>
                        <tr>
                          <td style={{ fontWeight: 700 }}>{stmt.customerName}</td>
                          <td className="mono">{stmt.currency}</td>
                          <td className="mono r">{fmtTotal(stmt.outstanding)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              <button
                                className="rowBtn"
                                disabled={creatingLinkKey === stmt.key}
                                onClick={() => viewStatementReport(stmt)}
                              >
                                {creatingLinkKey === stmt.key ? '…' : isOpen ? t('statementReportHide') : t('statementReportView')}
                              </button>
                              {link && (
                                <>
                                  <button className="rowBtn" style={{ fontSize: 10, color: 'var(--muted)' }} onClick={() => copyStatementLink(link)}>
                                    {t('statementLinkCopy')}
                                  </button>
                                  <button
                                    className="rowBtn"
                                    style={{ fontSize: 10, color: 'var(--bad)' }}
                                    disabled={revokingLinkId === link.id}
                                    onClick={() => revokeStatementLink(link)}
                                  >
                                    {revokingLinkId === link.id ? '…' : t('statementLinkRevoke')}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={4} style={{ background: 'var(--panel2)', padding: 16 }}>
                              {report === 'loading' || !report ? (
                                <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>…</div>
                              ) : report === 'error' ? (
                                <div style={{ fontSize: 12, color: 'var(--bad)', textAlign: 'center', padding: 20 }}>{t('statementLinkCreateFailed')}</div>
                              ) : (
                                <PublicStatementReport data={report} />
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Summary bar: headline balance + primary actions ──
           Sits at the foot of the page so the working content (KPIs, tabs,
           accounts) leads and the totals close it out. */}
      <div className="cash-hero cash-hero-bottom">
        <div className="cash-hero-main">
          <div className="cash-hero-label"><span className="cash-emoji">💰</span> {t('totalCashLbl')}</div>
          <div className="cash-hero-value mono">
            {fmtTotal(totalQAR)}<span className="cash-hero-unit">QAR</span>
          </div>
          <div className="cash-hero-meta">
            {total24hMovement === 0 ? (
              <span className="cash-hero-sub">{t('kpiNoMovement')}</span>
            ) : (
              <>
                <span className={`cash-delta ${total24hMovement > 0 ? 'up' : 'down'}`}>
                  {total24hMovement > 0 ? '▲' : '▼'} {fmtTotal(Math.abs(total24hMovement))} QAR
                </span>
                <span className="cash-hero-sub">{t('kpiLastDay')}</span>
              </>
            )}
          </div>
        </div>
        <div className="cash-hero-actions">
          <button className="btn cash-hero-btn" onClick={() => setShowTransfer(true)}>
            <IconTransfer /> {t('transferLbl')}
          </button>
          <button className="btn secondary cash-hero-btn" onClick={() => setShowAddAccount(true)}>
            <IconPlus /> {t('addAccountBtn')}
          </button>
          <button className="btn secondary cash-hero-btn" onClick={() => setShowMerchantCustody(true)}>
            <span className="cash-emoji">🤝</span> {t('merchantCash')}
            {pendingIncoming.length > 0 && (
              <span className="cash-hero-badge">{pendingIncoming.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Modals ── */}
      {(showAddAccount || editingAccount) && (
        <AddAccountModal
          isMobile={isMobile}
          existingAccount={editingAccount}
          onSave={handleAccountSaved}
          onClose={() => { setShowAddAccount(false); setEditingAccount(undefined); }}
        />
      )}

      {/* Opening balance prompt for new accounts */}
      {pendingAccount && (
        <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPendingAccount(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: '22px 24px', width: '100%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>{t('setOpeningBalance')}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
              {t('openingBalanceInQ')} <strong style={{ color: 'var(--text)' }}>{pendingAccount.name}</strong>{t('openingBalanceDesc')}
            </div>
            <div className="field2" style={{ marginBottom: 14 }}>
              <div className="lbl">{t('openingBalanceLbl')} ({pendingAccount.currency})</div>
              <div className="inputBox"><input inputMode="decimal" value={newOpeningBalance} onChange={e => setNewOpeningBalance(e.target.value)} placeholder="0.00" autoFocus /></div>
            </div>
            <div className="formActions">
              <button className="btn secondary" onClick={() => { addAccount(pendingAccount, 0); setPendingAccount(null); setNewOpeningBalance(''); }}>
                {t('skipZeroBalance')}
              </button>
              <button className="btn" onClick={() => { addAccount(pendingAccount, num(newOpeningBalance, 0)); setPendingAccount(null); setNewOpeningBalance(''); }}>
                {t('createAccountBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransfer && accounts.filter(a => a.status === 'active').length >= 2 && (
        <TransferModal
          accounts={accounts}
          balances={balances}
          defaultFromId={transferFromId}
          isMobile={isMobile}
          onSave={addTransfer}
          onClose={() => { setShowTransfer(false); setTransferFromId(undefined); }}
        />
      )}
      {showTransfer && accounts.filter(a => a.status === 'active').length < 2 && (
        <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowTransfer(false)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: '22px 24px', maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t('need2AccountsTitle')}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>{t('need2AccountsDesc')}</div>
            <button className="btn" onClick={() => { setShowTransfer(false); setShowAddAccount(true); }}>{t('addAccountBtn')}</button>
          </div>
        </div>
      )}
      {showDeposit && (
        <DepositWithdrawModal
          account={showDeposit.account}
          currentBalance={balances.get(showDeposit.account.id) || 0}
          mode={showDeposit.mode}
          isMobile={isMobile}
          onSave={addLedgerEntry}
          onClose={() => setShowDeposit(null)}
        />
      )}
      {clearLedgerPromptId && (
        <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={() => setClearLedgerPromptId(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '20px 22px', width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8, color: 'var(--bad)' }}>⚠️ {t('clearLedger')}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>{t('confirmClearLedger')}</div>
            <div className="formActions">
              <button className="btn secondary" onClick={() => setClearLedgerPromptId(null)}>{t('cancel')}</button>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <button className="btn" style={{ minHeight: isMobile ? 42 : undefined, background: 'var(--bad)', color: '#fff' }} onClick={() => { clearLedgerEntries(clearLedgerPromptId); setClearLedgerPromptId(null); }}>{t('clearBtn' as any)}</button>
            </div>
          </div>
        </div>
      )}
      {deleteAccountPromptId && (
        <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={() => setDeleteAccountPromptId(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '20px 22px', width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8, color: 'var(--bad)' }}>⚠️ {t('deleteAccountBtn')}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>{t('confirmDeleteAccount')}</div>
            <div className="formActions">
              <button className="btn secondary" onClick={() => setDeleteAccountPromptId(null)}>{t('cancel')}</button>
              <button className="btn" style={{ minHeight: isMobile ? 42 : undefined, background: 'var(--bad)', color: '#fff' }} onClick={() => { deleteAccount(deleteAccountPromptId); setDeleteAccountPromptId(null); }}>{t('deleteBtn')}</button>
            </div>
          </div>
        </div>
      )}

      {showMerchantCustody && (
        <MerchantCustodyModal
          counterparties={counterparties}
          myMerchantId={myMerchantId}
          myUserId={myUserId}
          isMobile={isMobile}
          onClose={() => setShowMerchantCustody(false)}
          onSubmit={(input) => {
            createRequest.mutate(input, {
              onSuccess: () => {
                // Find counterparty label for the account name
                const cp = counterparties.find(c => c.counterpartyMerchantId === input.custodianMerchantId);
                const cpLabel = cp?.counterpartyLabel ?? input.custodianMerchantId;
                // Add local merchant_custody account + merchant_funding_out ledger entry
                const existingCustodyAcc = accounts.find(a => a.type === 'merchant_custody' && ((input.relationshipId && a.relationshipId === input.relationshipId) || a.merchantId === input.custodianMerchantId));
                const custodyAccId = existingCustodyAcc?.id ?? uid();
                const newAccounts = existingCustodyAcc ? accounts : [...accounts, {
                  id: custodyAccId,
                  name: `Custody — ${cpLabel}`,
                  type: 'merchant_custody' as CashAccountType,
                  currency: input.currency as CashCurrency,
                  status: 'active' as const,
                  merchantId: input.custodianMerchantId,
                  relationshipId: input.relationshipId,
                  isMerchantAccount: true,
                  purpose: 'custody' as const,
                  createdAt: Date.now(),
                }];
                const outEntry: CashLedgerEntry = {
                  id: uid(), ts: Date.now(),
                  type: 'merchant_funding_out',
                  accountId: custodyAccId,
                  direction: 'out',
                  amount: input.amount,
                  currency: input.currency as CashCurrency,
                  note: input.note ?? `${t('custodyCustodyRequest')} ${cpLabel}`,
                  merchantId: input.custodianMerchantId,
                  relationshipId: input.relationshipId,
                };
                const newLedger = [...ledger, outEntry];
                applyState({ ...state, cashAccounts: newAccounts, cashLedger: newLedger, cashQAR: deriveCashQAR(newAccounts, newLedger) });
              }
            });
          }}
        />
      )}

      {showNewLoan && (
        <NewLoanModal
          customers={state.customers || []}
          trades={state.trades || []}
          accounts={activeAccounts}
          balances={balances}
          loanedTradeIds={loanedTradeIds}
          isMobile={isMobile}
          onSave={addLoan}
          onClose={() => setShowNewLoan(false)}
        />
      )}

      {openStatement && (
        <LoanStatementModal
          statement={openStatement}
          businessName={businessName}
          isMobile={isMobile}
          onClose={() => setStatementKey(null)}
          onAddRepayment={loan => { setStatementKey(null); setRepayingLoan(loan); }}
          onEditRepayment={entry => {
            const target = findRepayment(entry);
            if (target) { setStatementKey(null); setEditingRepayment(target); }
          }}
          onDeleteRepayment={entry => {
            const target = findRepayment(entry);
            if (target) { setStatementKey(null); setDeletingRepayment(target); }
          }}
        />
      )}

      {accountDetailId && (() => {
        const acc = accounts.find(a => a.id === accountDetailId);
        if (!acc) return null;
        return (
          <AccountLedgerModal
            account={acc}
            entries={ledger.filter(e => e.accountId === acc.id)}
            accounts={accounts}
            balance={balances.get(acc.id) || 0}
            typeLabels={LEDGER_TYPE_LABELS}
            isMobile={isMobile}
            onClose={() => setAccountDetailId(null)}
          />
        );
      })()}

      {showCashCounter && (
        <CashCounterModal
          accounts={activeAccounts}
          balances={balances}
          loans={loans}
          customers={state.customers || []}
          getLoanRemaining={getLoanRemaining}
          isMobile={isMobile}
          onAddToCash={addLedgerEntry}
          onRepayLoan={(loan, accountId, amount, ts, note) => addLoanRepayment(loan, accountId, amount, ts, note)}
          onSplitRepay={(allocations, accountId, ts, note) => addSplitLoanRepayment(allocations, accountId, ts, note)}
          onClose={() => setShowCashCounter(false)}
        />
      )}

      {repayingLoan && (
        <RepayLoanModal
          loan={repayingLoan}
          remaining={getLoanRemaining(repayingLoan)}
          accounts={activeAccounts}
          isMobile={isMobile}
          onSave={(accountId, amount, ts, note) => addLoanRepayment(repayingLoan, accountId, amount, ts, note)}
          onClose={() => setRepayingLoan(null)}
        />
      )}

      {splitPaymentStatement && (
        <SplitRepaymentModal
          statement={splitPaymentStatement}
          accounts={activeAccounts}
          isMobile={isMobile}
          onSave={(allocations, accountId, ts, note) => addSplitLoanRepayment(allocations, accountId, ts, note)}
          onClose={() => setSplitPaymentStatement(null)}
        />
      )}

      {editingRepayment && (
        <RepayLoanModal
          loan={editingRepayment.loan}
          // The cap is the balance with this payment taken back out — editing it
          // up to the full amount owed has to stay possible.
          remaining={getLoanRemaining(editingRepayment.loan) + editingRepayment.repayment.amount}
          accounts={activeAccounts}
          existing={editingRepayment.repayment}
          isMobile={isMobile}
          onSave={(accountId, amount, ts, note) => updateLoanRepayment(
            editingRepayment.loan, editingRepayment.repayment.id, accountId, amount, ts, note,
          )}
          onClose={() => setEditingRepayment(null)}
        />
      )}

      {deletingRepayment && (
        <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={() => setDeletingRepayment(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '20px 22px', width: '100%', maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8, color: 'var(--bad)' }}>⚠️ {t('loanDeletePayment')}</div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              {fmtAmt(deletingRepayment.repayment.amount, deletingRepayment.loan.currency)}
              <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {fmtTs(deletingRepayment.repayment.ts)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>{t('loanDeletePaymentConfirm')}</div>
            <div className="formActions">
              <button className="btn secondary" onClick={() => setDeletingRepayment(null)}>{t('cancel')}</button>
              <button
                className="btn"
                style={{ minHeight: isMobile ? 42 : undefined, background: 'var(--bad)', color: '#fff' }}
                onClick={() => deleteLoanRepayment(deletingRepayment.loan, deletingRepayment.repayment.id)}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingLoan && (
        <EditLoanModal
          loan={editingLoan}
          customers={state.customers || []}
          isMobile={isMobile}
          onSave={updateLoan}
          onClose={() => setEditingLoan(null)}
        />
      )}

      {deleteLoanConfirmId && (
        <div className="tracker-root" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={() => setDeleteLoanConfirmId(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '20px 22px', width: '100%', maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8, color: 'var(--bad)' }}>⚠️ {t('delete')} — {t('loans')}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>{t('deleteLoanConfirm')}</div>
            <div className="formActions">
              <button className="btn secondary" onClick={() => setDeleteLoanConfirmId(null)}>{t('cancel')}</button>
              <button className="btn" style={{ minHeight: isMobile ? 42 : undefined, background: 'var(--bad)', color: '#fff' }} onClick={() => deleteLoan(deleteLoanConfirmId)}>{t('delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}