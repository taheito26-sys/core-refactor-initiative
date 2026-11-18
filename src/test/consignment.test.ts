import { describe, expect, it } from 'vitest';

import { computeFIFO, totalStock, type Batch, type TrackerState } from '@/lib/tracker-helpers';
import { getUsdtTransferBalances } from '@/lib/usdt-transfers';
import {
  ConsignmentError,
  consignmentPayables,
  consignmentReceivables,
  findConsignment,
  recordConsignmentPurchase,
  recordConsignmentRemittance,
  recordConsignmentReturn,
  recordConsignmentSale,
  recordConsignmentSettlement,
  recordReceivedConsignmentPurchase,
  recordReceivedConsignmentSale,
  recordReceivedConsignmentSettlement,
  sendConsignment,
  splitConsignmentSale,
  undoConsignmentSale,
  undoConsignmentTransfer,
} from '@/features/stock/consignment';

function batch(id: string, ts: number, price: number, qty: number): Batch {
  return { id, ts, source: '', note: '', buyPriceQAR: price, initialUSDT: qty, revisions: [] };
}

function base(): TrackerState {
  return { batches: [batch('b1', 1, 3.7, 50000)], trades: [], usdtTransfers: [] } as unknown as TrackerState;
}

function withCash(): TrackerState {
  return {
    ...base(),
    cashAccounts: [{
      id: 'cash1',
      name: 'QAR cash',
      type: 'hand',
      currency: 'QAR',
      status: 'active',
      createdAt: 1,
    }],
    cashLedger: [],
    cashHistory: [],
    cashQAR: 0,
  } as unknown as TrackerState;
}

const unitCost = (s: TrackerState, id: string) => {
  const c = computeFIFO(s.batches, s.trades, s.usdtTransfers).transferCalc.get(id)!;
  return c.totalCost / c.coveredQty;
};

const cashIn = (s: TrackerState) => s.cashLedger.filter(e => e.direction === 'in').reduce((sum, e) => sum + e.amount, 0);
const cashOut = (s: TrackerState) => s.cashLedger.filter(e => e.direction === 'out').reduce((sum, e) => sum + e.amount, 0);

describe('consignment: sent USDT is not a sale', () => {
  it('takes the USDT out of stock at cost with no profit, and shows it as with the merchant', () => {
    const s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 10000 }, 10);
    const d = computeFIFO(s.batches, s.trades, s.usdtTransfers);
    expect(totalStock(d)).toBeCloseTo(40000, 6);
    expect(d.tradeCalc.size).toBe(0);
    expect(unitCost(s, 'c1')).toBeCloseTo(3.7, 9);
    expect(findConsignment(s, 'c1')).toMatchObject({ sent: 10000, sold: 0, returned: 0, open: 10000, status: 'open' });
    expect(getUsdtTransferBalances(s.usdtTransfers)[0].owedToMe).toBe(10000);
  });
});

