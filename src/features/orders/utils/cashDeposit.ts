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
    const nextCashQAR = deriveCashQAR(nextState.cashAccounts, updatedLedger);
    return {
      ...nextState,
      cashLedger: updatedLedger,
      cashHistory: [...(nextState.cashHistory || []), {
        id: uid(),
        ts: now,
        type: 'sale_deposit',
        amount: depositAmt,
        balanceAfter: nextCashQAR,
        owner: nextState.cashOwner || '',
        bankAccount: targetAccount.name,
        note,
      }],
      cashQAR: nextCashQAR,
    };
  }
  
  // Ensure deposits are reflected in Cash Management totals even when no QAR account exists yet.
  const autoAccountId = uid();
  const autoAccount = {
    id: autoAccountId,
    name: 'Cash Wallet',
    type: 'hand' as const,
    currency: baseFiatCurrency ?? 'QAR',
    status: 'active' as const,
    notes: 'Auto-created from order sale deposit',
    createdAt: now,
  };
  const openingBalance = Math.max(0, nextState.cashQAR || 0);
  const openingEntry = openingBalance > 0 ? {
    id: uid(),
    ts: now,
    type: 'opening' as const,
    accountId: autoAccountId,
    direction: 'in' as const,
    amount: openingBalance,
    currency: baseFiatCurrency ?? 'QAR',
    note: 'Migrated legacy cash balance',
  } : null;
  const ledgerEntry = {
    id: uid(),
    ts: now,
    type: 'sale_deposit' as const,
    accountId: autoAccountId,
    direction: 'in' as const,
    amount: depositAmt,
    currency: baseFiatCurrency ?? 'QAR',
    note,
  };
  const nextAccounts = [...(nextState.cashAccounts || []), autoAccount];
  const nextLedger = [...(nextState.cashLedger || []), ...(openingEntry ? [openingEntry] : []), ledgerEntry];
  const nextCashQAR = deriveCashQAR(nextAccounts, nextLedger);
  return {
    ...nextState,
    cashAccounts: nextAccounts,
    cashLedger: nextLedger,
    cashHistory: [...(nextState.cashHistory || []), {
      id: uid(),
      ts: now,
      type: 'sale_deposit',
      amount: depositAmt,
      balanceAfter: nextCashQAR,
      owner: nextState.cashOwner || '',
      bankAccount: autoAccount.name,
      note,
    }],
    cashQAR: nextCashQAR,
  };
}
