import { uid, deriveCashQAR, type TrackerState, type CashLedgerEntry } from '@/lib/tracker-helpers';

export interface ApplyOrderCashDepositInput {
  nextState: TrackerState;
  cashDepositMode: 'none' | 'full' | 'partial';
  cashDepositAmountRaw: string;
  cashDepositAccountId: string;
  sell: number;
  amountUSDT: number;
  note: string;
  baseFiatCurrency?: 'QAR' | 'EGP';
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
  baseFiatCurrency = 'QAR',
  now = Date.now(),
}: ApplyOrderCashDepositInput): TrackerState {
  if (cashDepositMode === 'none') return nextState;

  const revenue = amountUSDT * sell;
  const depositAmt = cashDepositMode === 'full'
    ? revenue
    : Math.min(parseFloat(cashDepositAmountRaw) || 0, revenue);
  if (depositAmt <= 0) return nextState;

  const activeFiatAccounts = (nextState.cashAccounts || []).filter(a => a.status === 'active' && a.currency === baseFiatCurrency);
  const selectedActiveFiatAccount = activeFiatAccounts.find(a => a.id === cashDepositAccountId);
  const fallbackActiveFiatAccount = activeFiatAccounts[0];
  const targetAccount = selectedActiveFiatAccount || fallbackActiveFiatAccount;

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
  
  // Ensure deposits are reflected in Cash Management totals even when no QAR account exists yet.
  const autoAccountId = uid();
  const autoAccount = {
    id: autoAccountId,
    name: 'Cash Wallet',
    type: 'hand' as const,
    currency: baseFiatCurrency as const,
    status: 'active' as const,
    notes: 'Auto-created from order sale deposit',
    createdAt: now,
  };
  const ledgerEntry = {
    id: uid(),
    ts: now,
    type: 'sale_deposit' as const,
    accountId: autoAccountId,
    direction: 'in' as const,
    amount: depositAmt,
    currency: baseFiatCurrency as const,
    note,
  };
  const nextAccounts = [...(nextState.cashAccounts || []), autoAccount];
  const nextLedger = [...(nextState.cashLedger || []), ledgerEntry];
  return {
    ...nextState,
    cashAccounts: nextAccounts,
    cashLedger: nextLedger,
    cashQAR: deriveCashQAR(nextAccounts, nextLedger),
  };
}