describe('scenario 1: the merchant sold it', () => {
  it('splits the profit 50/50 and books an order for my share only', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 10000, profitSharePct: 50 }, 10);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 10000, priceQAR: 3.8, unitCostQAR: unitCost(s, 'c1') }, 20);
    const d = computeFIFO(s.batches, s.trades, s.usdtTransfers);
    const sale = d.tradeCalc.get('e1')!;
    expect(sale.netQAR).toBeCloseTo(500, 6); // 10000 × 0.10 profit, half mine
    expect(totalStock(d)).toBeCloseTo(40000, 6); // not consumed twice
    expect(findConsignment(s, 'c1')).toMatchObject({ sold: 10000, open: 0, status: 'closed' });
    expect(getUsdtTransferBalances(s.usdtTransfers)[0].owedToMe).toBe(0);
    // The merchant took 38,000 for the USDT, keeps 500 of profit, and owes me 37,500.
    expect(consignmentReceivables(s)).toEqual([{ counterpartyName: 'M2', owedQAR: 37500 }]);
  });

  it('shares a below-cost sale by the agreed ratio instead of refusing it', () => {
    const split = splitConsignmentSale(100, 3.69, 3.7, 50);
    expect(split.profitQAR).toBeCloseTo(-1, 6);
    expect(split.lossQAR).toBeCloseTo(1, 6);
    expect(split.myShareQAR).toBeCloseTo(-0.5, 6);
    expect(split.partnerShareQAR).toBeCloseTo(-0.5, 6);
    expect(split.remitQAR).toBeCloseTo(369.5, 6);
  });

  it('books an owner-side loss and carries the receiver loss share in the receivable', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 10000 }, 10);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 10000, priceQAR: 3.6, unitCostQAR: 3.7 }, 20);
    const sale = computeFIFO(s.batches, s.trades, s.usdtTransfers).tradeCalc.get('e1')!;
    expect(sale.netQAR).toBeCloseTo(-500, 6);
    // Owner cost 37,000; proceeds 36,000; receiver owes an extra 500 loss share.
    expect(consignmentReceivables(s)).toEqual([{ counterpartyName: 'M2', owedQAR: 36500 }]);
  });

  it('refuses to sell more than is still open and tracks cash remitted', () => {
    let s = sendConsignment(withCash(), { id: 'c1', counterpartyName: 'M2', qty: 1000 }, 10);
    const cost = unitCost(s, 'c1');
    expect(() => recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 1001, priceQAR: 3.8, unitCostQAR: cost })).toThrow(ConsignmentError);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 1000, priceQAR: 3.8, unitCostQAR: cost });
    s = recordConsignmentRemittance(s, 'e1', 3750);
    expect(consignmentReceivables(s)).toEqual([]);
  });

  it('does not reduce a partial receivable twice when a settlement is replayed', () => {
    let s = withCash();
    s = sendConsignment(s, { id: 'c1', counterpartyName: 'M2', qty: 10000 }, 10);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 10000, priceQAR: 3.8, unitCostQAR: 3.7 }, 20);
    s = recordConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 'settle-partial' });
    expect(consignmentReceivables(s)).toEqual([{ counterpartyName: 'M2', owedQAR: 37400 }]);
    s = recordConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 'settle-partial' });
    expect(consignmentReceivables(s)).toEqual([{ counterpartyName: 'M2', owedQAR: 37400 }]);
    expect(cashIn(s)).toBeCloseTo(100, 6);
  });

  it('books the same report only once', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 1000 }, 10);
    const input = { consignmentId: 'c1', saleId: 'e1', qty: 400, priceQAR: 3.8, unitCostQAR: 3.7 };
    s = recordConsignmentSale(s, input);
    s = recordConsignmentSale(s, input);
    expect(s.trades).toHaveLength(1);
    expect(findConsignment(s, 'c1')!.sold).toBe(400);
  });

  it('undoing a sale reopens the quantity', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 1000 }, 10);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 400, priceQAR: 3.8, unitCostQAR: 3.7 });
    s = undoConsignmentSale(s, 'e1');
    expect(findConsignment(s, 'c1')!.open).toBe(1000);
    expect(s.trades[0].voided).toBe(true);
  });
});

describe('scenario 2: not sold, returned', () => {
  it('restores stock at the original cost with no profit, partial returns allowed', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 10000 }, 10);
    s = recordConsignmentReturn(s, { consignmentId: 'c1', returnId: 'r1', qty: 4000 }, 20);
    expect(findConsignment(s, 'c1')).toMatchObject({ returned: 4000, open: 6000, status: 'open' });
    s = recordConsignmentReturn(s, { consignmentId: 'c1', returnId: 'r2', qty: 6000 }, 30);
    expect(findConsignment(s, 'c1')!.status).toBe('closed');
    const d = computeFIFO(s.batches, s.trades, s.usdtTransfers);
    expect(totalStock(d)).toBeCloseTo(50000, 6);
    const returned = d.batches.filter(b => b.isTransfer);
    expect(returned.every(b => Math.abs(b.buyPriceQAR - 3.7) < 1e-9)).toBe(true);
    expect(d.tradeCalc.size).toBe(0);
  });

  it('cannot return more than is open', () => {
    const s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 1000 }, 10);
    expect(() => recordConsignmentReturn(s, { consignmentId: 'c1', returnId: 'r1', qty: 1001 })).toThrow(ConsignmentError);
  });
});

