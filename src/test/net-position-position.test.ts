import { describe, expect, it } from 'vitest';
import {
  LINE_ORDER, USD_QAR_PEG, computePosition, countableAccounts, monthsAvailable, qatarDay, sameDayRow, summariseMonth, toDayRow,
  type DayRow, type PositionInput,
} from '@/features/net-position/position';

const acc = (id: string, type: string, currency: string, status = 'active') => ({ id, name: id, type, currency, status, createdAt: 0 });
const led = (accountId: string, ts: number, direction: 'in' | 'out', amount: number) =>
  ({ id: `${accountId}-${ts}-${amount}-${direction}`, ts, type: 'deposit', accountId, direction, amount, currency: 'QAR' });
const batch = (id: string, ts: number, usdt: number, price: number) => ({ id, ts, source: 'S', note: '', buyPriceQAR: price, initialUSDT: usdt, revisions: [] });

const base = (over: Partial<PositionInput> = {}): PositionInput => ({
  accounts: [], ledger: [], includedAccountIds: new Set(), customerLoans: [], customerName: id => id, personalLoans: [],
  exchange: { binance: 0, okx: 0 }, batches: [], trades: [], ...over,
}) as PositionInput;
const line = (p: ReturnType<typeof computePosition>, key: string) => p.lines.find(l => l.key === key)?.qar ?? 0;

describe('computePosition', () => {
  it('is zero until something is chosen: nothing is counted by default', () => {
    const p = computePosition(base({
      accounts: [acc('hand', 'hand', 'QAR'), acc('bank', 'bank', 'QAR')] as never,
      ledger: [led('hand', 1, 'in', 5000), led('bank', 1, 'in', 9000)] as never,
    }));
    expect(p.netQAR).toBe(0);
    expect(p.lines.map(l => l.key)).toEqual(LINE_ORDER);
  });

  it('counts the whole balance of each ticked hand and bank account, and only those', () => {
    const p = computePosition(base({
      accounts: [acc('hand', 'hand', 'QAR'), acc('other', 'hand', 'QAR'), acc('bank', 'bank', 'QAR')] as never,
      ledger: [led('hand', 1, 'in', 5000), led('hand', 2, 'out', 200), led('other', 1, 'in', 80000), led('bank', 1, 'in', 9000)] as never,
      includedAccountIds: new Set(['hand', 'bank']),
    }));
    expect(line(p, 'cash_hand')).toBe(4800);
    expect(line(p, 'cash_bank')).toBe(9000);
    expect(p.netQAR).toBe(13800);
  });

  it('never counts vault or custody accounts or USDT accounts, even if ticked', () => {
    const accounts = [acc('v', 'vault', 'QAR'), acc('c', 'merchant_custody', 'QAR'), acc('u', 'bank', 'USDT'), acc('off', 'hand', 'QAR', 'inactive')];
    expect(countableAccounts(accounts as never)).toEqual([]);
    const p = computePosition(base({
      accounts: accounts as never,
      ledger: accounts.map(a => led(a.id, 1, 'in', 1000)) as never,
      includedAccountIds: new Set(accounts.map(a => a.id)),
    }));
    expect(p.netQAR).toBe(0);
  });

  it('values USD at the typed rate, else the USDT buying price, else the peg', () => {
    const input = base({ accounts: [acc('usd', 'hand', 'USD')] as never, ledger: [led('usd', 1, 'in', 100)] as never, includedAccountIds: new Set(['usd']) });
    expect(line(computePosition({ ...input, usdRateOverride: 3.7 }), 'cash_hand')).toBe(370);
    expect(line(computePosition({ ...input, batches: [batch('b', 1, 1000, 3.6)] as never }), 'cash_hand')).toBe(360);
    expect(computePosition(input).rates.usdToQar).toBe(USD_QAR_PEG);
  });

  it('counts USDT on the exchanges as the live balance only, priced at the buying cost', () => {
    const p = computePosition(base({ exchange: { binance: 700, okx: 100 }, batches: [batch('b', 1, 1000, 3.6)] as never }));
    expect(line(p, 'exchange_usdt')).toBe(800 * 3.6);
    expect(p.lines.find(l => l.key === 'exchange_usdt')?.details.map(d => d.label)).toEqual(['Binance', 'OKX']);
  });

  it('does not count USDT in stock or in transfers, only the exchange balance', () => {
    const p = computePosition(base({
      batches: [batch('b', 1, 5000, 3.6)] as never,
      usdtTransfers: [{ id: 't', ts: 2, kind: 'lend_out', amountUSDT: 100, counterpartyName: 'A', createdAt: 0 }] as never,
      exchange: { binance: 0, okx: 0 },
    }));
    expect(p.netQAR).toBe(0);
  });

  it('warns when USDT cannot be priced', () => {
    const p = computePosition(base({ exchange: { binance: 10, okx: 0 } }));
    expect(p.warnings).toContain('usdt_unpriced');
  });

  it('counts what customers still owe, by customer, and ignores deleted and settled loans', () => {
    const loan = (id: string, customerId: string, principal: number, repaid = 0, currency = 'QAR') =>
      ({ id, ts: 1, customerId, principal, currency, status: 'open', createdAt: 0, repayments: repaid ? [{ id: `${id}r`, ts: 2, amount: repaid }] : [] });
    const p = computePosition(base({
      customerLoans: [loan('l1', 'dam', 200000, 22704.28), loan('l2', 'dam', 100, 0), loan('l3', 'omar', 500, 500), loan('l4', 'gone', 999)] as never,
      deletedLoanIds: ['l4'],
      customerName: id => ({ dam: 'Muhammad Al-Damrawi' } as Record<string, string>)[id] ?? id,
    }));
    const details = p.lines.find(l => l.key === 'customer_loans')!.details;
    expect(details.map(d => d.label)).toEqual(['Muhammad Al-Damrawi']);
    expect(line(p, 'customer_loans')).toBe(177295.72 + 100);
  });

  it('counts an EGP loan by the USDT it cost, at its own sale rate', () => {
    const p = computePosition(base({
      batches: [batch('b', 1, 1000, 3.6)] as never,
      trades: [{ id: 't', ts: 2, amountUSDT: 1000, sellPriceQAR: 3.8, originalFiat: 'EGP', originalFiatPriceUSDT: 50, voided: false, usesStock: true, customerId: 'c', feeQAR: 0, inputMode: 'USDT', note: '', revisions: [] }] as never,
      customerLoans: [{ id: 'l', ts: 2, customerId: 'c', tradeId: 't', principal: 50000, currency: 'EGP', status: 'open', createdAt: 0, repayments: [{ id: 'r', ts: 3, amount: 20000 }] }] as never,
    }));
    expect(p.warnings).toEqual([]);
    expect(line(p, 'customer_loans')).toBe((30000 / 50) * 3.6);
  });

  it('counts personal loans still owed', () => {
    const p = computePosition(base({
      personalLoans: [
        { id: 'p1', person: 'Ahmed', principal: 7000, currency: 'QAR', lentAt: 1, repayments: [{ id: 'r', ts: 2, amount: 1000 }] },
        { id: 'p2', person: 'Omar', principal: 100, currency: 'USD', lentAt: 1, repayments: [] },
      ],
      usdRateOverride: 3.7,
    }));
    expect(line(p, 'personal_loans')).toBe(6000 + 370);
  });

  it('adds the five lines and nothing else', () => {
    const p = computePosition(base({
      accounts: [acc('hand', 'hand', 'QAR'), acc('bank', 'bank', 'QAR')] as never,
      ledger: [led('hand', 1, 'in', 1000), led('bank', 1, 'in', 9000)] as never,
      includedAccountIds: new Set(['hand', 'bank']),
      batches: [batch('s', 1, 1000, 3.6)] as never,
      exchange: { binance: 10, okx: 0 },
      customerLoans: [{ id: 'l', ts: 2, customerId: 'c', principal: 2000, currency: 'QAR', status: 'open', createdAt: 0, repayments: [] }] as never,
      personalLoans: [{ id: 'p', person: 'F', principal: 500, currency: 'QAR', lentAt: 1, repayments: [] }],
    }));
    expect(p.netQAR).toBe(1000 + 9000 + 36 + 2000 + 500);
  });
});

