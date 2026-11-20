import { describe, expect, it } from 'vitest';
import { computeFIFO, totalStock, type TrackerState } from '@/lib/tracker-helpers';
import { getUsdtTransferBalances } from '@/lib/usdt-transfers';
import {
  CONSIGNMENT_OVERDUE_DAYS, ConsignmentError, consignmentAgeDays, consignmentPayables, consignmentReceivables, findConsignment,
  overdueConsignments, recordConsignmentReturn, recordConsignmentSale, recordConsignmentShortfall, recordReceivedConsignmentBuyout,
  recordReceivedConsignmentSettlement, sendConsignment, undoConsignmentTransfer,
} from '@/features/stock/consignment';

const cashAccounts = [{ id: 'cash1', name: 'Cash', type: 'hand', currency: 'QAR', status: 'active', createdAt: 0 }];
const mk = (batches: { id: string; ts: number; p: number; q: number }[]): TrackerState => ({
  batches: batches.map(b => ({ id: b.id, ts: b.ts, source: 'S', note: '', buyPriceQAR: b.p, initialUSDT: b.q, revisions: [] })),
  trades: [], usdtTransfers: [], cashAccounts, cashLedger: [], customerLoans: [],
}) as unknown as TrackerState;
const net = (s: TrackerState, id: string) => computeFIFO(s.batches, s.trades, s.usdtTransfers).tradeCalc.get(id)!.netQAR;

describe('merchant buys it outright', () => {
  it('owner: the whole profit is mine and the merchant owes the full price', () => {
    let s = sendConsignment(mk([{ id: 'b', ts: 1, p: 3.7, q: 50000 }]), { id: 'c1', counterpartyName: 'zack', qty: 10000, profitSharePct: 50 }, 5);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 4000, priceQAR: 3.75, unitCostQAR: 3.7, profitSharePct: 100, buyout: true }, 6);
    expect(net(s, 'e1')).toBeCloseTo(4000 * 0.05, 6); // 200, none of it shared
    expect(consignmentReceivables(s)).toEqual([{ counterpartyName: 'zack', owedQAR: 15000 }]); // 4,000 × 3.75
    expect(s.trades[0].consignment).toMatchObject({ buyout: true, partnerSharePct: 0 });
    expect(findConsignment(s, 'c1')).toMatchObject({ sold: 4000, open: 6000 });
  });

  it('receiver: the USDT becomes their stock at the agreed price, the price is a payable that never reaches profit', () => {
    let s = mk([]);
    s = recordReceivedConsignmentBuyout(s, { buyoutId: 'e1', consignmentId: 'c1', counterpartyName: 'Mohamed', qty: 4000, priceQAR: 3.75 }, 6);
    const d = computeFIFO(s.batches, s.trades, s.usdtTransfers);
    expect(totalStock(d)).toBe(4000);
    expect(d.batches[0].buyPriceQAR).toBe(3.75);
    expect(d.tradeCalc.size).toBe(0); // not a sale
    expect(consignmentPayables(s)).toEqual([{ counterpartyName: 'Mohamed', owedQAR: 15000 }]);
    // Paying the owner settles it and posts cash out.
    s = recordReceivedConsignmentSettlement(s, { saleId: 'e1', amountQAR: 15000, settlementId: 's1' });
    expect(consignmentPayables(s)).toEqual([]);
    expect(s.cashLedger!.some(e => e.direction === 'out' && e.amount === 15000)).toBe(true);
  });

  it('is booked once however many times the report is replayed', () => {
    const input = { buyoutId: 'e1', consignmentId: 'c1', counterpartyName: 'Mohamed', qty: 100, priceQAR: 3.75 };
    const once = recordReceivedConsignmentBuyout(mk([]), input);
    const twice = recordReceivedConsignmentBuyout(once, input);
    expect(twice.batches).toHaveLength(1);
    expect(twice.trades).toHaveLength(1);
  });
});

