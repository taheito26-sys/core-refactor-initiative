import type { CashLedgerEntry, TrackerState } from '@/lib/tracker-helpers';

export function cashFlowWindow(entries: CashLedgerEntry[], now: number, range: string) {
  const date = new Date(now);
  const month = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const end = range === 'last_month' ? month - 1 : now;
  const start = range === 'today' ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    : range === 'this_month' ? month
    : range === 'last_month' ? new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime()
    : range === 'all' ? Math.min(now, ...entries.map(e => e.ts).filter(Number.isFinite))
    : now - (range === '7d' ? 7 : 30) * 86400000;
  return { start, end };
}

export function buildCashFlow(state: TrackerState, now: number, range: string) {
  const accounts = new Map((state.cashAccounts || []).map(a => [a.id, a]));
  const ledger = (state.cashLedger || []).filter(e => accounts.has(e.accountId) && Number.isFinite(e.ts));
  const window = cashFlowWindow(ledger, now, range);
  const entries = ledger.filter(e => e.ts >= window.start && e.ts <= window.end);
  const eligible = entries.filter(e => e.currency === 'QAR' && accounts.get(e.accountId)?.type !== 'merchant_custody'
    && !['opening', 'reconcile'].includes(e.type)
    && !(['transfer_in', 'transfer_out'].includes(e.type) && e.contraAccountId && accounts.get(e.contraAccountId)?.currency === 'QAR' && accounts.get(e.contraAccountId)?.type !== 'merchant_custody'));
  const count = Math.min(30, Math.max(1, Math.ceil((window.end - window.start) / 86400000)));
  const bins = Array.from({ length: count }, (_, i) => ({ ts: window.start + i * (window.end - window.start) / count, inflow: 0, outflow: 0 }));
  let inflow = 0, outflow = 0;
  for (const e of eligible) {
    const index = Math.min(count - 1, Math.floor((e.ts - window.start) / Math.max(1, window.end - window.start) * count));
    if (e.direction === 'in') { inflow += e.amount; bins[index].inflow += e.amount; }
    else { outflow += e.amount; bins[index].outflow += e.amount; }
  }
  const recent = entries.filter(e => e.type !== 'transfer_in').sort((a, b) => b.ts - a.ts).slice(0, 3);
  return { ...window, bins, inflow, outflow, recent, accounts };
}