describe('days and months', () => {
  const row = (day: string, net: number, hand = net): DayRow => ({ day, lines: { cash_hand: hand }, net });

  it('uses the Qatar day, three hours ahead of UTC', () => {
    expect(qatarDay(Date.UTC(2026, 9, 9, 21, 30))).toBe('2026-10-10');
    expect(qatarDay(Date.UTC(2026, 9, 9, 20, 30))).toBe('2026-10-09');
  });

  it('opens a month at the last saved day before it and closes at its last saved day', () => {
    const rows = [row('2026-09-29', 100), row('2026-09-30', 120), row('2026-10-02', 150), row('2026-10-09', 170)];
    const s = summariseMonth(rows, '2026-10');
    expect(s.opening?.net).toBe(120);
    expect(s.openingIsFirstDay).toBe(false);
    expect(s.closing?.net).toBe(170);
    expect(s.change).toBe(50);
    expect(s.days.map(d => d.change)).toEqual([30, 20]);
    expect(s.perLine.find(l => l.key === 'cash_hand')).toEqual({ key: 'cash_hand', opening: 120, closing: 170, change: 50 });
  });

  it('opens at the first saved day, and says so, when nothing earlier was saved', () => {
    const s = summariseMonth([row('2026-10-10', 300), row('2026-10-12', 340)], '2026-10');
    expect(s.opening?.net).toBe(300);
    expect(s.openingIsFirstDay).toBe(true);
    expect(s.change).toBe(40);
    expect(s.days.map(d => d.change)).toEqual([null, 40]);
  });

  it('lists the months from the first saved day, newest first', () => {
    expect(monthsAvailable([row('2026-08-20', 1), row('2026-10-02', 2)], '2026-10-10')).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(monthsAvailable([], '2026-10-10')).toEqual(['2026-10']);
  });

  it('knows when today is already saved', () => {
    const p = { lines: [{ key: 'cash_hand' as const, qar: 100.2, details: [] }], netQAR: 100.2 };
    const r = toDayRow(p, '2026-10-10');
    expect(sameDayRow(r, toDayRow({ ...p, netQAR: 100.4, lines: [{ key: 'cash_hand', qar: 100.4, details: [] }] }, '2026-10-10'))).toBe(true);
    expect(sameDayRow(r, toDayRow({ ...p, netQAR: 105, lines: [{ key: 'cash_hand', qar: 105, details: [] }] }, '2026-10-10'))).toBe(false);
    expect(sameDayRow(undefined, r)).toBe(false);
  });
});
