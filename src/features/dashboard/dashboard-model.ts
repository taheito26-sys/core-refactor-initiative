// ─── Dashboard home: the figures behind the cards ───
// Pure functions over a flat list of "points" (one per own trade or partner deal), so every card
// reads from the same rows and each rule can be tested without the UI.

export type OrderScope = 'all' | 'own' | 'partner';

export interface DashPoint {
  ts: number;
  /** Customer or partner the order belongs to; null when it cannot be named. */
  client: string | null;
  /** True for the merchant's own orders, false for a deal with another merchant. */
  own: boolean;
  /** Sold volume, in QAR. */
  vol: number;
  /** The merchant's own share of the profit, in QAR. */
  net: number;
  /** Profit before any partner share, in QAR. */
  fullNet: number;
}

export interface RangeWindow {
  from: number;
  to: number;
  /** The period just before, of the same length; null when there is nothing to compare with. */
  prevFrom: number | null;
  prevTo: number | null;
}

const DAY = 864e5;

const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function scopePoints(points: DashPoint[], scope: OrderScope): DashPoint[] {
  if (scope === 'own') return points.filter(p => p.own);
  if (scope === 'partner') return points.filter(p => !p.own);
  return points;
}

/** The selected range as a window, plus the window before it for "vs previous period". */
export function rangeWindow(range: string, now: number, firstTs: number | null, custom?: { from: number; to: number } | null): RangeWindow {
  if (custom) {
    const from = startOfDay(custom.from);
    const to = startOfDay(custom.to) + DAY - 1;
    const len = to - from + 1;
    return { from, to, prevFrom: from - len, prevTo: from - 1 };
  }
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const prevMonthStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  switch (range) {
    case 'today': {
      const from = startOfDay(now);
      return { from, to: now, prevFrom: from - DAY, prevTo: now - DAY };
    }
    case '7d': {
      const from = now - 7 * DAY;
      return { from, to: now, prevFrom: from - 7 * DAY, prevTo: from - 1 };
    }
    case '30d': {
      const from = now - 30 * DAY;
      return { from, to: now, prevFrom: from - 30 * DAY, prevTo: from - 1 };
    }
    case 'this_month': {
      const elapsed = now - monthStart;
      return { from: monthStart, to: now, prevFrom: prevMonthStart, prevTo: Math.min(prevMonthStart + elapsed, monthStart - 1) };
    }
    case 'last_month': {
      const from = prevMonthStart;
      const to = monthStart - 1;
      const before = new Date(d.getFullYear(), d.getMonth() - 2, 1).getTime();
      return { from, to, prevFrom: before, prevTo: from - 1 };
    }
    default:
      // All time has no period before it to compare with.
      return { from: firstTs ?? now, to: now, prevFrom: null, prevTo: null };
  }
}

export const inWindow = (ts: number, from: number, to: number) => ts >= from && ts <= to;

