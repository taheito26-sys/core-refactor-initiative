import { describe, expect, it } from 'vitest';
import { deriveOkxEscrowOrders, normalizeExchangeTransfers } from '@/features/exchanges/normalize-transfers';
import { transferKindLabel, type ExchangeTransfer } from '@/features/exchanges/types';

let seq = 0;
const tr = (over: Partial<ExchangeTransfer> & { billType?: string }): ExchangeTransfer => {
  const { billType, ...rest } = over;
  seq += 1;
  return {
    id: `t${seq}`,
    exchange: 'okx',
    kind: 'pay',
    direction: 'out',
    asset: 'USDT',
    amount: 100,
    status: 'completed',
    reference: `ref${seq}`,
    counterparty: null,
    network: null,
    transfer_time: '2026-10-30T10:00:00Z',
    linked_entity_type: null,
    linked_entity_id: null,
    linked_at: null,
    dismissed_at: null,
    created_at: '2026-10-30T10:00:00Z',
    raw: billType ? { type: billType } : null,
    ...rest,
  };
};

describe('normalizeExchangeTransfers', () => {
  it('removes OKX order bills from the transfer list: they are P2P orders', () => {
    const rows = normalizeExchangeTransfers([
      tr({ billType: '116', amount: 3000 }),
      tr({ billType: '118', direction: 'in', amount: 1696.42 }),
    ]);
    expect(rows).toEqual([]);
  });

  it('labels OKX moves between the merchant\'s own accounts as Internal, not Pay', () => {
    const rows = normalizeExchangeTransfers([
      tr({ billType: '21', direction: 'in' }),
      tr({ billType: '20' }),
      tr({ billType: '130', direction: 'in' }),
      tr({ billType: '131' }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['internal', 'internal', 'internal', 'internal']);
  });

  it('keeps on-chain as Network even when its raw type collides with a bill type', () => {
    const [out] = normalizeExchangeTransfers([tr({ kind: 'network', raw: { type: '116' } })]);
    expect(out.kind).toBe('network');
  });

  it('never reclassifies Binance rows: Binance Pay stays Pay', () => {
    const [out] = normalizeExchangeTransfers([tr({ exchange: 'binance', billType: '116' })]);
    expect(out.kind).toBe('pay');
  });

  it('names the chain on a Network label and not on the others', () => {
    expect(transferKindLabel({ kind: 'network', network: 'USDT-TRC20' })).toBe('Network · TRC20');
    expect(transferKindLabel({ kind: 'network', network: 'TRX' })).toBe('Network · TRX');
    expect(transferKindLabel({ kind: 'network', network: '' })).toBe('Network');
    expect(transferKindLabel({ kind: 'p2p', network: null })).toBe('P2P');
    expect(transferKindLabel({ kind: 'pay', network: null })).toBe('Pay');
    expect(transferKindLabel({ kind: 'internal', network: null })).toBe('Internal');
  });
});

describe('deriveOkxEscrowOrders', () => {
  it('turns an escrow lock into a sell order shaped like a Binance order, price and buyer unset', () => {
    const lock = tr({ billType: '116', amount: 3000, reference: '105346285500', transfer_time: '2026-10-30T23:55:37Z' });
    const { orders, cancelledOrderNumbers } = deriveOkxEscrowOrders([lock]);
    expect(cancelledOrderNumbers).toEqual([]);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      order_number: '105346285500', side: 'sell', asset: 'USDT', amount: 3000, price: 0, total: 0,
      status: 'completed', counterparty: null, order_time: '2026-10-30T23:55:37Z',
    });
    expect(orders[0].raw.source).toBe('okx-escrow');
  });

  it('marks a cancelled order: the escrow lock and its refund net out', () => {
    const lock = tr({ billType: '116', amount: 1696.42, reference: 'L1', transfer_time: '2026-10-30T23:02:56Z' });
    const refund = tr({ billType: '118', direction: 'in', amount: 1696.42, reference: 'R1', transfer_time: '2026-10-30T23:15:09Z' });
    const sale = tr({ billType: '116', amount: 3000, reference: 'L2', transfer_time: '2026-10-30T23:55:37Z' });
    const { orders, cancelledOrderNumbers } = deriveOkxEscrowOrders([sale, refund, lock]);
    expect(cancelledOrderNumbers).toEqual(['L1']);
    expect(orders.find((o) => o.order_number === 'L1')?.status).toBe('cancelled');
    expect(orders.find((o) => o.order_number === 'L2')?.status).toBe('completed');
  });

  it('pairs each refund with only one lock of the same size', () => {
    const a = tr({ billType: '116', amount: 500, reference: 'A', transfer_time: '2026-10-30T08:00:00Z' });
    const b = tr({ billType: '116', amount: 500, reference: 'B', transfer_time: '2026-10-30T09:00:00Z' });
    const refund = tr({ billType: '118', direction: 'in', amount: 500, reference: 'R', transfer_time: '2026-10-30T09:30:00Z' });
    expect(deriveOkxEscrowOrders([a, b, refund]).cancelledOrderNumbers).toEqual(['B']);
  });

  it('keeps a lock already imported into the tracker, with its link, and never cancels it', () => {
    const linked = tr({
      billType: '116', amount: 200, reference: 'LK', linked_at: '2026-10-30T12:00:00Z',
      linked_entity_type: 'trade', linked_entity_id: 'trade-1', transfer_time: '2026-10-30T10:00:00Z',
    });
    const refund = tr({ billType: '118', direction: 'in', amount: 200, reference: 'RF', transfer_time: '2026-10-30T11:00:00Z' });
    const { orders, cancelledOrderNumbers } = deriveOkxEscrowOrders([linked, refund]);
    expect(cancelledOrderNumbers).toEqual([]);
    expect(orders[0]).toMatchObject({ status: 'completed', linked_entity_id: 'trade-1', linked_at: '2026-10-30T12:00:00Z' });
  });

  it('ignores Binance rows and on-chain rows', () => {
    const { orders } = deriveOkxEscrowOrders([
      tr({ exchange: 'binance', billType: '116' }),
      tr({ kind: 'network', raw: { type: '116' } }),
    ]);
    expect(orders).toEqual([]);
  });
});