describe('scenario 3: sold, then new USDT bought at another price sent back', () => {
  it('books the sale at old cost and the new USDT as a fresh batch at its own price', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 10000 }, 10);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 10000, priceQAR: 3.8, unitCostQAR: unitCost(s, 'c1') }, 20);
    s = recordConsignmentPurchase(s, { batchId: 'p1', counterpartyName: 'M2', qty: 10000, priceQAR: 3.74 }, 30);
    const d = computeFIFO(s.batches, s.trades, s.usdtTransfers);
    expect(totalStock(d)).toBeCloseTo(50000, 6);
    expect(d.batches.find(b => b.id === 'p1')!.buyPriceQAR).toBe(3.74);
    expect(d.tradeCalc.get('e1')!.netQAR).toBeCloseTo(500, 6);
    // The consignment is already settled, so a "return" cannot be matched to it.
    expect(() => recordConsignmentReturn(s, { consignmentId: 'c1', returnId: 'r1', qty: 10000 })).toThrow(ConsignmentError);
  });

  it('nets a replacement purchase funded from the sale proceeds', () => {
    let s = withCash();
    s = sendConsignment(s, { id: 'c1', counterpartyName: 'M2', qty: 10000 }, 10);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 10000, priceQAR: 3.8, unitCostQAR: unitCost(s, 'c1') }, 20);
    s = recordConsignmentPurchase(s, { batchId: 'p1', counterpartyName: 'M2', qty: 10000, priceQAR: 3.74, fundedFromSaleId: 'e1' }, 30);
    expect(consignmentReceivables(s)).toEqual([{ counterpartyName: 'M2', owedQAR: 100 }]);
    const d = computeFIFO(s.batches, s.trades, s.usdtTransfers);
    expect(totalStock(d)).toBeCloseTo(50000, 6);
    expect(d.batches.find(b => b.id === 'p1')!.buyPriceQAR).toBe(3.74);
    expect(s.cashLedger).toHaveLength(0); // owner has not received cash yet
    s = recordConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 'settle1' },);
    expect(consignmentReceivables(s)).toEqual([]);
    expect(cashIn(s)).toBeCloseTo(100, 6);
    expect(s.cashLedger).toHaveLength(1);
    // Replaying the same settlement does not deposit twice.
    s = recordConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 'settle1' });
    expect(s.cashLedger).toHaveLength(1);
  });

  it('mix: 10k sent, 6k sold, 4k returned at the original cost', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 10000 }, 10);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 6000, priceQAR: 3.8, unitCostQAR: 3.7 }, 20);
    s = recordConsignmentReturn(s, { consignmentId: 'c1', returnId: 'r1', qty: 4000 }, 30);
    expect(findConsignment(s, 'c1')).toMatchObject({ sold: 6000, returned: 4000, open: 0, status: 'closed' });
    const d = computeFIFO(s.batches, s.trades, s.usdtTransfers);
    expect(totalStock(d)).toBeCloseTo(44000, 6);
    expect(getUsdtTransferBalances(s.usdtTransfers)[0].owedToMe).toBe(0);
  });
});

