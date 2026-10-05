import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { QuickDateField, fromDayString, toDayString } from '@/components/shared/QuickDateField';
import { useT } from '@/lib/i18n';
import { deriveCashQAR, fmtTotal, getAccountBalance, uid, type CashLedgerEntry, type TrackerState } from '@/lib/tracker-helpers';
import {
  personalLoanOutstanding, personalLoanRepaid, type PersonalLoan, type PersonalLoanCurrency,
} from '@/lib/trading/personal-loans';
import { usePersonalLoanActions } from '../api';

const CURRENCIES: PersonalLoanCurrency[] = ['QAR', 'USD', 'EGP', 'USDT'];
const numeric = (v: string) => v === '' || /^\d*\.?\d*$/.test(v);
const field: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)',
  background: 'var(--panel2)', color: 'var(--text)', fontSize: 12, minWidth: 0,
};

/** A day picked in the calendar as a timestamp; today keeps the current time so same-day entries sort naturally. */
function dayToTs(day: string): number {
  const d = fromDayString(day);
  if (!d) return Date.now();
  return day === toDayString(new Date()) ? Date.now() : d.getTime() + 12 * 3600_000;
}

/**
 * Loans to people who are not customers: a friend borrows 7,000, repays it in
 * parts. They count in the net position as money owed to the merchant, and
 * can optionally move cash when they are given or repaid.
 */
