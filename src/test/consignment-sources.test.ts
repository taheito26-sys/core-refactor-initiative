import { describe, expect, it } from 'vitest';
import { computeFIFO, totalStock, stockCostQAR, type TrackerState } from '@/lib/tracker-helpers';
import {
  findConsignment, recordConsignmentReturn, recordConsignmentSale, sendConsignment, setConsignmentShare, ConsignmentError,
} from '@/features/stock/consignment';
import { consignFromRecord, openConsignmentsFor, returnFromRecord, undoConsignmentRecord } from '@/features/stock/consignment-sources';
import type { LoanSource } from '@/features/stock/loan-ledger';

const base = (usdt = 50000): TrackerState => ({
  batches: [{ id: 'b1', ts: 1, source: 'S', note: '', buyPriceQAR: 3.7, initialUSDT: usdt, revisions: [] }],
  trades: [], usdtTransfers: [], cashAccounts: [], cashLedger: [], customerLoans: [],
}) as unknown as TrackerState;

const outTransfer = (amount: number): LoanSource => ({
  type: 'exchange_transfer',
  transfer: { id: 't-out', exchange: 'binance', kind: 'pay', direction: 'out', asset: 'USDT', amount, reference: 'R1', counterparty: 'zack', transfer_time: new Date(2026, 10, 3).toISOString(), dismissed_at: null },
} as unknown as LoanSource);
const inTransfer = (amount: number): LoanSource => ({
  type: 'exchange_transfer',
  transfer: { id: 't-in', exchange: 'binance', kind: 'pay', direction: 'in', asset: 'USDT', amount, reference: 'R2', counterparty: 'zack', transfer_time: new Date(2026, 10, 5).toISOString(), dismissed_at: null },
} as unknown as LoanSource);
const sellOrder = (amount: number): LoanSource => ({
  type: 'exchange_order', available: amount,
  order: { id: 'o1', exchange: 'okx', order_number: 'N1', side: 'sell', amount, counterparty: 'zack', order_time: new Date(2026, 10, 3).toISOString() },
} as unknown as LoanSource);

describe('consignment made from an exchange record', () => {
  it('takes the record out of "needs a decision" and the USDT out of stock at cost, with no sale', () => {
    const r = consignFromRecord(base(), outTransfer(10000), { id: 'c1', counterpartyName: 'zack', profitSharePct: 50 });
    expect(r.dismiss).toEqual(['t-out']);
    const d = computeFIFO(r.state.batches, r.state.trades, r.state.usdtTransfers);
    expect(totalStock(d)).toBe(40000);
    expect(d.tradeCalc.size).toBe(0);
    expect(findConsignment(r.state, 'c1')).toMatchObject({ sent: 10000, open: 10000, profitSharePct: 50, status: 'open' });
  });

  it('works for a sell order too, linking the order so only the remainder stays in the list', () => {
    const r = consignFromRecord(base(), sellOrder(10000), { id: 'c1', counterpartyName: 'zack', profitSharePct: 50, amount: 4000 });
    expect(r.orderLinks).toEqual([expect.objectContaining({ orderId: 'o1', entityId: 'c1', amount: 4000 })]);
    expect(findConsignment(r.state, 'c1')!.sent).toBe(4000);
  });

  it('refuses a send the stock cannot cover, rather than guessing a cost', () => {
    expect(() => consignFromRecord(base(5000), outTransfer(10000), { id: 'c1', counterpartyName: 'zack', profitSharePct: 50 })).toThrow(ConsignmentError);
  });

  it('refuses an incoming record, since that cannot be USDT sent out', () => {
    expect(() => consignFromRecord(base(), inTransfer(1000), { id: 'c1', counterpartyName: 'zack', profitSharePct: 50 })).toThrow(ConsignmentError);
  });

  it('can be taken back out, giving the record back; but not once something was sold', () => {
    const sent = consignFromRecord(base(), outTransfer(10000), { id: 'c1', counterpartyName: 'zack', profitSharePct: 50 });
    const undone = undoConsignmentRecord(sent.state, 'c1');
    expect(undone.undismiss).toEqual(['t-out']);
    expect(totalStock(computeFIFO(undone.state.batches, undone.state.trades, undone.state.usdtTransfers))).toBe(50000);
    const sold = recordConsignmentSale(sent.state, { consignmentId: 'c1', saleId: 'e1', qty: 100, priceQAR: 3.8, unitCostQAR: 3.7 });
    expect(() => undoConsignmentRecord(sold, 'c1')).toThrow(ConsignmentError);
  });
});

