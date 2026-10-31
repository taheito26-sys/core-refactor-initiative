import { describe, expect, it } from 'vitest';
import { normalizeExchangeTransfers } from '@/features/exchanges/normalize-transfers';
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
  it('labels an OKX "Place an order" bill as P2P, not Pay', () => {
    const [out] = normalizeExchangeTransfers([tr({ billType: '116', amount: 3000 })]);
    expect(out.kind).toBe('p2p');
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

  it('drops a cancelled order: the escrow lock and its refund net out', () => {
    const lock = tr({ billType: '116', amount: 1696.42, transfer_time: '2026-10-30T23:02:56Z' });
    const refund = tr({ billType: '118', direction: 'in', amount: 1696.42, transfer_time: '2026-10-30T23:15:09Z' });
    const sale = tr({ billType: '116', amount: 3000, transfer_time: '2026-10-30T23:55:37Z' });
    const rows = normalizeExchangeTransfers([sale, refund, lock]);
    expect(rows.map((r) => r.id)).toEqual([sale.id]);
    expect(rows[0].kind).toBe('p2p');
  });

  it('pairs each refund with only one lock of the same size', () => {
    const a = tr({ billType: '116', amount: 500, transfer_time: '2026-10-30T08:00:00Z' });
    const b = tr({ billType: '116', amount: 500, transfer_time: '2026-10-30T09:00:00Z' });
    const refund = tr({ billType: '118', direction: 'in', amount: 500, transfer_time: '2026-10-30T09:30:00Z' });
    const rows = normalizeExchangeTransfers([a, b, refund]);
    expect(rows.map((r) => r.id)).toEqual([a.id]);
  });

  it('keeps a lock already linked to the tracker, and an unmatched refund', () => {
    const linked = tr({ billType: '116', amount: 200, linked_at: '2026-10-30T12:00:00Z', transfer_time: '2026-10-30T10:00:00Z' });
    const refund = tr({ billType: '118', direction: 'in', amount: 200, transfer_time: '2026-10-30T11:00:00Z' });
    expect(normalizeExchangeTransfers([linked, refund]).map((r) => r.id).sort()).toEqual([linked.id, refund.id].sort());
  });
});
