import { comparePlacement } from '@/lib/order-sequence';

const DAY = 864e5;

const p2 = (n: number) => String(n).padStart(2, '0');
const dayCode = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`; };

/**
 * The reference shown on an order card, ORD-YYYYMMDD-NNN: the day it was placed and its place among that day's
 * orders, oldest first, ordered the way the page orders everything else (see comparePlacement). Stock batches use
 * the same numbering under their own prefix (BAT-…).
 */
export function orderReferences(trades: Array<{ id: string; ts: number; exchangeOrderNumber?: string | null }>, prefix = 'ORD'): Map<string, string> {
  const sorted = [...trades].sort((a, b) => comparePlacement(
    { ts: a.ts, orderNumber: a.exchangeOrderNumber, id: a.id },
    { ts: b.ts, orderNumber: b.exchangeOrderNumber, id: b.id },
  ));
  const perDay = new Map<string, number>();
  const out = new Map<string, string>();
  for (const tr of sorted) {
    const code = dayCode(tr.ts);
    const n = (perDay.get(code) ?? 0) + 1;
    perDay.set(code, n);
    out.set(tr.id, `${prefix}-${code}-${String(n).padStart(3, '0')}`);
  }
  return out;
}

/** A steady pick from `size` colours for a name, so a buyer keeps the same avatar colour everywhere. */
export function avatarTone(name: string, size: number): number {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % size;
}

export function initialOf(name: string): string {
  const letter = Array.from(name.trim())[0];
  return letter ? letter.toUpperCase() : '?';
}

/**
 * Percent change in the number of orders against the period before: the month before a chosen month, or the
 * last 30 days against the 30 before for all time. Null when there is nothing before it to compare with.
 */
export function orderCountChange(timestamps: number[], selectedMonth: string, now: number): number | null {
  let curFrom: number; let curTo: number; let prevFrom: number; let prevTo: number;
  if (selectedMonth === 'all') {
    curFrom = now - 30 * DAY; curTo = now; prevFrom = curFrom - 30 * DAY; prevTo = curFrom - 1;
  } else {
    const [y, m] = selectedMonth.split('-').map(Number);
    curFrom = new Date(y, m - 1, 1).getTime();
    curTo = new Date(y, m, 1).getTime() - 1;
    prevFrom = new Date(y, m - 2, 1).getTime();
    prevTo = curFrom - 1;
  }
  const count = (from: number, to: number) => timestamps.filter(ts => ts >= from && ts <= to).length;
  const prev = count(prevFrom, prevTo);
  if (prev === 0) return null;
  return ((count(curFrom, curTo) - prev) / prev) * 100;
}

/** Points reduced to `n` equal slices of their own time span: the little trend drawn on a card. */
export function bucketSeries(points: Array<{ ts: number; value: number }>, n = 10): number[] {
  if (points.length === 0) return [];
  const from = Math.min(...points.map(p => p.ts));
  const to = Math.max(...points.map(p => p.ts));
  const span = Math.max(1, to - from + 1);
  const out = new Array<number>(n).fill(0);
  for (const p of points) out[Math.min(n - 1, Math.floor(((p.ts - from) / span) * n))] += p.value;
  return out;
}

/** "9,698 QAR" as its number and its unit, so the unit can be drawn smaller; a sign stays with the number. */
export function splitAmount(text: string): { n: string; u: string } {
  const m = /^\s*([+\-−]?\s*[\d.,]+)\s*(\S.*)?$/.exec(text);
  return m ? { n: m[1].replace(/\s+/g, ''), u: (m[2] ?? '').trim() } : { n: text, u: '' };
}
