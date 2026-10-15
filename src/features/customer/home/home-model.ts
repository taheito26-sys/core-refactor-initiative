// ─── Customer home: pure view-model helpers ───

import type { WorkflowOrder } from '@/features/orders/shared-order-workflow';

export type ActivityTone = 'ok' | 'proc' | 'bad';
export type ActivityKind = 'received' | 'new' | 'paid';

export interface ActivityRow {
  id: string;
  kind: ActivityKind;
  ts: number;
  amount: number;
  /** Sign shown in front of the amount. */
  sign: '+' | '-';
  status: ActivityTone;
  /** 'cancelled' orders read as a red pill with their own label. */
  cancelled?: boolean;
  /** Currency name for a new order's subtitle. */
  currency?: string;
  /** Where the activity came from, for navigation. */
  orderId?: string;
}

export interface PaymentLike { date: number; amount: number }

/**
 * The newest activity first: orders the customer received or placed, plus the
 * payments they made against their balance. Mirrors the three sample rows of
 * the design: a received payment (+, green), a new order still processing
 * (+, blue) and a settled payment of dues (-, red).
 */
export function buildActivity(input: { orders: WorkflowOrder[]; payments: PaymentLike[]; limit?: number }): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const o of input.orders) {
    const ts = new Date(o.created_at).getTime();
    if (!Number.isFinite(ts)) continue;
    const pending = o.workflow_status === 'pending_customer_approval' || o.workflow_status === 'pending_merchant_approval';
    const dead = o.workflow_status === 'rejected' || o.workflow_status === 'cancelled';
    const merchantPlaced = o.placed_by_role === 'merchant';
    if (pending) rows.push({ id: o.id, kind: 'new', ts, amount: o.amount ?? 0, sign: '+', status: 'proc', currency: o.receive_currency ?? 'EGP', orderId: o.id });
    else if (dead) rows.push({ id: o.id, kind: 'new', ts, amount: o.amount ?? 0, sign: '+', status: 'bad', cancelled: true, currency: o.receive_currency ?? 'EGP', orderId: o.id });
    else if (merchantPlaced) rows.push({ id: o.id, kind: 'received', ts, amount: o.amount ?? 0, sign: '+', status: 'ok', orderId: o.id });
    else rows.push({ id: o.id, kind: 'paid', ts, amount: o.amount ?? 0, sign: '-', status: 'bad', orderId: o.id });
  }
  input.payments.forEach((p, i) => {
    if (p.amount > 0 && Number.isFinite(p.date)) rows.push({ id: `pay-${i}-${p.date}`, kind: 'paid', ts: p.date, amount: p.amount, sign: '-', status: 'bad' });
  });
  return rows.sort((a, b) => b.ts - a.ts).slice(0, input.limit ?? 3);
}

/** "13 أكتوبر 2026 • 12:00" in the user's language, Western digits, 24-hour clock. */
export function formatActivityStamp(ts: number, lang: 'en' | 'ar'): string {
  const d = new Date(ts);
  const locale = lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} • ${time}`;
}

/** "13 أكتوبر 2026, 12:00" as the last-payment stat shows it. */
export function formatPaymentStamp(ts: number, lang: 'en' | 'ar'): string {
  const d = new Date(ts);
  const date = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} ${d.getFullYear()}, ${time}`;
}

// ─── Rate trend (the % chip and the little line on the two rate cards) ───

export interface RateReading { t: number; v: number }
const DAY = 86400_000;
const MAX_READINGS = 32;

/** Adds a reading when the value moved or the last one is older than 30 minutes. */
export function recordRate(history: RateReading[], value: number | null | undefined, now: number): RateReading[] {
  if (value == null || !Number.isFinite(value) || value <= 0) return history;
  const last = history.at(-1);
  if (last && last.v === value && now - last.t < 30 * 60_000) return history;
  return [...history, { t: now, v: value }].slice(-MAX_READINGS);
}

export interface RateTrend { pct: number; up: boolean; points: number[] }

/** Change against the oldest reading of the last 24 hours (the first reading when none is that recent). */
export function rateTrend(history: RateReading[], now: number): RateTrend {
  const last = history.at(-1);
  if (!last || history.length < 2) return { pct: 0, up: true, points: history.map(h => h.v) };
  const recent = history.filter(h => now - h.t <= DAY);
  const ref = (recent.length >= 2 ? recent[0] : history[0]).v;
  const pct = ref > 0 ? ((last.v - ref) / ref) * 100 : 0;
  return { pct, up: pct >= 0, points: history.slice(-12).map(h => h.v) };
}

/** An SVG polyline path fitted into w x h; a flat line when there is nothing to draw. */
export function sparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return `M0 ${h / 2} L${w} ${h / 2}`;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
}

// ─── Month chart ───

export interface ChartPoint { x: number; y: number }

/**
 * Turns the last days of volume into the eight points of the card's line:
 * buckets of days summed, accumulated so the line climbs, then fitted between
 * the baseline and the top of the plot area.
 */
export function chartPoints(daily: number[], xs: number[], top: number, bottom: number): ChartPoint[] {
  const n = xs.length;
  const buckets: number[] = Array.from({ length: n }, () => 0);
  daily.forEach((v, i) => { buckets[Math.min(n - 1, Math.floor((i / Math.max(1, daily.length)) * n))] += Math.max(0, v); });
  let run = 0;
  const cumulative = buckets.map(v => (run += v));
  const max = cumulative[n - 1] || 0;
  return xs.map((x, i) => ({ x, y: max > 0 ? bottom - (cumulative[i] / max) * (bottom - top) : bottom }));
}

/** Smooth cubic path through the points (Catmull-Rom converted to Béziers). */
export function smoothPath(points: ChartPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
