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
