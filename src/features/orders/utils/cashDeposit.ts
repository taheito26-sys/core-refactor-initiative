import { uid, deriveCashQAR, type TrackerState, type CashLedgerEntry, type CashTransaction } from '@/lib/tracker-helpers';

export interface ApplyOrderCashDepositInput {
  nextState: TrackerState;
  cashDepositMode: 'none' | 'full' | 'partial';
  cashDepositAmountRaw: string;
  cashDepositAccountId: string;
  sell: number;
  amountUSDT: number;
  note: string;
  now?: number;
}

export function applyOrderCashDeposit({
  nextState,
  cashDepositMode,
  cashDepositAmountRaw,
  cashDepositAccountId,
  sell,
  amountUSDT,
  note,
  now = Date.now(),
}: ApplyOrderCashDepositInput): TrackerState {
  if (cashDepositMode === 'none') return nextState;

  const revenue = amountUSDT * sell;
  const depositAmt = cashDepositMode === 'full'
    ? revenue
    : Math.min(parseFloat(cashDepositAmountRaw) || 0, revenue);
  if (depositAmt <= 0) return nextState;

  const activeQarAccounts = (nextState.cashAccounts || []).filter(a => a.status === 'active' && a.currency === 'QAR');
  const selectedActiveQarAccount = activeQarAccounts.find(a => a.id === cashDepositAccountId);
  const fallbackActiveQarAccount = activeQarAccounts[0];
  const targetAccount = selectedActiveQarAccount || fallbackActiveQarAccount;

  if (targetAccount) {
    const ledgerEntry: CashLedgerEntry = {
      id: uid(),
      ts: now,
      type: 'sale_deposit',
      accountId: targetAccount.id,
      direction: 'in',
      amount: depositAmt,
      currency: targetAccount.currency,
      note,
    };
    const updatedLedger = [...(nextState.cashLedger || []), ledgerEntry];
    return {
      ...nextState,
      cashLedger: updatedLedger,
      cashQAR: deriveCashQAR(nextState.cashAccounts, updatedLedger),
    };
  }

  const currentCash = nextState.cashQAR || 0;
  const newCash = currentCash + depositAmt;
  const cashTx: CashTransaction = {
    id: uid(),
    ts: now,
    type: 'sale_deposit',
    amount: depositAmt,
    balanceAfter: newCash,
    owner: nextState.cashOwner || '',
    bankAccount: '',
    note,
  };
  return {
    ...nextState,
    cashQAR: newCash,
    cashHistory: [...(nextState.cashHistory || []), cashTx],
  };
}
