import { describe, expect, it } from 'vitest';
import { supplierProfitByName, supplierProfitReport } from '@/features/suppliers/supplier-profit';
import { computeFIFO, kpiFor, type Batch, type TrackerState, type Trade } from '@/lib/tracker-helpers';

const batch = (id: string, ts: number, source: string, usdt: number, price: number) =>
  ({ id, ts, source, note: '', buyPriceQAR: price, initialUSDT: usdt, revisions: [] }) as Batch;
const trade = (over: Partial<Trade>) =>
  ({ id: 't', ts: 1000, inputMode: 'USDT', amountUSDT: 0, sellPriceQAR: 0, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: '', ...over }) as Trade;

describe('supplierProfitByName', () => {
  const batches = [batch('b1', 1, 'Ali', 1000, 3.6), batch('b2', 2, 'Omar', 1000, 3.7)];

  it('splits an order that spans two suppliers by the USDT drawn from each', () => {
    // 1,500 USDT sold at 3.8 = 5,700 revenue, 10 fee. 1,000 from Ali (cost 3,600), 500 from Omar (cost 1,850).
    const map = supplierProfitByName({ batches, trades: [trade({ id: 't1', amountUSDT: 1500, sellPriceQAR: 3.8, feeQAR: 9 })], usdtTransfers: [] });
    const ali = map.get('ali')!;
    const omar = map.get('omar')!;
    expect(ali.soldUSDT).toBe(1000);
    expect(ali.revenueQAR).toBeCloseTo(3800);
    expect(ali.costQAR).toBeCloseTo(3600);
    expect(ali.feeQAR).toBeCloseTo(6);
    expect(ali.netProfitQAR).toBeCloseTo(194);
    expect(omar.netProfitQAR).toBeCloseTo(1900 - 1850 - 3);
    expect(ali.netProfitQAR + omar.netProfitQAR).toBeCloseTo(5700 - 5450 - 9);
    expect(ali.tradeCount).toBe(1);
  });

  it('ignores voided and uncovered orders, which carry no profit in the tracker', () => {
    const map = supplierProfitByName({
      batches,
      trades: [
        trade({ id: 'v', amountUSDT: 100, sellPriceQAR: 4, voided: true }),
        trade({ id: 'big', ts: 2000, amountUSDT: 5000, sellPriceQAR: 4 }),
      ],
      usdtTransfers: [],
    });
    expect(map.size).toBe(0);
  });

  it('matches supplier names regardless of case and spacing', () => {
    const map = supplierProfitByName({ batches: [batch('b1', 1, ' ALI ', 100, 3)], trades: [trade({ id: 't', amountUSDT: 50, sellPriceQAR: 4 })], usdtTransfers: [] });
    expect(map.get('ali')?.netProfitQAR).toBeCloseTo(50);
  });

  it('counts only the merchant\'s own share on orders linked to a partner, like the dashboard does', () => {
    const linked = trade({ id: 'l', amountUSDT: 1000, sellPriceQAR: 3.8, linkedDealId: 'deal-1', merchantPct: 60 });
    const map = supplierProfitByName({ batches, trades: [linked], usdtTransfers: [] });
    const ali = map.get('ali')!;
    // full net 200, merchant keeps 60%
    expect(ali.netProfitQAR).toBeCloseTo(120);
    expect(ali.partnerShareQAR).toBeCloseTo(80);
    expect(ali.revenueQAR - ali.costQAR - ali.feeQAR - ali.partnerShareQAR).toBeCloseTo(ali.netProfitQAR);
  });

  it('adds up to the tracker\'s own total net profit', () => {
    const trades = [
      trade({ id: 'a', ts: 10, amountUSDT: 700, sellPriceQAR: 3.9, feeQAR: 5 }),
      trade({ id: 'b', ts: 20, amountUSDT: 900, sellPriceQAR: 3.85, feeQAR: 7, linkedRelId: 'rel', merchantPct: 70 }),
      trade({ id: 'c', ts: 30, amountUSDT: 300, sellPriceQAR: 3.95 }),
    ];
    const input = { batches, trades, usdtTransfers: [] };
    const report = supplierProfitReport(input);
    const sum = [...report.bySupplier.values()].reduce((s, r) => s + r.netProfitQAR, 0) + report.unattributedNetQAR;
    const derived = computeFIFO(batches, trades, []);
    const total = kpiFor({ ...input } as unknown as TrackerState, derived, 'all').net;
    expect(sum).toBeCloseTo(total, 6);
    expect(report.unattributedNetQAR).toBeCloseTo(0);
  });
});
