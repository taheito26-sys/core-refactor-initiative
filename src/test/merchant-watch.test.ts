import { describe, expect, it } from 'vitest';
import { agoLabel, dailyRegister, eventsByDay, qatarClock, extractMerchantId, groupSnapshots, onlineState, ordersPerDay, qatarDayKey, type DailyRow, type MerchantSnapshot, type OrderEvent } from '@/features/p2p/merchant-watch/merchant-watch';

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

describe('dailyRegister', () => {
  const row = (day: string, baseline: number, last: number, bSell = 0, lSell = 0): DailyRow => ({
    user_no: 's1', day, baseline_total: baseline, last_total: last, baseline_sell: bSell, last_sell: lSell, readings: 5, online_readings: 2,
  });
  const now = Date.UTC(2026, 9, 10, 12, 0);

  it('lists orders per day since following, newest first', () => {
    const reg = dailyRegister([row('2026-10-08', 100, 110, 0, 8), row('2026-10-09', 110, 125, 8, 10), row('2026-10-10', 125, 128, 10, 10)], { now });
    expect(reg.map(d => [d.day, d.orders, d.sold])).toEqual([['2026-10-10', 3, 0], ['2026-10-09', 15, 2], ['2026-10-08', 10, 8]]);
    expect(reg[0].endTotal).toBe(128);
  });

  it('counts a tracked day with no reading as zero and stops before tracking began', () => {
    const reg = dailyRegister([row('2026-10-08', 100, 110), row('2026-10-10', 110, 112)], { now });
    expect(reg.map(d => d.orders)).toEqual([2, 0, 10]);
  });

  it('starts at the day the merchant was followed', () => {
    const reg = dailyRegister([row('2026-10-08', 100, 110), row('2026-10-09', 110, 120), row('2026-10-10', 120, 121)], { now, since: Date.UTC(2026, 9, 9, 8, 0) });
    expect(reg.map(d => d.day)).toEqual(['2026-10-10', '2026-10-09']);
  });

  it('uses the Qatar day, three hours ahead of UTC', () => {
    expect(qatarDayKey(Date.UTC(2026, 9, 9, 21, 30))).toBe('2026-10-10');
    expect(qatarDayKey(Date.UTC(2026, 9, 9, 20, 30))).toBe('2026-10-09');
  });
});

describe('order events', () => {
  const ev = (id: number, detected: string, prev: string, orders = 1): OrderEvent => ({ id, user_no: 's1', detected_at: detected, prev_read_at: prev, orders, sells: orders, total_after: 100 + id });

  it('shows the exact second in Qatar time', () => {
    expect(qatarClock('2026-10-10T11:06:02Z')).toBe('14:06:02');
    expect(qatarClock('2026-10-09T21:00:00Z')).toBe('00:00:00');
  });

  it('groups events by Qatar day, newest first', () => {
    const by = eventsByDay([
      ev(1, '2026-10-10T08:00:10Z', '2026-10-10T07:59:10Z'),
      ev(2, '2026-10-10T09:30:05Z', '2026-10-10T09:29:05Z'),
      ev(3, '2026-10-09T20:59:59Z', '2026-10-09T20:58:59Z'),
      ev(4, '2026-10-09T21:00:30Z', '2026-10-09T20:59:30Z'),
    ]);
    expect(by.get('2026-10-10')?.map(e => e.id)).toEqual([2, 1, 4]);
    expect(by.get('2026-10-09')?.map(e => e.id)).toEqual([3]);
  });
});
