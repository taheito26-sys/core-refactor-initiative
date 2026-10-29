import { getAccountBalance, getLoanRemaining, getLoanRepaid, type CashAccount, type CashLedgerEntry, type TrackerState } from '@/lib/tracker-helpers';

export function balanceAt(entries: CashLedgerEntry[], until: number) {
  return entries.reduce((sum, e) => e.ts <= until ? sum + (e.direction === 'in' ? e.amount : -e.amount) : sum, 0);
}

export function cashTrend(entries: CashLedgerEntry[], now: number) {
  return Array.from({ length: 10 }, (_, i) => balanceAt(entries, now - (9 - i) * 3 * 86400000));
}

export function cashChange(balance: number, previous: number) {
  return previous !== 0 ? (balance - previous) / Math.abs(previous) * 100 : null;
}

export function buildCashOverview(state: TrackerState, now: number) {
  const accounts = state.cashAccounts || [];
  const ledger = state.cashLedger || [];
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const active = accounts.filter(a => a.status === 'active');
  const totals = new Map<string, number>();
  for (const a of active.filter(a => a.type !== 'merchant_custody')) totals.set(a.currency, (totals.get(a.currency) || 0) + getAccountBalance(a.id, ledger));
  const entriesByAccount = new Map<string, CashLedgerEntry[]>();
  for (const e of ledger) { const rows = entriesByAccount.get(e.accountId) || []; rows.push(e); entriesByAccount.set(e.accountId, rows); }
  const rows = accounts.map(account => {
    const entries = entriesByAccount.get(account.id) || [];
    const balance = getAccountBalance(account.id, entries);
    const previous = balanceAt(entries, monthStart - 1);
    const total = totals.get(account.currency) || 0;
    return {
      account, balance, previous, change: cashChange(balance, previous), trend: cashTrend(entries, now),
      share: account.status === 'active' && account.type !== 'merchant_custody' && total > 0 ? balance / total * 100 : null,
      movement: entries.filter(e => e.ts >= now - 86400000 && e.ts <= now).reduce((sum, e) => sum + (e.direction === 'in' ? e.amount : -e.amount), 0),
      lastTs: entries.reduce((latest, e) => Math.max(latest, e.ts), 0),
      batches: (state.batches || []).filter(b => b.fundingAccountId === account.id).length,
    };
  });
  const aggregate = (types?: CashAccount['type'][]) => {
    const selected = active.filter(a => a.currency === 'QAR' && (types ? types.includes(a.type) : a.type !== 'merchant_custody'));
    const ids = new Set(selected.map(a => a.id));
    const entries = ledger.filter(e => ids.has(e.accountId));
    const balance = selected.reduce((sum, a) => sum + getAccountBalance(a.id, entries), 0);
    return { balance, change: cashChange(balance, balanceAt(entries, monthStart - 1)), trend: cashTrend(entries, now) };
  };
  const deleted = new Set(state.deletedLoanIds || []);
  const loans = (state.customerLoans || []).filter(l => !deleted.has(l.id));
  const loanTotals = new Map<string, { currency: string; given: number; repaid: number; remaining: number }>();
  for (const loan of loans) {
    const row = loanTotals.get(loan.currency) || { currency: loan.currency, given: 0, repaid: 0, remaining: 0 };
    row.given += loan.principal; row.repaid += getLoanRepaid(loan); row.remaining += getLoanRemaining(loan);
    loanTotals.set(loan.currency, row);
  }
  const loanRows = [...loanTotals.values()].sort((a, b) => b.remaining - a.remaining || b.given - a.given);
  const lead = loanRows[0] || { currency: 'QAR', given: 0, repaid: 0, remaining: 0 };
  const loanBalanceAt = (until: number) => loans.filter(l => l.currency === lead.currency && l.ts <= until).reduce((sum, l) => sum + Math.max(0, l.principal - (l.repayments || []).filter(r => r.ts <= until).reduce((paid, r) => paid + r.amount, 0)), 0);
  return { rows, total: aggregate(), hand: aggregate(['hand']), banks: aggregate(['bank']), loan: { ...lead, change: cashChange(lead.remaining, loanBalanceAt(monthStart - 1)), trend: Array.from({ length: 10 }, (_, i) => loanBalanceAt(now - (9 - i) * 3 * 86400000)), percent: lead.given > 0 ? Math.min(100, Math.max(0, lead.repaid / lead.given * 100)) : 0 }, otherLoans: loanRows.slice(1) };
}
