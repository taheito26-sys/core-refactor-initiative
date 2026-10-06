import { describe, expect, it } from 'vitest';
import { flowKindOf, flowRows, flowToCsv, groupByDay, periodStart, totalsOf } from '@/lib/trading/cash-flow';
import type { CashAccount, CashLedgerEntry } from '@/lib/tracker-helpers';

const D = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();
const accounts = [{ id: 'a', name: 'Hand' }, { id: 'b', name: 'Bank' }] as CashAccount[];
const e = (id: string, ts: number, type: string, direction: 'in' | 'out', amount: number, accountId = 'a', currency = 'QAR', note?: string) =>
  ({ id, ts, type, direction, amount, accountId, currency, note }) as unknown as CashLedgerEntry;
const ledger = [
  e('1', D(10, 1), 'sale_deposit', 'in', 1000),
  e('2', D(10, 1, 15), 'withdrawal', 'out', 300, 'a', 'QAR', 'rent'),
  e('3', D(10, 2), 'transfer_out', 'out', 500),
  e('4', D(10, 2), 'transfer_in', 'in', 500, 'b'),
  e('5', D(10, 3), 'deposit', 'in', 50, 'b', 'USD'),
  e('6', D(10, 3), 'reconcile', 'out', 5),
];

describe('cash flow', () => {
  it('treats transfers between own accounts and corrections as neither income nor spending', () => {
    expect(flowKindOf(ledger[2])).toBe('transfer');
    expect(flowKindOf(ledger[5])).toBe('adjustment');
    expect(flowKindOf(ledger[0])).toBe('in');
    const rows = flowRows(ledger, accounts);
    expect(rows.map(r => r.entry.id)).toEqual(['5', '2', '1']);
    expect(flowRows(ledger, accounts, { includeInternal: true })).toHaveLength(6);
  });

  it('totals in, out and net per currency, QAR first', () => {
    const t = totalsOf(flowRows(ledger, accounts));
    expect(t).toEqual([
      { currency: 'QAR', inAmount: 1000, outAmount: 300, net: 700 },
      { currency: 'USD', inAmount: 50, outAmount: 0, net: 50 },
    ]);
  });

  it('filters by account, direction, period and text, and groups by day newest first', () => {
    expect(flowRows(ledger, accounts, { accountId: 'b' }).map(r => r.entry.id)).toEqual(['5']);
    expect(flowRows(ledger, accounts, { direction: 'out' }).map(r => r.entry.id)).toEqual(['2']);
    expect(flowRows(ledger, accounts, { query: 'rent' }).map(r => r.entry.id)).toEqual(['2']);
    expect(flowRows(ledger, accounts, { from: D(10, 3, 0) }).map(r => r.entry.id)).toEqual(['5']);
    const days = groupByDay(flowRows(ledger, accounts));
    expect(days.map(d => d.day)).toEqual(['2026-10-03', '2026-10-01']);
    expect(days[1].totals[0]).toMatchObject({ inAmount: 1000, outAmount: 300, net: 700 });
  });

  it('starts periods at local midnight', () => {
    const now = D(10, 15, 14);
    expect(periodStart('today', now)).toBe(D(10, 15, 0));
    expect(periodStart('7d', now)).toBe(D(10, 9, 0));
    expect(periodStart('month', now)).toBe(D(10, 1, 0));
    expect(periodStart('all', now)).toBeUndefined();
  });

  it('writes a CSV with signed amounts and escaped quotes', () => {
    const csv = flowToCsv(flowRows([e('x', D(10, 1), 'withdrawal', 'out', 20, 'a', 'QAR', 'say "hi"')], accounts), accounts, ty => ty);
    expect(csv.split('\n')[1]).toContain('"-20"');
    expect(csv).toContain('"say ""hi"""');
  });
});
