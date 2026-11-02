import { deriveCashQAR, getAccountBalance, uid, type CashAccount, type CashLedgerEntry, type TrackerState } from '@/lib/tracker-helpers';

/** Set the account's actual balance without recording an ordinary cash receipt or payment. */
export function editCashAccount(state: TrackerState, account: CashAccount, balance?: number, now = Date.now(), correctionId = uid()): TrackerState {
  if (!state.cashAccounts.some(row => row.id === account.id)) throw new Error('Account no longer exists. Reload before editing.');
  if (balance !== undefined && !Number.isFinite(balance)) throw new Error('Enter a valid balance.');
  const baseLedger = state.cashLedger.filter(entry => entry.id !== correctionId);
  const before = getAccountBalance(account.id, baseLedger);
  const precision = account.currency === 'USDT' ? 1e8 : 100;
  const difference = balance === undefined ? 0 : Math.round((balance - before) * precision) / precision;
  const correction: CashLedgerEntry[] = difference === 0 ? [] : [{
    id: correctionId, ts: now, type: 'reconcile', accountId: account.id,
    direction: difference > 0 ? 'in' : 'out', amount: Math.abs(difference), currency: account.currency,
    note: `Balance correction: ${before} → ${balance}`,
  }];
  const accounts = state.cashAccounts.map(row => row.id === account.id ? { ...row, ...account, ...(correction.length ? { lastReconciled: now } : {}) } : row);
  const ledger = [...baseLedger, ...correction];
  return { ...state, cashAccounts: accounts, cashLedger: ledger, cashQAR: deriveCashQAR(accounts, ledger) };
}
