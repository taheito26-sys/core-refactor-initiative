import { describe, expect, it } from 'vitest';
import {
  activeClients, pctChange, rangeWindow, scopePoints, sparkline, summarize, topClients, trendBuckets,
  type DashPoint,
} from './dashboard-model';

const DAY = 864e5;
const NOW = new Date(2026, 9, 20, 15, 0).getTime();
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const pt = (ts: number, over: Partial<DashPoint> = {}): DashPoint => ({ ts, client: 'A', own: true, vol: 1000, net: 100, fullNet: 100, ...over });

describe('rangeWindow', () => {
  it('compares today so far with the same hours yesterday', () => {
    const w = rangeWindow('today', NOW, null);
    expect(w.from).toBe(at(2026, 10, 20, 0));
    expect(w.prevFrom).toBe(at(2026, 10, 19, 0));
    expect(w.prevTo).toBe(NOW - DAY);
  });

  it('compares a rolling period with the one of equal length before it', () => {
    const w = rangeWindow('7d', NOW, null);
    expect(w.prevTo).toBe(w.from - 1);
    expect(w.to - w.from).toBe(7 * DAY);
    expect(w.from - (w.prevFrom as number)).toBe(7 * DAY);
  });

  it('compares this month so far with the same stretch of last month', () => {
    const w = rangeWindow('this_month', NOW, null);
    expect(w.from).toBe(at(2026, 10, 1, 0));
    expect(w.prevFrom).toBe(at(2026, 9, 1, 0));
    expect((w.prevTo as number) - (w.prevFrom as number)).toBe(NOW - w.from);
  });

  it('has nothing to compare all time with', () => {
    const w = rangeWindow('all', NOW, at(2026, 1, 1));
    expect(w.from).toBe(at(2026, 1, 1));
    expect(w.prevFrom).toBeNull();
  });

  it('makes a custom period whole days and compares it with the same number of days before', () => {
    const w = rangeWindow('all', NOW, null, { from: at(2026, 10, 10, 9), to: at(2026, 10, 12, 18) });
    expect(w.from).toBe(at(2026, 10, 10, 0));
    expect(w.to).toBe(at(2026, 10, 13, 0) - 1);
    expect(w.prevFrom).toBe(at(2026, 10, 7, 0));
  });
});

describe('pctChange', () => {
  it('reports the change, and nothing when there is no earlier figure', () => {
    expect(pctChange(112, 100)).toBeCloseTo(12);
    expect(pctChange(50, 100)).toBeCloseTo(-50);
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(5, null)).toBeNull();
  });
});

describe('summarize and scope', () => {
  const points = [pt(at(2026, 10, 18)), pt(at(2026, 10, 19), { own: false, vol: 500, net: 20, fullNet: 40 }), pt(at(2026, 9, 1))];

  it('adds up what falls inside the window', () => {
    const s = summarize(points, at(2026, 10, 1, 0), NOW);
    expect(s).toEqual({ vol: 1500, ownVol: 1000, net: 120, fullNet: 140, orders: 2 });
  });

  it('keeps only own or only partner orders', () => {
    expect(scopePoints(points, 'own')).toHaveLength(2);
    expect(scopePoints(points, 'partner')).toHaveLength(1);
    expect(scopePoints(points, 'all')).toHaveLength(3);
  });
});

describe('sparkline', () => {
  it('splits the window into equal slices', () => {
    const w = { from: 0, to: 79, prevFrom: null, prevTo: null };
    const pts = [pt(5), pt(15), pt(15), pt(75)];
    const s = sparkline(pts, w, () => 1, 8);
    expect(s).toEqual([1, 2, 0, 0, 0, 0, 0, 1]);
  });
});

describe('trendBuckets', () => {
  it('gives twelve months ending with the current one', () => {
    const b = trendBuckets([pt(at(2026, 10, 3)), pt(at(2026, 10, 9)), pt(at(2026, 9, 5)), pt(at(2025, 1, 5))], 'month', NOW);
    expect(b).toHaveLength(12);
    expect(b[11].net).toBe(200);
    expect(b[10].net).toBe(100);
    expect(b.reduce((s, x) => s + x.net, 0)).toBe(300);
  });

  it('gives thirty days and twelve weeks', () => {
    expect(trendBuckets([], 'day', NOW)).toHaveLength(30);
    expect(trendBuckets([], 'week', NOW)).toHaveLength(12);
    const days = trendBuckets([pt(NOW)], 'day', NOW);
    expect(days[29].net).toBe(100);
  });
});

describe('topClients', () => {
  const win = rangeWindow('30d', NOW, null);
  const points = [
    pt(NOW - 2 * DAY, { client: 'A', net: 300 }),
    pt(NOW - 3 * DAY, { client: 'A', net: 100 }),
    pt(NOW - 4 * DAY, { client: 'B', net: 500 }),
    pt(NOW - 40 * DAY, { client: 'A', net: 200 }),
    pt(NOW - 5 * DAY, { client: null, net: 900 }),
  ];

  it('ranks by profit, counts orders and compares with the period before', () => {
    const top = topClients(points, win, 'profit');
    expect(top.map(c => c.name)).toEqual(['B', 'A']);
    expect(top[1]).toMatchObject({ name: 'A', value: 400, orders: 2 });
    expect(top[1].change).toBeCloseTo(100);
    expect(top[0].change).toBeNull();
  });

  it('can rank by volume and respects the limit', () => {
    const top = topClients(points, win, 'volume', 1);
    expect(top).toHaveLength(1);
    expect(top[0].name).toBe('A');
  });
});

describe('activeClients', () => {
  it('counts distinct recent clients and the ones new this month', () => {
    const pts = [pt(at(2026, 10, 10), { client: 'A' }), pt(at(2026, 10, 12), { client: 'B' }), pt(at(2026, 8, 1), { client: 'B' }), pt(at(2026, 7, 1), { client: 'C' })];
    expect(activeClients(pts, NOW)).toEqual({ active: 2, newThisMonth: 1 });
  });
});
