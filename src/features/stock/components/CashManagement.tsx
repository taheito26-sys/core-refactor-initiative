import { useState, useMemo, useEffect } from 'react';
import {
  uid, fmtTotal, fmtDate, num,
  type TrackerState,
  type CashAccount, type CashAccountType, type CashCurrency,
  type CashLedgerEntry, type LedgerEntryType,
  getAccountBalance, getAllAccountBalances, deriveCashQAR,
} from '@/lib/tracker-helpers';
import { useT } from '@/lib/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';

// ── Icons (inline SVG helpers) ─────────────────────────────────────
const IconHand = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
  </svg>
);
const IconBank = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/>
    <line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/>
    <line x1="18" y1="18" x2="18" y2="11"/>
    <polygon points="12 2 20 7 4 7"/>
  </svg>
);
const IconVault = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/>
    <path d="M12 8v4M12 16h.01"/>
  </svg>
);
const IconMerchant = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const IconTransfer = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
    <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
  </svg>
);
const IconPlus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const IconMinus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

const ACCOUNT_TYPE_ICON: Record<CashAccountType, React.FC> = {
  hand: IconHand, 
  bank: IconBank, 
  vault: IconVault,
  merchant_custody: IconMerchant,
};
const CURRENCY_SYMBOLS: Record<CashCurrency, string> = { QAR: 'QAR', USDT: 'USDT', USD: 'USD' };

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

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={onClose}>
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
            <select value={type} onChange={e => setType(e.target.value as CashAccountType)}
              style={{ width: '100%', minHeight: 42, padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', outline: 'none' }}>
              <option value="hand">💵 {t('accTypeHand')}</option>
              <option value="bank">🏦 {t('accTypeBank')}</option>
              <option value="vault">🔒 {t('accTypeVault')}</option>
              <option value="merchant_custody">🤝 {t('accTypeMerchant') || 'Merchant Custody'}</option>
            </select>
          </div>
          <div className="field2">
            <div className="lbl">{t('accountCurrencyLbl')}</div>
            <select value={currency} onChange={e => setCurrency(e.target.value as CashCurrency)}
              style={{ width: '100%', minHeight: 42, padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', outline: 'none' }}>
              <option value="QAR">🇶🇦 QAR</option>
              <option value="USDT">💲 USDT</option>
              <option value="USD">🇺🇸 USD</option>
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
            <div className="lbl">{t('linkToMerchant' as any) || 'Link to Merchant'}</div>
            <select value={relationshipId} onChange={e => {
              const relId = e.target.value;
              setRelationshipId(relId);
              // Automagically set merchantId based on relationship
              // (Note: this assumes relationships are available via props or global state)
            }}
              style={{ width: '100%', minHeight: 42, padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', outline: 'none' }}>
              <option value="">{t('selectRelationship' as any) || 'Select Relationship...'}</option>
              {/* Opions will be passed via state/props in main component */}
              {(window as any)._allRels?.map((r: any) => (
                <option key={r.id} value={r.id}>{r.counterparty_name || r.id}</option>
              ))}
            </select>
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
    funding: t('fundMerchant' as any) || 'Fund Merchant',
    proceeds: t('recordProceeds' as any) || 'Record Proceeds',
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
    if (isMobile && !confirmChecked) { setErr(t('confirmBeforeSubmit' as any)); return; }
    if (!(amtNum > 0)) { setErr(t('enterValidAmount')); return; }
    if (amtNum > currentBalance && (mode === 'withdrawal' || mode === 'settlement')) {
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={onClose}>
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
    if (isMobile && !confirmChecked) { setErr(t('confirmBeforeTransfer') as any); return; }
    if (!fromId || !toId) { setErr(t('selectBothAccounts') as any); return; }
    if (fromId === toId) { setErr(t('cannotSameAccount') as any); return; }
    if (!(amtNum > 0)) { setErr(t('enterValidAmount') as any); return; }
    if (amtNum > fromBal) {
      setErr((t('insufficientFundsMsg') as any) + ` ${fmtTotal(fromBal)} ${fromAcc?.currency}`);
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

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '22px 24px', width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,.5)', maxHeight: isMobile ? Math.max(320, (viewportHeight || window.innerHeight) - 16) : '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{t('quickTransfer' as any)}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div className="g2tight" style={{ marginBottom: 10, alignItems: 'end', ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
          <div className="field2">
            <div className="lbl">{t('transferFromLbl' as any)}</div>
            <select value={fromId} onChange={e => setFromId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', outline: 'none' }}>
              {active.map(a => <option key={a.id} value={a.id}>{a.name} ({fmtTotal(balances.get(a.id) || 0)} {a.currency})</option>)}
            </select>
          </div>
          <div className="field2">
            <div className="lbl">{t('transferToLbl' as any)}</div>
            <select value={toId} onChange={e => setToId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', outline: 'none' }}>
              {active.filter(a => a.id !== fromId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('amount')}</div>
          <div className="inputBox"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus /></div>
        </div>
        {amtNum > 0 && fromAcc && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
            {fromAcc.name} {(t('balanceAfterLbl' as any)).toLowerCase()}: <strong style={{ color: 'var(--warn)' }}>{fmtTotal(fromBal - amtNum)} {fromAcc.currency}</strong>
          </div>
        )}
        <div className="field2" style={{ marginBottom: 14 }}>
          <div className="lbl">{t('noteOptional')}</div>
          <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} placeholder={t('reasonTransferPh' as any)} /></div>
        </div>
        {isMobile && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, color: 'var(--muted)' }}>
            <input type="checkbox" checked={confirmChecked} onChange={e => setConfirmChecked(e.target.checked)} />
            {t('confirmTransferReview' as any)}
          </label>
        )}
        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        <div className="formActions" style={{ position: isMobile ? 'sticky' : 'static', bottom: isMobile ? 0 : undefined, background: isMobile ? 'linear-gradient(to top, var(--panel2) 70%, transparent)' : undefined, paddingTop: isMobile ? 8 : 0 }}>
          <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} />
      <div style={{ position: 'relative', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>🔄 {t('reconcileBtn')} — {account.name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>{t('reconcileDesc' as any) || 'Enter the actual physical balance to create an adjustment entry.'}</div>
        
        <div className="field2" style={{ marginBottom: 10 }}>
          <div className="lbl">{t('physicalBalanceLbl' as any) || 'Physical Balance'}</div>
          <div className="inputBox"><input inputMode="decimal" value={actualBal} onChange={e => setActualBal(e.target.value)} placeholder="0.00" autoFocus /></div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{t('systemBalance' as any) || 'System'}: {fmtTotal(currentBalance)} {account.currency}</div>
        </div>

        <div className="field2" style={{ marginBottom: 16 }}>
          <div className="lbl">{t('adjustmentReason' as any) || 'Reason'}</div>
          <div className="inputBox"><input value={reason} onChange={e => setReason(e.target.value)} placeholder={t('adjustmentReasonPh' as any) || 'e.g. Rounding, unknown loss...'} /></div>
        </div>

        {err && <div style={{ color: 'var(--bad)', fontSize: 11, marginBottom: 10 }}>⚠ {err}</div>}
        
        <div className="formActions">
          <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn" onClick={handle}>{t('confirmReconcile') || 'Confirm Reconciliation'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Main CashManagement Component ─────────────────────────────────
interface CashManagementProps {
  state: TrackerState;
  applyState: (next: TrackerState) => void;
}

export function CashManagement({ state, applyState }: CashManagementProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const accounts = state.cashAccounts || [];
  const ledger = state.cashLedger || [];

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
  }), [t]);

  const [innerTab, setInnerTab] = useState<'accounts' | 'ledger' | 'insights'>('accounts');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<CashAccount | undefined>();
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFromId, setTransferFromId] = useState<string | undefined>();
  const [showDeposit, setShowDeposit] = useState<{ account: CashAccount; mode: 'deposit' | 'withdrawal' | 'funding' | 'proceeds' | 'settlement' } | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<{ accountId: string; type: string }>({ accountId: '', type: '' });
  const [reconcileAccountData, setReconcileAccountData] = useState<CashAccount | null>(null);
  const [clearLedgerPromptId, setClearLedgerPromptId] = useState<string | null>(null);

  const [relationships, setRelationships] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('merchant_relationships').select('*').then(({ data }) => {
      if (data) {
        // Enriched list for select box
        const myMerchantId = (state as any).merchantId; // fallback
        const enriched = data.map((r: any) => ({
          ...r,
          counterparty_name: r.merchant_a_id === myMerchantId ? r.merchant_b_id : r.merchant_a_id, // simplified
        }));
        setRelationships(enriched);
        (window as any)._allRels = enriched;
      }
    });
  }, [state]);

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

  const total24hMovement = useMemo(() => {
    const since = Date.now() - 86400000;
    return ledger.filter(e => e.ts >= since).reduce((sum, e) => sum + (e.direction === 'in' ? e.amount : -e.amount), 0);
  }, [ledger]);

  // ── Mutation helpers ───────────────────────────────────────────
  const addAccount = (account: CashAccount, openingBalance: number) => {
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
    applyState({ ...state, cashAccounts: newAccounts, cashLedger: newLedger, cashQAR: newCashQAR });
    setShowAddAccount(false);
  };

  const saveAccount = (account: CashAccount) => {
    const newAccounts = accounts.map(a => a.id === account.id ? account : a);
    applyState({ ...state, cashAccounts: newAccounts });
    setEditingAccount(undefined);
  };

  const deactivateAccount = (id: string) => {
    const newAccounts = accounts.map(a => a.id === id ? { ...a, status: 'inactive' as const } : a);
    applyState({ ...state, cashAccounts: newAccounts });
  };

  const addLedgerEntry = (entry: CashLedgerEntry) => {
    const newLedger = [...ledger, entry];
    const newCashQAR = deriveCashQAR(accounts, newLedger);
    applyState({ ...state, cashLedger: newLedger, cashQAR: newCashQAR });
    setShowDeposit(null);
  };

  const addTransfer = (entries: [CashLedgerEntry, CashLedgerEntry]) => {
    const newLedger = [...ledger, ...entries];
    const newCashQAR = deriveCashQAR(accounts, newLedger);
    applyState({ ...state, cashLedger: newLedger, cashQAR: newCashQAR });
    setShowTransfer(false);
  };

  const reconcileAccount = (account: CashAccount, entry: CashLedgerEntry) => {
    const newAccounts = accounts.map(a => a.id === account.id ? { ...a, lastReconciled: Date.now() } : a);
    applyState({ ...state, cashAccounts: newAccounts, cashLedger: [...ledger, entry] });
    setReconcileAccountData(null);
  };

  const clearLedgerEntries = (id: string) => {
    const newLedger = ledger.filter(e => e.accountId !== id && e.contraAccountId !== id);
    const newCashQAR = deriveCashQAR(accounts, newLedger);
    applyState({ ...state, cashLedger: newLedger, cashQAR: newCashQAR });
  };

  // ── Ledger filtered rows with running balance ─────────────────
  const filteredLedger = useMemo(() => {
    let rows = [...ledger].sort((a, b) => b.ts - a.ts);
    if (ledgerFilter.accountId) rows = rows.filter(e => e.accountId === ledgerFilter.accountId);
    if (ledgerFilter.type) rows = rows.filter(e => e.type === ledgerFilter.type);
    return rows;
  }, [ledger, ledgerFilter]);

  // Compute running balance per account for ledger rows (sorted asc for running calc)
  const runningBalances = useMemo(() => {
    const map = new Map<string, number>(); // ledgerEntryId → runningBalance
    // per-account running balance computed ascending
    for (const acc of accounts) {
      const accEntries = [...ledger].filter(e => e.accountId === acc.id).sort((a, b) => a.ts - b.ts);
      let running = 0;
      for (const e of accEntries) {
        running += e.direction === 'in' ? e.amount : -e.amount;
        map.set(e.id, running);
      }
    }
    return map;
  }, [accounts, ledger]);

  // ── Insights ──────────────────────────────────────────────────
  const lowBalanceAccounts = useMemo(() => {
    return activeAccounts.filter(a => {
      const bal = balances.get(a.id) || 0;
      return bal < 1000 && a.currency === 'QAR';
    });
  }, [activeAccounts, balances]);

  const overdueReconciliation = useMemo(() => {
    const threshold = 7 * 24 * 3600 * 1000; // 7 days
    return activeAccounts.filter(a => {
      if (!a.lastReconciled) return true;
      return Date.now() - a.lastReconciled > threshold;
    });
  }, [activeAccounts]);

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
    <div className="tracker-root" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: isMobile ? 'max(8px, env(safe-area-inset-bottom))' : undefined }}>
      {/* ── Summary Strip ── */}
      <div className="cash-summary-strip" style={isMobile ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, padding: 8 } : undefined}>
        <div className="cash-summary-item">
          <div className="cash-summary-label">💰 {t('totalCashLbl')}</div>
          <div className="cash-summary-value mono" style={isMobile ? { fontSize: 18, lineHeight: 1.15, wordBreak: 'break-word' } : undefined}>{fmtTotal(totalQAR)} <span style={{ fontSize: isMobile ? 10 : 11, fontWeight: 600 }}>QAR</span></div>
        </div>
        {!isMobile && <div className="cash-summary-sep" />}
        <div className="cash-summary-item">
          <div className="cash-summary-label">✋ {t('inHandLbl')}</div>
          <div className="cash-summary-value mono" style={{ fontSize: isMobile ? 16 : 15 }}>{fmtTotal(inHandQAR)}</div>
        </div>
        {!isMobile && <div className="cash-summary-sep" />}
        <div className="cash-summary-item">
          <div className="cash-summary-label">🏦 {t('banksLbl')}</div>
          <div className="cash-summary-value mono" style={{ fontSize: isMobile ? 16 : 15 }}>{fmtTotal(bankQAR)}</div>
        </div>
        {vaultQAR > 0 && <>
          {!isMobile && <div className="cash-summary-sep" />}
          <div className="cash-summary-item">
            <div className="cash-summary-label">🔒 {t('vaultLbl')}</div>
            <div className="cash-summary-value mono" style={{ fontSize: isMobile ? 16 : 15 }}>{fmtTotal(vaultQAR)}</div>
          </div>
        </>}
        {!isMobile && <div className="cash-summary-sep" />}
        <div className="cash-summary-item">
          <div className="cash-summary-label">{t('movement24h')}</div>
          <div className="cash-summary-value mono" style={{ fontSize: isMobile ? 16 : 14, color: total24hMovement >= 0 ? 'var(--good)' : 'var(--bad)' }}>
            {total24hMovement >= 0 ? '+' : ''}{fmtTotal(total24hMovement)}
          </div>
        </div>
        {!isMobile && <div style={{ flex: 1 }} />}
        <button
          className="btn"
          style={{ padding: isMobile ? '10px 14px' : '7px 14px', minHeight: isMobile ? 42 : undefined, fontSize: isMobile ? 12 : 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, gridColumn: isMobile ? 'span 1' : undefined }}
          onClick={() => setShowTransfer(true)}>
          <IconTransfer /> {t('transferLbl')}
        </button>
        <button
          className="btn secondary"
          style={{ padding: isMobile ? '10px 14px' : '7px 14px', minHeight: isMobile ? 42 : undefined, fontSize: isMobile ? 12 : 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, gridColumn: isMobile ? 'span 1' : undefined }}
          onClick={() => setShowAddAccount(true)}>
          <IconPlus /> {t('addAccountBtn')}
        </button>
      </div>

      {/* ── Warnings ── */}
      {(lowBalanceAccounts.length > 0 || overdueReconciliation.length > 0 || concentrationWarning) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {lowBalanceAccounts.map(a => (
            <div key={a.id} className="cash-warning-pill" style={{ borderColor: 'color-mix(in srgb, var(--warn) 30%, transparent)', color: 'var(--warn)' }}>
              ⚠ {a.name}: {t('lowBalancePill')} ({fmtTotal(balances.get(a.id) || 0)} QAR)
            </div>
          ))}
          {concentrationWarning && (
            <div className="cash-warning-pill" style={{ borderColor: 'color-mix(in srgb, var(--brand) 30%, transparent)', color: 'var(--brand)' }}>
              📊 {concentrationWarning.account.name}: {concentrationWarning.pct}% {t('holdsOfTotal')}
            </div>
          )}
          {overdueReconciliation.length > 0 && (
            <div className="cash-warning-pill" style={{ borderColor: 'color-mix(in srgb, var(--muted) 40%, transparent)', color: 'var(--muted)' }}>
              🔄 {overdueReconciliation.length} {t('accountsDueRecon')}
            </div>
          )}
        </div>
      )}

      {/* ── Inner Tabs ── */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--panel)', borderRadius: 8, padding: 4, alignSelf: 'flex-start' }}>
        {tabBtn('accounts', t('cashAccountsTab'))}
        {tabBtn('ledger', t('cashLedgerTab'))}
        {tabBtn('insights', t('cashInsightsTab'))}
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
                const needsReconcile = !acc.lastReconciled || (Date.now() - acc.lastReconciled > 7 * 86400000);

                return (
                  <div key={acc.id} className="cash-account-card" style={{ opacity: isInactive ? 0.5 : 1, padding: isMobile ? '12px 12px 14px' : undefined }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: `color-mix(in srgb, var(--brand) 12%, transparent)`, border: '1px solid color-mix(in srgb, var(--brand) 25%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand)', flexShrink: 0 }}>
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
                      <div className="mono" style={{ fontSize: isMobile ? 'clamp(22px, 6vw, 30px)' : 22, fontWeight: 900, color: bal < 0 ? 'var(--bad)' : 'var(--text)', lineHeight: 1.05 }}>
                        {fmtTotal(bal)}<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginLeft: 4 }}>{acc.currency}</span>
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
                      {needsReconcile && !isInactive && <span style={{ color: 'var(--warn)' }}>• {t('needsReconcileLbl')}</span>}
                    </div>

                    {/* Actions */}
                    {!isInactive && (
                      <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(2, 1fr)' }}>
                        {acc.type === 'merchant_custody' ? (
                          <>
                            <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setShowDeposit({ account: acc, mode: 'funding' })}>
                              <IconPlus /> {t('fundMerchant') || 'Fund'}
                            </button>
                            <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setShowDeposit({ account: acc, mode: 'proceeds' })}>
                              📥 {t('recordProceeds' as any) || 'Proceeds'}
                            </button>
                            <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setShowDeposit({ account: acc, mode: 'settlement' })}>
                              📤 {t('settleBack') || 'Settle'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setShowDeposit({ account: acc, mode: 'deposit' })}>
                              <IconPlus /> {t('depositTitle')}
                            </button>
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
                        <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined }} onClick={() => setEditingAccount(acc)}>✏️ {t('edit')}</button>
                        <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined }} onClick={() => setReconcileAccountData(acc)}>{t('reconcileBtn')}</button>
                        <button className="rowBtn" style={{ fontSize: 10, minHeight: isMobile ? 38 : undefined, color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 30%, transparent)', gridColumn: '1 / -1' }} onClick={() => setClearLedgerPromptId(acc.id)}>🗑️ {t('clearLedger')}</button>
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
                  <div style={{ width: 36, height: 36, borderRadius: 50, border: '2px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

      {/* ── LEDGER TAB ── */}
      {innerTab === 'ledger' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select value={ledgerFilter.accountId} onChange={e => setLedgerFilter(f => ({ ...f, accountId: e.target.value }))}
              style={{ padding: '6px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', outline: 'none' }}>
              <option value="">{t('allAccountsOpt')}</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select value={ledgerFilter.type} onChange={e => setLedgerFilter(f => ({ ...f, type: e.target.value }))}
              style={{ padding: '6px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', outline: 'none' }}>
              <option value="">{t('allTypesOpt')}</option>
              {(Object.keys(LEDGER_TYPE_LABELS) as LedgerEntryType[]).map(lType => (
                <option key={lType} value={lType}>{LEDGER_TYPE_LABELS[lType]}</option>
              ))}
            </select>
            {(ledgerFilter.accountId || ledgerFilter.type) && (
              <button className="rowBtn" onClick={() => setLedgerFilter({ accountId: '', type: '' })}>✕ {t('clearAll')}</button>
            )}
            <span className="muted" style={{ fontSize: 10, alignSelf: 'center' }}>{filteredLedger.length} {t('entriesCount')}</span>
          </div>

          {filteredLedger.length === 0 ? (
            <div className="empty" style={{ padding: '24px 0' }}>
              <div className="empty-t">{t('noLedgerEntries')}</div>
              <div className="empty-s">{t('cashMovementsAppear')}</div>
            </div>
          ) : isMobile ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {filteredLedger.map(entry => {
                const acc = accounts.find(a => a.id === entry.accountId);
                const contraAcc = entry.contraAccountId ? accounts.find(a => a.id === entry.contraAccountId) : null;
                const runBal = runningBalances.get(entry.id);
                const isIn = entry.direction === 'in';
                const isStockType = entry.type === 'stock_purchase' || entry.type === 'stock_refund' || entry.type === 'stock_edit_adjust';
                return (
                  <div key={entry.id} className="panel" style={{ padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{acc?.name || '—'}</div>
                      <span className={`pill ${isStockType ? 'warn' : isIn ? 'good' : 'bad'}`} style={{ fontSize: 10 }}>{LEDGER_TYPE_LABELS[entry.type]}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>{fmtTs(entry.ts)}</div>
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
                    <th>{t('ledgerColAccount')}</th>
                    <th>{t('ledgerColType')}</th>
                    <th className="r">{t('ledgerColAmount')}</th>
                    <th className="r">{t('ledgerColBalance')}</th>
                    <th>{t('ledgerColLinked')}</th>
                    <th>{t('note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLedger.map(entry => {
                    const acc = accounts.find(a => a.id === entry.accountId);
                    const contraAcc = entry.contraAccountId ? accounts.find(a => a.id === entry.contraAccountId) : null;
                    const runBal = runningBalances.get(entry.id);
                    const isIn = entry.direction === 'in';
                    const isStockType = entry.type === 'stock_purchase' || entry.type === 'stock_refund' || entry.type === 'stock_edit_adjust';
                    return (
                      <tr key={entry.id}>
                        <td className="mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{fmtTs(entry.ts)}</td>
                        <td style={{ fontSize: 11 }}>{acc?.name || '—'}</td>
                        <td>
                          <span className={`pill ${isStockType ? 'warn' : isIn ? 'good' : 'bad'}`} style={{ fontSize: 9 }}>
                            {LEDGER_TYPE_LABELS[entry.type]}
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
                        <td style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
      )}

      {/* ── INSIGHTS TAB ── */}
      {innerTab === 'insights' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Account breakdown */}
          <div className="panel">
            <div className="panel-head"><h2>{t('portfolioBreakdown')}</h2></div>
            <div className="panel-body">
              {activeAccounts.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>{t('noActiveAccountsMsg')}</div>
              ) : (
                activeAccounts.filter(a => a.currency === 'QAR').map(acc => {
                  const bal = balances.get(acc.id) || 0;
                  const pct = totalQAR > 0 ? (bal / totalQAR) * 100 : 0;
                  return (
                    <div key={acc.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                        <span style={{ fontWeight: 700 }}>{acc.name}</span>
                        <span className="mono">{fmtTotal(bal)} QAR ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="prog" style={{ height: 6 }}>
                        <span style={{ width: `${Math.min(100, pct).toFixed(1)}%`, background: pct > 70 ? 'var(--warn)' : 'var(--brand)' }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Batch funding sources */}
          {batchFundingSources.size > 0 && (
            <div className="panel">
              <div className="panel-head"><h2>{t('stockFundingSources')}</h2></div>
              <div className="panel-body">
                {Array.from(batchFundingSources.entries()).map(([accId, count]) => {
                  const acc = accounts.find(a => a.id === accId);
                  const batchTotal = (state.batches || [])
                    .filter(b => b.fundingAccountId === accId)
                    .reduce((sum, b) => sum + b.initialUSDT * b.buyPriceQAR, 0);
                  return (
                    <div key={accId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{acc?.name || accId}</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {count} {t('batchesLabel')} · {fmtTotal(batchTotal)} {t('qarSpent')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Health indicators */}
          <div className="panel">
            <div className="panel-head"><h2>{t('balanceHealth')}</h2></div>
            <div className="panel-body">
              {accounts.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{t('noAccountsConfigured')}</div>}
              {lowBalanceAccounts.map(a => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 11 }}>
                  <span style={{ color: 'var(--warn)' }}>⚠ {a.name}</span>
                  <span className="mono">{fmtTotal(balances.get(a.id) || 0)} QAR — {t('lowBalancePill')}</span>
                </div>
              ))}
              {overdueReconciliation.map(a => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 11 }}>
                  <span style={{ color: 'var(--muted)' }}>🔄 {a.name}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                    {a.lastReconciled
                      ? `${t('lastActivity')}: ${fmtDate(a.lastReconciled)}`
                      : t('neverReconciled')}
                  </span>
                </div>
              ))}
              {lowBalanceAccounts.length === 0 && overdueReconciliation.length === 0 && (
                <div style={{ color: 'var(--good)', fontSize: 12 }}>{t('allAccountsHealthy')}</div>
              )}
            </div>
          </div>
        </div>
      )}

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
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPendingAccount(null)}>
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowTransfer(false)}>
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
      {reconcileAccountData && (
        <ReconcileEntryModal
          account={reconcileAccountData}
          currentBalance={balances.get(reconcileAccountData.id) || 0}
          isMobile={isMobile}
          onSave={(entry) => reconcileAccount(reconcileAccountData, entry)}
          onClose={() => setReconcileAccountData(null)}
        />
      )}

      {clearLedgerPromptId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' : 0 }} onClick={() => setClearLedgerPromptId(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: isMobile ? 14 : 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : '20px 22px', width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8, color: 'var(--bad)' }}>⚠️ {t('clearLedger')}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>{t('confirmClearLedger')}</div>
            <div className="formActions">
              <button className="btn secondary" onClick={() => setClearLedgerPromptId(null)}>{t('cancel')}</button>
              <button className="btn" style={{ minHeight: isMobile ? 42 : undefined, background: 'var(--bad)', color: '#fff' }} onClick={() => { clearLedgerEntries(clearLedgerPromptId); setClearLedgerPromptId(null); }}>{t('clearBtn' as any)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
