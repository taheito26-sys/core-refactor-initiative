import { describe, expect, it } from 'vitest';
import { agoLabel, extractMerchantId, groupSnapshots, onlineState, ordersPerDay, type MerchantSnapshot } from '@/features/p2p/merchant-watch/merchant-watch';

const snap = (at: Date, total: number, over: Partial<MerchantSnapshot> = {}): MerchantSnapshot => ({
  user_no: 's1', ts: at.toISOString(), online: true, active_seconds: 10, last_active_at: at.toISOString(),
  total_orders: total, sell_orders: Math.floor(total / 10), buy_orders: total, month_orders: 100, month_sell_orders: 10, finish_rate: 0.99, ...over,
});
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);

describe('ordersPerDay', () => {
  const now = at(9, 18).getTime();
  const snaps = [
    snap(at(7, 10), 1000), snap(at(7, 22), 1010),
    snap(at(8, 9), 1012), snap(at(8, 23), 1030),
    snap(at(9, 8), 1033), snap(at(9, 17), 1045),
  ];

  it('is the running total at the end of a day minus the total at its start', () => {
    const days = ordersPerDay(snaps, { days: 3, now });
    expect(days.map(d => d.orders)).toEqual([10, 20, 15]);
    expect(days[2].day).toBe('2026-10-09');
  });

  it('leaves days before any reading empty instead of zero', () => {
    const days = ordersPerDay(snaps, { days: 5, now });
    expect(days.slice(0, 2).map(d => d.orders)).toEqual([null, null]);
  });

  it('counts a day with no readings as zero once the merchant is tracked', () => {
    const gap = [snap(at(7, 10), 1000), snap(at(7, 22), 1010), snap(at(9, 12), 1010)];
    expect(ordersPerDay(gap, { days: 3, now }).map(d => d.orders)).toEqual([10, 0, 0]);
  });

  it('can count sells only', () => {
    const days = ordersPerDay(snaps, { days: 1, field: 'sell_orders', now });
    expect(days[0].orders).toBe(104 - 103);
  });
});

describe('onlineState', () => {
  it('is online only while the latest reading is recent', () => {
    const now = at(9, 12).getTime();
    expect(onlineState(snap(at(9, 11, 58), 1), now).online).toBe(true);
    const old = onlineState(snap(at(9, 11, 0), 1), now);
    expect(old.online).toBe(false);
    expect(old.stale).toBe(true);
  });
  it('reports when the merchant was last active', () => {
    const now = at(9, 12).getTime();
    const s = snap(at(9, 11, 59), 1, { online: false, active_seconds: 7200, last_active_at: at(9, 10).toISOString() });
    expect(onlineState(s, now).lastSeenSeconds).toBe(7200);
  });
});

describe('helpers', () => {
  it('labels how long ago', () => {
    expect(agoLabel(30, 'en')).toBe('just now');
    expect(agoLabel(600, 'en')).toBe('10 min ago');
    expect(agoLabel(7200, 'en')).toBe('2 h ago');
    expect(agoLabel(null, 'en')).toBe('—');
  });
  it('finds a merchant id in a pasted link', () => {
    expect(extractMerchantId('https://p2p.binance.com/en/advertiserDetail?advertiserNo=sfc0b49ebbae03c7c98e22bd05e7492cf')).toBe('sfc0b49ebbae03c7c98e22bd05e7492cf');
    expect(extractMerchantId('_abosefoo_')).toBeNull();
  });
  it('groups readings by merchant, oldest first', () => {
    const g = groupSnapshots([snap(at(9, 12), 2), snap(at(9, 10), 1), { ...snap(at(9, 11), 5), user_no: 's2' }]);
    expect(g.get('s1')?.map(s => s.total_orders)).toEqual([1, 2]);
    expect(g.get('s2')).toHaveLength(1);
  });
});