describe('unsold USDT coming back as an exchange record', () => {
  const sent = () => consignFromRecord(base(), outTransfer(10000), { id: 'c1', counterpartyName: 'zack', profitSharePct: 50 }).state;

  it('is a return of that consignment at its original cost — not a purchase', () => {
    const r = returnFromRecord(sent(), inTransfer(4000), { consignmentId: 'c1', returnId: 'r1' });
    expect(r.dismiss).toEqual(['t-in']);
    expect(findConsignment(r.state, 'c1')).toMatchObject({ returned: 4000, open: 6000 });
    const d = computeFIFO(r.state.batches, r.state.trades, r.state.usdtTransfers);
    expect(totalStock(d)).toBe(44000);
    expect(stockCostQAR(d)).toBeCloseTo(44000 * 3.7, 6);
    expect(r.state.batches).toHaveLength(1); // no purchase batch was created
  });

  it('cannot return more than is still with the merchant, nor "return" sold USDT', () => {
    expect(() => returnFromRecord(sent(), inTransfer(10001), { consignmentId: 'c1', returnId: 'r1' })).toThrow(ConsignmentError);
    const sold = recordConsignmentSale(sent(), { consignmentId: 'c1', saleId: 'e1', qty: 10000, priceQAR: 3.8, unitCostQAR: 3.7 });
    expect(() => returnFromRecord(sold, inTransfer(1000), { consignmentId: 'c1', returnId: 'r1' })).toThrow(ConsignmentError);
  });

  it('offers the merchant\'s own open consignments first', () => {
    let s = sendConsignment(base(), { id: 'cA', counterpartyName: 'Farida', qty: 100 }, 5);
    s = sendConsignment(s, { id: 'cB', counterpartyName: 'zack', qty: 200 }, 4);
    expect(openConsignmentsFor(s, 'ZACK ')[0].id).toBe('cB');
  });

  it('a return recorded from a record is taken out again, restoring the record', () => {
    const r = returnFromRecord(sent(), inTransfer(4000), { consignmentId: 'c1', returnId: 'r1', remoteEventId: 'ev1' });
    expect(r.state.usdtTransfers!.find(x => x.id === 'r1')).toMatchObject({ consignmentId: 'c1', remoteEventId: 'ev1' });
    const u = undoConsignmentRecord(r.state, 'r1');
    expect(u.undismiss).toEqual(['t-in']);
    expect(findConsignment(u.state, 'c1')!.returned).toBe(0);
  });
});

describe('changing the profit ratio', () => {
  it('applies to later sales only; a sale already booked keeps the ratio it was made under', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'zack', qty: 10000, profitSharePct: 50 }, 5);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 4000, priceQAR: 3.8, unitCostQAR: 3.7 }, 6);
    s = setConsignmentShare(s, 'c1', 40, 7);
    expect(findConsignment(s, 'c1')!.profitSharePct).toBe(40);
    // A sale reported before the change, booked after it, still uses the ratio it was reported under.
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e2', qty: 3000, priceQAR: 3.8, unitCostQAR: 3.7, profitSharePct: 50 }, 8);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e3', qty: 3000, priceQAR: 3.8, unitCostQAR: 3.7 }, 9);
    const net = (id: string) => computeFIFO(s.batches, s.trades, s.usdtTransfers).tradeCalc.get(id)!.netQAR;
    expect(net('e1')).toBeCloseTo(200, 6); // 4,000 × 0.10 × 50%
    expect(net('e2')).toBeCloseTo(150, 6); // 3,000 × 0.10 × 50%, reported under the old ratio
    expect(net('e3')).toBeCloseTo(120, 6); // 3,000 × 0.10 × 40%, the new ratio
  });

  it('rejects a ratio outside 0–100', () => {
    const s = sendConsignment(base(), { id: 'c1', counterpartyName: 'zack', qty: 100 }, 5);
    expect(() => setConsignmentShare(s, 'c1', 101)).toThrow(ConsignmentError);
  });
});
