import { uid, type CashTransaction, type TrackerState } from '@/lib/tracker-helpers';

export type CashAccount = { id: string; name: string; currency: 'QAR'; balance: number; active: boolean };
export type FundingAllocation = { accountId: string; accountName: string; amount: number };

const CREDIT_TYPES = new Set(['deposit', 'batch_refund', 'order_refund', 'sale_proceeds', 'sale_deposit']);
const DEBIT_TYPES = new Set(['withdraw', 'batch_purchase', 'order_funding']);

export function getCashAccounts(state: TrackerState): CashAccount[] {
  const defaultName = state.cashOwner?.trim() || 'Cash on Hand';
  const names = new Set<string>([defaultName]);
  for (const tx of state.cashHistory || []) {
    if (tx.bankAccount?.trim()) names.add(tx.bankAccount.trim());
  }

  const balances = new Map<string, number>();
  for (const n of names) balances.set(n, 0);

  for (const tx of state.cashHistory || []) {
    const account = tx.bankAccount?.trim() || defaultName;
    const amount = Number(tx.amount) || 0;
    if (!balances.has(account)) balances.set(account, 0);
    if (CREDIT_TYPES.has(tx.type as string)) balances.set(account, (balances.get(account) || 0) + amount);
    if (DEBIT_TYPES.has(tx.type as string)) balances.set(account, (balances.get(account) || 0) - amount);
  }

  // Keep global total coherent with account sums: assign drift to default account.
  const sum = [...balances.values()].reduce((s, v) => s + v, 0);
  const drift = (Number(state.cashQAR) || 0) - sum;
  if (Math.abs(drift) > 0.0001) balances.set(defaultName, (balances.get(defaultName) || 0) + drift);

  return [...balances.entries()].map(([name, balance]) => ({
    id: name,
    name,
    currency: 'QAR' as const,
    balance: Math.round(balance * 100) / 100,
    active: true,
  })).sort((a, b) => b.balance - a.balance);
}

export function allocateFunding(accounts: CashAccount[], amount: number, selectedAccountId: string | 'auto'): FundingAllocation[] {
  const target = Math.max(0, amount);
  if (target <= 0) return [];
  const netAvailable = Math.round(accounts.reduce((sum, account) => sum + account.balance, 0) * 100) / 100;
  if (netAvailable + 1e-9 < target) return [];

  if (selectedAccountId !== 'auto') {
    const account = accounts.find(a => a.id === selectedAccountId);
    if (!account) return [];
    if (account.balance + 1e-9 < target) return [];
    return [{ accountId: account.id, accountName: account.name, amount: target }];
  }

  let remaining = target;
  const entries: FundingAllocation[] = [];
  for (const account of accounts.filter(a => a.balance > 0)) {
    if (remaining <= 0) break;
    const take = Math.min(account.balance, remaining);
    if (take > 0) {
      entries.push({ accountId: account.id, accountName: account.name, amount: Math.round(take * 100) / 100 });
      remaining -= take;
    }
  }

  if (remaining > 0.009) return [];
  return entries;
}

export function appendCashLedger(state: TrackerState, txs: Array<Omit<CashTransaction, 'id' | 'ts' | 'balanceAfter'>>): TrackerState {
  let cash = Number(state.cashQAR) || 0;
  const history = [...(state.cashHistory || [])];

  for (const tx of txs) {
    const amount = Number(tx.amount) || 0;
    const direction = CREDIT_TYPES.has(tx.type as string) ? 1 : -1;
    cash += direction * amount;
    history.push({
      ...tx,
      id: uid(),
      ts: Date.now(),
      balanceAfter: Math.max(0, Math.round(cash * 100) / 100),
    });
  }

  return { ...state, cashQAR: Math.max(0, Math.round(cash * 100) / 100), cashHistory: history };
}