/** Percent change from `prev` to `cur`; null when there is no earlier figure to compare with. */
export function pctChange(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export interface Summary { vol: number; ownVol: number; net: number; fullNet: number; orders: number }

export function summarize(points: DashPoint[], from: number, to: number): Summary {
  const s: Summary = { vol: 0, ownVol: 0, net: 0, fullNet: 0, orders: 0 };
  for (const p of points) {
    if (!inWindow(p.ts, from, to)) continue;
    s.vol += p.vol;
    if (p.own) s.ownVol += p.vol;
    s.net += p.net;
    s.fullNet += p.fullNet;
    s.orders += 1;
  }
  return s;
}

/** The window's figures and the same figures for the period before it. */
export function summarizeWithPrevious(points: DashPoint[], win: RangeWindow) {
  const cur = summarize(points, win.from, win.to);
  const prev = win.prevFrom != null && win.prevTo != null ? summarize(points, win.prevFrom, win.prevTo) : null;
  return { cur, prev };
}

/** `n` equal slices of the window, each reduced to one number: the little trend line on a card. */
export function sparkline(points: DashPoint[], win: RangeWindow, pick: (p: DashPoint) => number, n = 8): number[] {
  const out = new Array<number>(n).fill(0);
  const span = Math.max(1, win.to - win.from + 1);
  for (const p of points) {
    if (!inWindow(p.ts, win.from, win.to)) continue;
    const i = Math.min(n - 1, Math.floor(((p.ts - win.from) / span) * n));
    out[i] += pick(p);
  }
  return out;
}

export type Granularity = 'month' | 'week' | 'day';

export interface TrendBucket { start: number; net: number; vol: number }

/** Profit and volume per month (last 12), week (last 12) or day (last 30), oldest first. */
export function trendBuckets(points: DashPoint[], granularity: Granularity, now: number): TrendBucket[] {
  const starts: number[] = [];
  const d = new Date(now);
  if (granularity === 'month') {
    for (let i = 11; i >= 0; i -= 1) starts.push(new Date(d.getFullYear(), d.getMonth() - i, 1).getTime());
  } else if (granularity === 'week') {
    const today = startOfDay(now);
    for (let i = 11; i >= 0; i -= 1) starts.push(today - (i * 7 + 6) * DAY);
  } else {
    const today = startOfDay(now);
    for (let i = 29; i >= 0; i -= 1) starts.push(today - i * DAY);
  }
  const buckets: TrendBucket[] = starts.map(start => ({ start, net: 0, vol: 0 }));
  const end = (i: number) => {
    if (i + 1 < starts.length) return starts[i + 1];
    if (granularity === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    return granularity === 'week' ? starts[i] + 7 * DAY : starts[i] + DAY;
  };
  for (const p of points) {
    for (let i = buckets.length - 1; i >= 0; i -= 1) {
      if (p.ts >= starts[i]) {
        if (p.ts < end(i)) { buckets[i].net += p.net; buckets[i].vol += p.vol; }
        break;
      }
    }
  }
  return buckets;
}

export interface TopClient { name: string; value: number; orders: number; change: number | null }

/** The clients with the most profit (or volume) in the window, with the change against the period before. */
export function topClients(points: DashPoint[], win: RangeWindow, metric: 'profit' | 'volume', limit = 5): TopClient[] {
  const pick = (p: DashPoint) => (metric === 'profit' ? p.net : p.vol);
  const cur = new Map<string, { value: number; orders: number }>();
  const prev = new Map<string, number>();
  for (const p of points) {
    if (!p.client) continue;
    if (inWindow(p.ts, win.from, win.to)) {
      const row = cur.get(p.client) ?? { value: 0, orders: 0 };
      row.value += pick(p);
      row.orders += 1;
      cur.set(p.client, row);
    } else if (win.prevFrom != null && win.prevTo != null && inWindow(p.ts, win.prevFrom, win.prevTo)) {
      prev.set(p.client, (prev.get(p.client) ?? 0) + pick(p));
    }
  }
  return [...cur.entries()]
    .map(([name, r]) => ({ name, value: r.value, orders: r.orders, change: win.prevFrom == null ? null : pctChange(r.value, prev.get(name)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Distinct clients with an order in the last `days`, and how many of them placed their first order this month. */
export function activeClients(points: DashPoint[], now: number, days = 30): { active: number; newThisMonth: number } {
  const since = now - days * DAY;
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const first = new Map<string, number>();
  const active = new Set<string>();
  for (const p of points) {
    if (!p.client) continue;
    first.set(p.client, Math.min(first.get(p.client) ?? Infinity, p.ts));
    if (p.ts >= since && p.ts <= now) active.add(p.client);
  }
  let newThisMonth = 0;
  for (const [client, ts] of first) if (active.has(client) && ts >= monthStart) newThisMonth += 1;
  return { active: active.size, newThisMonth };
}