describe('receiver side: cash held, replacement purchase and settlement', () => {
  it('books sale proceeds, nets a replacement purchase and pays the owner', () => {
    let s = withCash();
    s = recordReceivedConsignmentSale(s, {
      saleId: 'e1',
      consignmentId: 'c1',
      counterpartyName: 'M1',
      qty: 10000,
      priceQAR: 3.8,
      basePriceQAR: 3.7,
      senderSharePct: 50,
    }, 20);
    expect(cashIn(s)).toBeCloseTo(38000, 6);
    expect(consignmentPayables(s)).toEqual([{ counterpartyName: 'M1', owedQAR: 37500 }]);
    expect(computeFIFO(s.batches, s.trades, s.usdtTransfers).tradeCalc.get('e1')!.netQAR).toBeCloseTo(500, 6);

    s = recordReceivedConsignmentPurchase(s, {
      purchaseId: 'p1',
      saleId: 'e1',
      counterpartyName: 'M1',
      qty: 10000,
      priceQAR: 3.74,
    }, 30);
    expect(cashOut(s)).toBeCloseTo(37400, 6);
    expect(consignmentPayables(s)).toEqual([{ counterpartyName: 'M1', owedQAR: 100 }]);
    // Replaying the same purchase event must not subtract again.
    s = recordReceivedConsignmentPurchase(s, {
      purchaseId: 'p1',
      saleId: 'e1',
      counterpartyName: 'M1',
      qty: 10000,
      priceQAR: 3.74,
    }, 30);
    expect(cashOut(s)).toBeCloseTo(37400, 6);

    s = recordReceivedConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 's1' },);
    expect(consignmentPayables(s)).toEqual([]);
    expect(cashOut(s)).toBeCloseTo(37500, 6);
    expect(cashIn(s) - cashOut(s)).toBeCloseTo(500, 6);
    // Replaying the settlement must not pay twice.
    s = recordReceivedConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 's1' });
    expect(cashOut(s)).toBeCloseTo(37500, 6);
  });

  it('shares a loss and tops up the owner when proceeds are below the agreed cost', () => {
    let s = withCash();
    s = recordReceivedConsignmentSale(s, {
      saleId: 'e1',
      consignmentId: 'c1',
      counterpartyName: 'M1',
      qty: 10000,
      priceQAR: 3.6,
      basePriceQAR: 3.7,
      senderSharePct: 50,
    }, 20);
    expect(cashIn(s)).toBeCloseTo(36000, 6);
    expect(consignmentPayables(s)).toEqual([{ counterpartyName: 'M1', owedQAR: 36500 }]);
    expect(computeFIFO(s.batches, s.trades, s.usdtTransfers).tradeCalc.get('e1')!.netQAR).toBeCloseTo(-500, 6);

    s = recordReceivedConsignmentSettlement(s, { saleId: 'e1', amountQAR: 36500, settlementId: 's1' });
    expect(consignmentPayables(s)).toEqual([]);
    expect(cashOut(s)).toBeCloseTo(36500, 6);
    // The receiver puts in 500 of its own cash to cover its half of the loss.
    expect(cashIn(s) - cashOut(s)).toBeCloseTo(-500, 6);
  });

  it('does not reduce a partial payable twice when a settlement is replayed', () => {
    let s = withCash();
    s = recordReceivedConsignmentSale(s, {
      saleId: 'e1', consignmentId: 'c1', counterpartyName: 'M1',
      qty: 10000, priceQAR: 3.8, basePriceQAR: 3.7, senderSharePct: 50,
    }, 20);
    s = recordReceivedConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 'recv-partial' });
    expect(consignmentPayables(s)).toEqual([{ counterpartyName: 'M1', owedQAR: 37400 }]);
    s = recordReceivedConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 'recv-partial' });
    expect(consignmentPayables(s)).toEqual([{ counterpartyName: 'M1', owedQAR: 37400 }]);
    expect(cashOut(s)).toBeCloseTo(100, 6);
  });

  it('debits replacement purchases and settlements from the original proceeds account', () => {
    const custody = { id: 'cust', name: 'Custody', type: 'merchant_custody', currency: 'QAR', status: 'active', createdAt: 1 };
    const hand = { id: 'hand', name: 'Hand', type: 'hand', currency: 'QAR', status: 'active', createdAt: 1 };
    let s = { ...withCash(), cashAccounts: [custody, hand] } as unknown as TrackerState;
    s = recordReceivedConsignmentSale(s, {
      saleId: 'e1', consignmentId: 'c1', counterpartyName: 'M1',
      qty: 10000, priceQAR: 3.8, basePriceQAR: 3.7, senderSharePct: 50, cashAccountId: 'cust',
    }, 20);
    expect(s.cashLedger.find(e => e.id === 'cons-sale-cash-e1')!.accountId).toBe('cust');
    s = recordReceivedConsignmentPurchase(s, {
      purchaseId: 'p1', saleId: 'e1', counterpartyName: 'M1', qty: 10000, priceQAR: 3.74,
    }, 30);
    expect(s.cashLedger.find(e => e.id === 'cons-purchase-cash-p1')!.accountId).toBe('cust');
    s = recordReceivedConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 's1' });
    expect(s.cashLedger.find(e => e.id === 'cons-recv-settle-s1')!.accountId).toBe('cust');
  });

  it('falls back to an active account if the proceeds account was deactivated', () => {
    const custody = { id: 'cust', name: 'Custody', type: 'merchant_custody', currency: 'QAR', status: 'active', createdAt: 1 };
    const hand = { id: 'hand', name: 'Hand', type: 'hand', currency: 'QAR', status: 'active', createdAt: 1 };
    let s = { ...withCash(), cashAccounts: [custody, hand] } as unknown as TrackerState;
    s = recordReceivedConsignmentSale(s, {
      saleId: 'e1', consignmentId: 'c1', counterpartyName: 'M1',
      qty: 10000, priceQAR: 3.8, basePriceQAR: 3.7, senderSharePct: 50, cashAccountId: 'cust',
    }, 20);
    s = { ...s, cashAccounts: s.cashAccounts.map(a => a.id === 'cust' ? { ...a, status: 'inactive' } : a) } as unknown as TrackerState;
    s = recordReceivedConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 'settle-fallback' });
    expect(s.cashLedger.find(e => e.id === 'cons-recv-settle-settle-fallback')!.accountId).toBe('hand');
  });

  it('rejects a settlement before changing debt when no active cash account exists', () => {
    let s = withCash();
    s = recordReceivedConsignmentSale(s, {
      saleId: 'e1', consignmentId: 'c1', counterpartyName: 'M1',
      qty: 10000, priceQAR: 3.8, basePriceQAR: 3.7, senderSharePct: 50,
    }, 20);
    const before = consignmentPayables(s);
    s = { ...s, cashAccounts: s.cashAccounts.map(a => ({ ...a, status: 'inactive' })) } as unknown as TrackerState;
    expect(() => recordReceivedConsignmentSettlement(s, { saleId: 'e1', amountQAR: 100, settlementId: 'no-account' })).toThrow(ConsignmentError);
    expect(consignmentPayables(s)).toEqual(before);
    expect(s.cashLedger.some(e => e.id === 'cons-recv-settle-no-account')).toBe(false);
  });
});

describe('undo', () => {
  it('cannot void a consignment with sales or returns, but can void an untouched one', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 1000 }, 10);
    const sold = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 100, priceQAR: 3.8, unitCostQAR: 3.7 });
    expect(() => undoConsignmentTransfer(sold, 'c1')).toThrow(ConsignmentError);
    s = undoConsignmentTransfer(s, 'c1');
    expect(totalStock(computeFIFO(s.batches, s.trades, s.usdtTransfers))).toBeCloseTo(50000, 6);
  });

  it('does not void a sale after a settlement or purchase offset', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'M2', qty: 1000 }, 10);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 1000, priceQAR: 3.8, unitCostQAR: 3.7 });
    s = recordConsignmentPurchase(s, { batchId: 'p1', counterpartyName: 'M2', qty: 1000, priceQAR: 3.74, fundedFromSaleId: 'e1' });
    expect(() => undoConsignmentSale(s, 'e1')).toThrow(ConsignmentError);
  });
});
