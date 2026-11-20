// Regression: the tracker refuses to save a new order that has no saved buyer ("Pick and save a buyer before saving
// this order"). Every order a consignment books must pass that same check, or the booking is rejected in production
// while pure-logic tests, which never save, stay green.
import { describe, expect, it } from 'vitest';
import type { TrackerState } from '@/lib/tracker-helpers';
import { assertSavedOrderBuyers } from '@/features/orders/utils/order-buyer';
import {
  recordConsignmentSale, recordConsignmentShortfall, recordReceivedConsignmentSale, sendConsignment,
} from '@/features/stock/consignment';
import { withTransferFee } from '@/features/stock/transfer-fee';
import { counterpartyCustomer } from '@/features/stock/consignment-buyer';

const cashAccounts = [{ id: 'cash1', name: 'Cash', type: 'hand', currency: 'QAR', status: 'active', createdAt: 0 }];
const start = (): TrackerState => ({
  batches: [{ id: 'b', ts: 1, source: 'S', note: '', buyPriceQAR: 3.7, initialUSDT: 50000, revisions: [] }],
  trades: [], customers: [], usdtTransfers: [], cashAccounts, cashLedger: [], customerLoans: [],
}) as unknown as TrackerState;
const saves = (before: TrackerState, after: TrackerState) => () => assertSavedOrderBuyers(before, after);

describe('orders booked by a consignment pass the tracker save check', () => {
  it('a sale as the owner', () => {
    const sent = sendConsignment(start(), { id: 'c1', counterpartyName: 'zack', qty: 10000 }, 5);
    const sold = recordConsignmentSale(sent, { consignmentId: 'c1', saleId: 'e1', qty: 6000, priceQAR: 3.8, unitCostQAR: 3.7 }, 6);
    expect(saves(sent, sold)).not.toThrow();
    expect(sold.customers!.map(c => c.name)).toEqual(['zack']);
    expect(sold.trades[0].customerId).toBe(sold.customers![0].id);
  });

  it('a shortfall', () => {
    const sent = sendConsignment(start(), { id: 'c1', counterpartyName: 'zack', qty: 10000 }, 5);
    const short = recordConsignmentShortfall(sent, { consignmentId: 'c1', shortId: 'x1', qty: 100, unitCostQAR: 3.7 }, 6);
    expect(saves(sent, short)).not.toThrow();
  });

  it('a network fee', () => {
    const sent = sendConsignment(start(), { id: 'c1', counterpartyName: 'zack', qty: 10000 }, 5);
    const fee = withTransferFee(sent, { feeUSDT: 2, feeOf: 'c1', counterpartyName: 'zack', ts: 5, id: 'f1' });
    expect(saves(sent, fee)).not.toThrow();
  });

  it('a sale as the receiving merchant', () => {
    const before = start();
    const after = recordReceivedConsignmentSale(before, { saleId: 'e1', consignmentId: 'c1', counterpartyName: 'MOHAMED', qty: 6000, priceQAR: 3.8, basePriceQAR: 3.7, senderSharePct: 50 }, 6);
    expect(saves(before, after)).not.toThrow();
  });

  it('reuses the merchant\'s existing customer record instead of starting a second one', () => {
    const base = { ...start(), customers: [{ id: 'cu1', name: 'Zack', nameAr: 'زاك', phone: '', tier: 'A', dailyLimitUSDT: 0, notes: '', createdAt: 0 }] } as unknown as TrackerState;
    const sent = sendConsignment(base, { id: 'c1', counterpartyName: 'zack', qty: 100 }, 5);
    const sold = recordConsignmentSale(sent, { consignmentId: 'c1', saleId: 'e1', qty: 10, priceQAR: 3.8, unitCostQAR: 3.7 }, 6);
    expect(sold.customers).toHaveLength(1);
    expect(sold.customers![0].name).toBe('Zack'); // the identity key is never repointed
    expect(sold.trades[0].customerId).toBe('cu1');
    expect(counterpartyCustomer(sold, 'زاك').customerId).toBe('cu1'); // found by the other-language name too
  });

  it('two orders with the same merchant share one customer', () => {
    let s = sendConsignment(start(), { id: 'c1', counterpartyName: 'zack', qty: 1000 }, 5);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 100, priceQAR: 3.8, unitCostQAR: 3.7 }, 6);
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e2', qty: 100, priceQAR: 3.8, unitCostQAR: 3.7 }, 7);
    expect(s.customers).toHaveLength(1);
  });
});
