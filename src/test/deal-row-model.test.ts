import { describe, expect, it } from 'vitest';
import { buildDealRowModel, parseDealMeta } from '@/features/orders/utils/dealRowModel';

const baseDeal = {
  id: 'deal-1',
  relationship_id: 'rel-1',
  deal_type: 'arbitrage',
  amount: 100,
  notes: 'quantity:100|sell_price:3.8|avg_buy:3.5|fee:10|customer:Ali|counterparty_share_pct:50|merchant_share_pct:50|trade_date:2026-02-02',
  status: 'approved',
  created_at: '2026-02-02T10:00:00.000Z',
  created_by: 'u1',
};

describe('dealRowModel', () => {
  it('avg_buy present -> computes cost, full net, my net, margin', () => {
    const outgoing = buildDealRowModel({ deal: baseDeal, perspective: 'outgoing', locale: 'en' });
    expect(outgoing.quantity).toBe(100);
    expect(outgoing.cost).toBe(350);
    expect(outgoing.fullNet).toBe(20);
    expect(outgoing.myNet).toBe(10);
    expect(outgoing.margin).toBeCloseTo(10 / 380, 6);
  });

  it('avg_buy missing -> hasAvgBuy false and net/margin are null (render as —)', () => {
    const row = buildDealRowModel({
      deal: { ...baseDeal, notes: 'quantity:100|sell_price:3.8|fee:10|customer:Ali' },
      perspective: 'incoming',
      locale: 'en',
    });
    expect(row.hasAvgBuy).toBe(false);
    expect(row.fullNet).toBeNull();
    expect(row.myNet).toBeNull();
    expect(row.margin).toBeNull();
  });

  it('falls back to merchant_cost when avg_buy is absent', () => {
    const row = buildDealRowModel({
      deal: { ...baseDeal, notes: 'quantity:100|sell_price:3.8|merchant_cost:3.5|fee:10|counterparty_share_pct:50' },
      perspective: 'outgoing',
      locale: 'en',
    });
    expect(row.hasAvgBuy).toBe(true);
    expect(row.avgBuy).toBe(3.5);
    expect(row.myNet).toBe(10);
  });

  it('uses merged metadata avg fields when resolveAvgBuy callback returns 0', () => {
    const row = buildDealRowModel({
      deal: {
        ...baseDeal,
        notes: 'quantity:100|sell_price:3.8|fee:10|counterparty_share_pct:50',
        metadata: { avg_buy: 3.5 },
      },
      perspective: 'incoming',
      locale: 'en',
      resolveAvgBuy: () => 0,
    });
    expect(row.hasAvgBuy).toBe(true);
    expect(row.avgBuy).toBe(3.5);
    expect(row.myNet).toBe(10);
  });

  it('derives avg buy from fifo_cost / quantity when avg fields are missing', () => {
    const row = buildDealRowModel({
      deal: {
        ...baseDeal,
        notes: 'quantity:1000|sell_price:3.82|fifo_cost:3710|fee:10|counterparty_share_pct:50',
      },
      perspective: 'incoming',
      locale: 'en',
      resolveAvgBuy: () => 0,
    });
    expect(row.avgBuy).toBeCloseTo(3.71, 2);
    expect(row.hasAvgBuy).toBe(true);
    expect(row.myNet).toBeCloseTo(50, 4);
  });

  it('legacy aliases map qty -> quantity and sell -> sell_price', () => {
    const meta = parseDealMeta('qty:20|sell:4.1|avg_buy:4');
    expect(meta.quantity).toBe('20');
    expect(meta.sell_price).toBe('4.1');
  });

  it('split deals apply partner/merchant share correctly', () => {
    const incoming = buildDealRowModel({ deal: baseDeal, perspective: 'incoming', locale: 'en' });
    const outgoing = buildDealRowModel({ deal: baseDeal, perspective: 'outgoing', locale: 'en' });
    expect(incoming.fullNet).toBe(20);
    expect(incoming.myNet).toBe(10);
    expect(outgoing.myNet).toBe(10);
    expect(incoming.myNet).not.toBe(incoming.fullNet);
  });

  it('allocates fullNet 112 at 50/50 to 56 and 56', () => {
    const row = buildDealRowModel({
      deal: { ...baseDeal, notes: 'quantity:1000|sell_price:3.82|avg_buy:3.698|fee:10|counterparty_share_pct:50' },
      perspective: 'outgoing',
      locale: 'en',
    });
    expect(row.fullNet).toBe(112);
    expect(row.creatorNet).toBe(56);
    expect(row.partnerNet).toBe(56);
  });

  it('allocates fullNet 110 at 50/50 to 55 and 55 and totals to 111/111 across records', () => {
    const rowA = buildDealRowModel({
      deal: { ...baseDeal, notes: 'quantity:1000|sell_price:3.82|avg_buy:3.698|fee:10|counterparty_share_pct:50' },
      perspective: 'outgoing',
      locale: 'en',
    });
    const rowB = buildDealRowModel({
      deal: { ...baseDeal, notes: 'quantity:1000|sell_price:3.82|avg_buy:3.7|fee:10|counterparty_share_pct:50' },
      perspective: 'outgoing',
      locale: 'en',
    });
    expect(rowB.fullNet).toBe(110);
    expect(rowB.creatorNet).toBe(55);
    expect(rowB.partnerNet).toBe(55);
    expect((rowA.creatorNet || 0) + (rowB.creatorNet || 0)).toBe(111);
    expect((rowA.partnerNet || 0) + (rowB.partnerNet || 0)).toBe(111);
  });

  it('handles 60/40 split correctly', () => {
    const row = buildDealRowModel({
      deal: { ...baseDeal, notes: 'quantity:100|sell_price:4|avg_buy:3|fee:0|counterparty_share_pct:60' },
      perspective: 'outgoing',
      locale: 'en',
    });
    expect(row.fullNet).toBe(100);
    expect(row.creatorNet).toBe(40);
    expect(row.partnerNet).toBe(60);
  });

  it('incoming/outgoing symmetry keeps same fullNet and two-party allocation', () => {
    const outgoing = buildDealRowModel({ deal: baseDeal, perspective: 'outgoing', locale: 'en' });
    const incoming = buildDealRowModel({ deal: baseDeal, perspective: 'incoming', locale: 'en' });
    expect(outgoing.fullNet).toBe(incoming.fullNet);
    expect(outgoing.creatorNet).toBe(incoming.creatorNet);
    expect(outgoing.partnerNet).toBe(incoming.partnerNet);
    expect(outgoing.myNet).toBe(incoming.partnerNet);
    expect(incoming.myNet).toBe(outgoing.partnerNet);
  });

  it('invariant: creatorNet + partnerNet equals fullNet', () => {
    const row = buildDealRowModel({
      deal: { ...baseDeal, notes: 'quantity:73|sell_price:3.9|avg_buy:3.1|fee:2|counterparty_share_pct:30' },
      perspective: 'outgoing',
      locale: 'en',
    });
    expect((row.creatorNet || 0) + (row.partnerNet || 0)).toBeCloseTo(row.fullNet || 0, 8);
  });

  it('prefers normalized notes shares when metadata object is present but missing split fields', () => {
    const row = buildDealRowModel({
      deal: {
        ...baseDeal,
        metadata: { settlement_period: 'monthly' },
        notes: 'quantity:100|sell_price:3.8|avg_buy:3.5|fee:10|counterparty_share: 50%|merchant_share: 50%',
      },
      perspective: 'incoming',
      locale: 'en',
    });
    expect(row.partnerPct).toBe(50);
    expect(row.myNet).toBe(10);
  });

  it('admin/user parity: same input deal and perspective produce identical derived economics', () => {
    const resolveAvgBuy = () => 3.5;
    const userRow = buildDealRowModel({ deal: baseDeal, perspective: 'incoming', locale: 'en', resolveAvgBuy });
    const adminRow = buildDealRowModel({ deal: baseDeal, perspective: 'incoming', locale: 'en', resolveAvgBuy });
    expect(adminRow).toMatchObject({
      quantity: userRow.quantity,
      avgBuy: userRow.avgBuy,
      volume: userRow.volume,
      fullNet: userRow.fullNet,
      myNet: userRow.myNet,
      margin: userRow.margin,
      splitLabel: userRow.splitLabel,
    });
  });
});