export function PersonalLoansPanel({
  state, applyState, loans, unavailable, lang,
}: {
  state: TrackerState;
  applyState: (next: TrackerState) => void;
  loans: PersonalLoan[];
  unavailable: boolean;
  lang: 'en' | 'ar';
}) {
  const t = useT();
  const actions = usePersonalLoanActions();
  const today = toDayString(new Date());
  const accounts = useMemo(() => (state.cashAccounts || []).filter(a => a.status === 'active' && a.type !== 'merchant_custody'), [state.cashAccounts]);
  const [form, setForm] = useState({ person: '', amount: '', currency: 'QAR' as PersonalLoanCurrency, day: today, accountId: '', note: '' });
  const [repay, setRepay] = useState<{ loanId: string; amount: string; day: string; accountId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettled, setShowSettled] = useState(false);

  const accountsFor = (currency: string) => accounts.filter(a => a.currency === currency);
  const withLedger = (entry: CashLedgerEntry) => {
    const ledger = [...(state.cashLedger || []), entry];
    applyState({ ...state, cashLedger: ledger, cashQAR: deriveCashQAR(state.cashAccounts, ledger) });
  };

  const open = loans.filter(l => personalLoanOutstanding(l) > 0);
  const settled = loans.filter(l => personalLoanOutstanding(l) <= 0);

  const give = async () => {
    const amount = Number(form.amount);
    const person = form.person.trim();
    if (!person || !(amount > 0)) return;
    const account = accounts.find(a => a.id === form.accountId);
    if (account && amount > getAccountBalance(account.id, state.cashLedger || [])) { toast.error(t('npInsufficient')); return; }
    setBusy(true);
    try {
      const lentAt = dayToTs(form.day);
      const ledgerEntryId = account ? uid() : undefined;
      const id = await actions.add({ person, principal: amount, currency: form.currency, lentAt, note: form.note.trim() || undefined, ledgerEntryId });
      if (account && ledgerEntryId) {
        withLedger({
          id: ledgerEntryId, ts: lentAt, type: 'loan_disbursement', accountId: account.id, direction: 'out', amount,
          currency: account.currency, note: `${t('plLedgerGiven')} ${person}`, linkedEntityType: 'loan', linkedEntityId: id,
        });
      }
      setForm({ person: '', amount: '', currency: 'QAR', day: today, accountId: '', note: '' });
      toast.success(t('plSaved'));
    } catch {
      toast.error(t('mloanSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const receive = async (loan: PersonalLoan) => {
    if (!repay) return;
    const amount = Number(repay.amount);
    if (!(amount > 0)) return;
    const account = accounts.find(a => a.id === repay.accountId);
    setBusy(true);
    try {
      const ts = dayToTs(repay.day);
      const ledgerEntryId = account ? uid() : undefined;
      await actions.setRepayments(loan.id, [...loan.repayments, { id: uid(), ts, amount, ledgerEntryId }]);
      if (account && ledgerEntryId) {
        withLedger({
          id: ledgerEntryId, ts, type: 'loan_repayment', accountId: account.id, direction: 'in', amount,
          currency: account.currency, note: `${t('plLedgerRepaid')} ${loan.person}`, linkedEntityType: 'loan', linkedEntityId: loan.id,
        });
      }
      setRepay(null);
      toast.success(t('plRepaymentSaved'));
    } catch {
      toast.error(t('mloanSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const removeLoan = async (loan: PersonalLoan) => {
    if (!window.confirm(t('plDeleteConfirm'))) return;
    setBusy(true);
    try { await actions.remove(loan.id); toast.success(t('plDeleted')); } catch { toast.error(t('mloanSaveFailed')); } finally { setBusy(false); }
  };

  const renderLoan = (loan: PersonalLoan) => {
    const outstanding = personalLoanOutstanding(loan);
    const repaying = repay?.loanId === loan.id;
    const matching = accountsFor(loan.currency);
    return (
      <div key={loan.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{loan.person}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
              {new Date(loan.lentAt).toLocaleDateString()} · {t('plLent')} {fmtTotal(loan.principal)} {loan.currency}
              {personalLoanRepaid(loan) > 0 ? ` · ${t('plRepaid')} ${fmtTotal(personalLoanRepaid(loan))}` : ''}{loan.note ? ` · ${loan.note}` : ''}
            </div>
          </div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: outstanding > 0 ? 'var(--warn)' : 'var(--good)', whiteSpace: 'nowrap' }}>
            {outstanding > 0 ? `${fmtTotal(outstanding)} ${loan.currency}` : `✓ ${t('plSettled')}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {outstanding > 0 && !repaying && (
            <button type="button" className="rowBtn" disabled={busy}
              onClick={() => setRepay({ loanId: loan.id, amount: String(outstanding), day: today, accountId: '' })}>
              ↩ {t('plRecordRepayment')}
            </button>
          )}
          <button type="button" className="rowBtn" disabled={busy} onClick={() => { void removeLoan(loan); }}>🗑 {t('plDelete')}</button>
        </div>
        {repaying && repay && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, borderRadius: 8, background: 'var(--panel2)' }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('amount')} ({loan.currency})
              <input inputMode="decimal" value={repay.amount} onChange={e => { if (numeric(e.target.value)) setRepay({ ...repay, amount: e.target.value }); }} style={field} />
            </label>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('plDateReceived')}</div>
            <QuickDateField value={repay.day} onChange={day => setRepay({ ...repay, day })} lang={lang} />
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('plReceivedInto')}
              <select value={repay.accountId} onChange={e => setRepay({ ...repay, accountId: e.target.value })} style={field}>
                <option value="">{t('plNoCash')}</option>
                {matching.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn" disabled={busy || !(Number(repay.amount) > 0)} onClick={() => { void receive(loan); }}>{t('plSaveRepayment')}</button>
              <button type="button" className="btn secondary" onClick={() => setRepay(null)}>{t('cancel')}</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const givingAccounts = accountsFor(form.currency);

  return (
    <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800 }}>🤝 {t('plTitle')}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('plHint')}</div>
      </div>
      {unavailable ? <div style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {t('plUnavailable')}</div> : (
        <>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('plPerson')}
              <input value={form.person} onChange={e => setForm({ ...form, person: e.target.value })} style={field} />
            </label>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('amount')}
              <input inputMode="decimal" value={form.amount} onChange={e => { if (numeric(e.target.value)) setForm({ ...form, amount: e.target.value }); }} style={field} />
            </label>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('plCurrency')}
              <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value as PersonalLoanCurrency, accountId: '' })} style={field}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('plTakenFrom')}
              <select value={form.accountId} onChange={e => setForm({ ...form, accountId: e.target.value })} style={field}>
                <option value="">{t('plNoCash')}</option>
                {givingAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('plDateGiven')}</div>
          <QuickDateField value={form.day} onChange={day => setForm({ ...form, day })} lang={lang} />
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{t('note')}
            <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} style={field} />
          </label>
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy || !form.person.trim() || !(Number(form.amount) > 0)} onClick={() => { void give(); }}>
            {t('plAdd')}
          </button>

          {open.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('plNone')}</div>}
          {open.map(renderLoan)}
          {settled.length > 0 && (
            <>
              <button type="button" className="rowBtn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowSettled(v => !v)}>
                {showSettled ? '▾' : '▸'} {t('plSettledGroup')} ({settled.length})
              </button>
              {showSettled && settled.map(renderLoan)}
            </>
          )}
        </>
      )}
    </div>
  );
}
