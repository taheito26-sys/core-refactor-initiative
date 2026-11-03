import { describe, expect, it } from 'vitest';
import {
  calendarMonthComparison, activeClients, clientPeriodChanges, deltaWindow, pctChange, rangeWindow, scopePoints, sparkline, summarize, topClients, trendBuckets,
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

  it('compares this month so far with the whole previous month', () => {
    const w = rangeWindow('this_month', NOW, null);
    expect(w.from).toBe(at(2026, 10, 1, 0));
    expect(w.prevFrom).toBe(at(2026, 9, 1, 0));
    expect(w.prevTo).toBe(w.from - 1);
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
  it('gives the months of this year up to the current one', () => {
    const b = trendBuckets([pt(at(2026, 10, 3)), pt(at(2026, 10, 9)), pt(at(2026, 9, 5)), pt(at(2025, 1, 5))], 'month', NOW);
    expect(b).toHaveLength(10);
    expect(new Date(b[0].start).getMonth()).toBe(0);
    expect(b[9].net).toBe(200);
    expect(b[8].net).toBe(100);
    expect(b.reduce((s, x) => s + x.net, 0)).toBe(300);
  });

  it('shows at least six months early in the year', () => {
    expect(trendBuckets([], 'month', new Date(2026, 1, 10).getTime())).toHaveLength(6);
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

describe('deltaWindow', () => {
  it('keeps a window that has a previous period', () => {
    const w = rangeWindow('7d', NOW, null);
    expect(deltaWindow(w, NOW)).toBe(w);
  });

  it('compares November to date with all of October when All is selected', () => {
    const now = at(2026, 11, 1, 3);
    const w = deltaWindow(rangeWindow('all', now, at(2026, 3, 6)), now);
    expect(w.from).toBe(at(2026, 11, 1, 0));
    expect(w.to).toBe(now);
    expect(w.prevFrom).toBe(at(2026, 10, 1, 0));
    expect(w.prevTo).toBe(at(2026, 11, 1, 0) - 1);
    const points = [pt(at(2026, 9, 20), { vol: 99999 }), pt(at(2026, 10, 1, 1), { vol: 100 }), pt(at(2026, 10, 30), { vol: 99999 }), pt(at(2026, 11, 1, 1), { vol: 50 })];
    expect(summarize(points, w.from, w.to).vol).toBe(50);
    expect(summarize(points, w.prevFrom!, w.prevTo!).vol).toBe(100099);
    expect(pctChange(50, 100099)).toBeCloseTo(-99.95, 2);
  });

  it('does not skip an empty new month and rolls January against December', () => {
    const now = at(2027, 1, 1, 3);
    const w = deltaWindow(rangeWindow('all', now, at(2026, 9, 1)), now);
    expect(w.from).toBe(at(2027, 1, 1, 0));
    expect(w.prevFrom).toBe(at(2026, 12, 1, 0));
    const points = [pt(at(2026, 12, 1, 1))];
    expect(summarize(points, w.from, w.to).orders).toBe(0);
    expect(clientPeriodChanges(points, w, 'profit').get('A')).toBe(-100);
  });
});


describe('headline calendar month comparison', () => {
  it('compares November totals with all of October, including its final day', () => {
    const now = at(2026, 11, 1, 22);
    const points = [
      pt(at(2026, 9, 30), { vol: 9000000, net: 90000 }),
      pt(at(2026, 10, 1), { vol: 20000, net: 400 }),
      pt(at(2026, 10, 31, 23), { vol: 1080000, net: 29600 }),
      pt(at(2026, 11, 1, 14), { vol: 21892, net: 685 }),
      pt(at(2026, 11, 2), { vol: 999999, net: 99999 }),
    ];
    const result = calendarMonthComparison(points, now);
    expect(result.cur.vol).toBe(21892);
    expect(result.cur.net).toBe(685);
    expect(result.prev?.vol).toBe(1100000);
    expect(result.prev?.net).toBe(30000);
    expect(pctChange(result.cur.vol, result.prev?.vol)).toBeCloseTo(-98.0098, 3);
    expect(pctChange(result.cur.net, result.prev?.net)).toBeCloseTo(-97.7167, 3);
  });
  it('rolls January against all of December and does not skip an empty month', () => {
    const result = calendarMonthComparison([pt(at(2026, 12, 31, 23), { vol: 100, net: 20 })], at(2027, 1, 1, 1));
    expect(result.cur.orders).toBe(0);
    expect(result.prev?.vol).toBe(100);
    expect(pctChange(result.cur.net, result.prev?.net)).toBe(-100);
  });
  it('has no fabricated percentage when the previous month has no profit', () => {
    const result = calendarMonthComparison([pt(at(2026, 11, 1), { vol: 100, net: 20 })], at(2026, 11, 2));
    expect(pctChange(result.cur.net, result.prev?.net)).toBeNull();
  });
});


describe('monthly top client ranking and baseline', () => {
  it('excludes past-month-only clients and uses full prior-month profit and volume for the same client', () => {
    const now = at(2026, 11, 3);
    const points = [
      pt(at(2026, 9, 20), { client: 'Mohamed Al-Damrawy', net: 100, vol: 1000 }),
      pt(at(2026, 10, 1), { client: 'Mohamed Al-Damrawy', net: 10000, vol: 400000 }),
      pt(at(2026, 10, 31, 23), { client: 'Mohamed Al-Damrawy', net: 20000, vol: 700000 }),
      pt(at(2026, 10, 20), { client: 'Past client', net: 999999 }),
      pt(at(2026, 11, 2), { client: 'Mohamed Al-Damrawy', net: 685, vol: 21892 }),
    ];
    const win = calendarMonthComparison(points, now).window;
    const profit = topClients(points, win, 'profit');
    expect(profit).toHaveLength(1);
    expect(profit[0]).toMatchObject({ value: 685, previousValue: 30000, orders: 1 });
    expect(profit[0].change).toBeCloseTo(-97.7167, 3);
    const volume = topClients(points, win, 'volume')[0];
    expect(volume.previousValue).toBe(1100000);
    expect(volume.change).toBeCloseTo(-98.0098, 3);
  });
});