describe('shortfall: USDT that never came back', () => {
  const sent = () => sendConsignment(mk([{ id: 'b', ts: 1, p: 3.7, q: 50000 }]), { id: 'c1', counterpartyName: 'zack', qty: 10000 }, 5);

  it('is booked as a loss at cost, counts against what is out, and lets the consignment close', () => {
    let s = recordConsignmentSale(sent(), { consignmentId: 'c1', saleId: 'e1', qty: 6000, priceQAR: 3.8, unitCostQAR: 3.7 }, 6);
    s = recordConsignmentReturn(s, { consignmentId: 'c1', returnId: 'r1', qty: 3900 }, 7);
    expect(findConsignment(s, 'c1')).toMatchObject({ open: 100, status: 'open' });
    s = recordConsignmentShortfall(s, { consignmentId: 'c1', shortId: 'x1', qty: 100, unitCostQAR: 3.7 }, 8);
    expect(findConsignment(s, 'c1')).toMatchObject({ short: 100, open: 0, status: 'closed' });
    expect(net(s, 'x1')).toBeCloseTo(-370, 6); // 100 × 3.70, no revenue
    expect(consignmentReceivables(s)).toEqual([{ counterpartyName: 'zack', owedQAR: 22500 }]); // only the sale; nothing owed for the loss
  });

  it('is not owed back as USDT any more', () => {
    const s = recordConsignmentShortfall(sent(), { consignmentId: 'c1', shortId: 'x1', qty: 300, unitCostQAR: 3.7 }, 6);
    expect(getUsdtTransferBalances(s.usdtTransfers)[0].owedToMe).toBe(9700);
  });

  it('cannot exceed what is still out, is booked once, and blocks undoing the send', () => {
    const s = sent();
    expect(() => recordConsignmentShortfall(s, { consignmentId: 'c1', shortId: 'x1', qty: 10001, unitCostQAR: 3.7 })).toThrow(ConsignmentError);
    const a = recordConsignmentShortfall(s, { consignmentId: 'c1', shortId: 'x1', qty: 50, unitCostQAR: 3.7 });
    expect(recordConsignmentShortfall(a, { consignmentId: 'c1', shortId: 'x1', qty: 50, unitCostQAR: 3.7 }).trades).toHaveLength(1);
    expect(() => undoConsignmentTransfer(a, 'c1')).toThrow(ConsignmentError);
  });
});

describe('choosing which batch to send from', () => {
  const stock = () => mk([{ id: 'old', ts: 1, p: 3.70, q: 6000 }, { id: 'new', ts: 2, p: 3.72, q: 6000 }]);
  const unit = (s: TrackerState) => { const c = computeFIFO(s.batches, s.trades, s.usdtTransfers).transferCalc.get('c1')!; return c.totalCost / c.coveredQty; };

  it('without a choice the oldest cost leaves first, as before', () => {
    expect(unit(sendConsignment(stock(), { id: 'c1', counterpartyName: 'zack', qty: 5000 }, 5))).toBeCloseTo(3.70, 9);
  });

  it('with a chosen batch, that cost leaves and the other stays', () => {
    const s = sendConsignment(stock(), { id: 'c1', counterpartyName: 'zack', qty: 5000, fromBatchId: 'new' }, 5);
    expect(unit(s)).toBeCloseTo(3.72, 9);
    const left = computeFIFO(s.batches, s.trades, s.usdtTransfers).batches;
    expect(left.find(b => b.id === 'old')!.remainingUSDT).toBe(6000);
    expect(left.find(b => b.id === 'new')!.remainingUSDT).toBe(1000);
  });

  it('takes the rest by FIFO when the chosen batch is too small', () => {
    const s = sendConsignment(stock(), { id: 'c1', counterpartyName: 'zack', qty: 8000, fromBatchId: 'new' }, 5);
    const c = computeFIFO(s.batches, s.trades, s.usdtTransfers).transferCalc.get('c1')!;
    expect(c.coveredQty).toBe(8000);
    expect(c.totalCost).toBeCloseTo(6000 * 3.72 + 2000 * 3.70, 6);
  });
});

describe('how long a consignment has been open', () => {
  it('counts whole days and lists the ones past the threshold, oldest first', () => {
    const DAY = 86_400_000;
    const now = Date.UTC(2026, 10, 20);
    let s = mk([{ id: 'b', ts: 1, p: 3.7, q: 50000 }]);
    s = sendConsignment(s, { id: 'new', counterpartyName: 'A', qty: 100 }, now - 2 * DAY);
    s = sendConsignment(s, { id: 'old', counterpartyName: 'B', qty: 100 }, now - 10 * DAY);
    s = sendConsignment(s, { id: 'older', counterpartyName: 'C', qty: 100 }, now - 30 * DAY);
    expect(consignmentAgeDays({ ts: now - 10 * DAY - 5000 }, now)).toBe(10);
    expect(overdueConsignments(s, now).map(c => c.id)).toEqual(['older', 'old']);
    expect(CONSIGNMENT_OVERDUE_DAYS).toBe(7);
  });
});
