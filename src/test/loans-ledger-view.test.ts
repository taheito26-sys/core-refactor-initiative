import { describe, expect, it } from 'vitest';
import type { UsdtTransfer } from '@/lib/usdt-transfers';
import type { SharedLoanMove } from '@/features/stock/loan-sync';
import { buildLoanLedger, filterLedger } from '@/features/stock/loans-ledger-view';

const T = (id: string, ts: number, kind: UsdtTransfer['kind'], amountUSDT: number, who: string, extra: Partial<UsdtTransfer> = {}): UsdtTransfer =>
  ({ id, ts, kind, amountUSDT, counterpartyName: who, createdAt: ts, ...extra });
const move = (over: Partial<SharedLoanMove>): SharedLoanMove => ({ id: 'm', direction: 'out', amountUSDT: 100, ts: 1, status: 'pending', iAmProposer: false, counterpartyName: 'zack', ...over });

const data = () => [
  T('a1', 10, 'lend_out', 5000, 'Ahmed'),
  T('a2', 20, 'lend_return', 2000, 'Ahmed'),
  T('o1', 5, 'borrow_in', 20000, 'OKX Pay'),
  T('o2', 15, 'borrow_repay', 12000, 'OKX Pay'),
  T('z1', 30, 'lend_out', 10000, 'zack', { remoteLoanId: 'mv1' }),
];

describe('loans ledger', () => {
  it('lists every movement newest first, each with its direction, label and running balance', () => {
    const l = buildLoanLedger(data(), [move({ id: 'mv1', status: 'approved', iAmProposer: true })]);
    expect(l.rows.map(r => r.id)).toEqual(['z1', 'a2', 'o2', 'a1', 'o1']);
    const byId = Object.fromEntries(l.rows.map(r => [r.id, r]));
    expect(byId.a1).toMatchObject({ direction: 'out', label: 'lent', balanceAfter: -5000 });
    expect(byId.a2).toMatchObject({ direction: 'in', label: 'returned', balanceAfter: -3000 }); // Ahmed still owes 3,000
    expect(byId.o1).toMatchObject({ direction: 'in', label: 'borrowed', balanceAfter: 20000 });
    expect(byId.o2).toMatchObject({ direction: 'out', label: 'repaid', balanceAfter: 8000 }); // I still owe 8,000
  });

  it('totals: what I am owed, what I owe, and the net', () => {
    const t = buildLoanLedger(data(), []).totals;
    expect(t).toMatchObject({ owedToMe: 13000, iOwe: 8000, net: 5000, merchantsOwingMe: 2, merchantsIOwe: 1 });
  });

  it('per merchant: who owes whom, and how much of it has been settled', () => {
    const m = Object.fromEntries(buildLoanLedger(data(), []).merchants.map(x => [x.name, x]));
    expect(m.Ahmed).toMatchObject({ owesMe: 3000, iOwe: 0, lentTotal: 5000, returnedTotal: 2000 });
    expect(m.Ahmed.settledShare).toBeCloseTo(0.4, 6);
    expect(m['OKX Pay']).toMatchObject({ owesMe: 0, iOwe: 8000, borrowedTotal: 20000, repaidTotal: 12000 });
    expect(m['OKX Pay'].settledShare).toBeCloseTo(0.6, 6);
  });

  it('shows whether the other merchant confirmed a shared movement, and what is still waiting', () => {
    const l = buildLoanLedger(data(), [
      move({ id: 'mv1', status: 'pending', iAmProposer: true, amountUSDT: 10000 }),
      move({ id: 'mv2', status: 'pending', iAmProposer: false, amountUSDT: 1500 }),
    ]);
    expect(l.rows.find(r => r.id === 'z1')!.status).toBe('pending');
    expect(l.rows.find(r => r.id === 'a1')!.status).toBe('not_shared');
    expect(l.incoming.map(m => m.id)).toEqual(['mv2']);
    expect(l.totals).toMatchObject({ pendingCount: 2, pendingUSDT: 11500 });
    const approved = buildLoanLedger(data(), [move({ id: 'mv1', status: 'approved', iAmProposer: true })]);
    expect(approved.rows.find(r => r.id === 'z1')!.status).toBe('confirmed');
  });

  it('keeps consignments out of loan balances and summarises them on their own', () => {
    const all = [
      ...data(),
      T('c1', 40, 'lend_out', 8000, 'Farida', { consignment: { profitSharePct: 50, soldUSDT: 3000 } }),
      T('c2', 41, 'lend_return', 1000, 'Farida', { consignmentId: 'c1' }),
    ];
    const l = buildLoanLedger(all, []);
    expect(l.rows.some(r => r.merchant === 'Farida')).toBe(false);
    expect(l.totals.owedToMe).toBe(13000); // unchanged: Farida's consignment is not a loan
    expect(l.consignments).toEqual({ openCount: 1, stillWithMerchants: 4000, merchants: ['Farida'] }); // 8,000 − 3,000 sold − 1,000 returned
  });

  it('leaves out loans hidden from the Loans page', () => {
    const l = buildLoanLedger([...data(), T('h1', 1, 'borrow_in', 99999, 'Old', { hiddenFromLoans: true })], []);
    expect(l.merchants.some(m => m.name === 'Old')).toBe(false);
    expect(l.rows.some(r => r.id === 'h1')).toBe(false);
  });

  it('filters by direction, pending, and merchant', () => {
    const l = buildLoanLedger(data(), [move({ id: 'mv1', status: 'pending', iAmProposer: true })]);
    expect(filterLedger(l.rows, 'out').every(r => r.direction === 'out')).toBe(true);
    expect(filterLedger(l.rows, 'in').map(r => r.id).sort()).toEqual(['a2', 'o1']);
    expect(filterLedger(l.rows, 'pending').map(r => r.id)).toEqual(['z1']);
    expect(filterLedger(l.rows, 'all', l.merchants.find(m => m.name === 'Ahmed')!.key).map(r => r.id)).toEqual(['a2', 'a1']);
  });

  it('a settled merchant has a full bar and no balance', () => {
    const l = buildLoanLedger([T('s1', 1, 'lend_out', 100, 'X'), T('s2', 2, 'lend_return', 100, 'X')], []);
    expect(l.merchants[0]).toMatchObject({ owesMe: 0, iOwe: 0, settledShare: 1 });
  });
});


describe('ledger trend series and CSV', () => {
  it('tracks running owed/owe/net per movement and exports a quoted CSV', async () => {
    const { buildLoanLedger, ledgerToCsv } = await import('@/features/stock/loans-ledger-view');
    const l = buildLoanLedger([
      { id: 'a', ts: 1000, kind: 'lend_out', amountUSDT: 100, counterpartyName: 'Zed Z', createdAt: 1 },
      { id: 'b', ts: 2000, kind: 'lend_return', amountUSDT: 40, counterpartyName: 'Zed Z', createdAt: 2 },
    ] as never);
    expect(l.series.owed).toEqual([100, 60]);
    expect(l.series.net).toEqual([100, 60]);
    expect(l.series.count).toEqual([1, 2]);
    const csv = ledgerToCsv(l.rows);
    expect(csv.split('\n')).toHaveLength(3);
    expect(csv).toContain('"Zed Z"');
  });
});
