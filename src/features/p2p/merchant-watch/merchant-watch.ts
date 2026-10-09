/** One reading of a Binance merchant, as the poller stores it. */
export interface MerchantSnapshot {
  user_no: string;
  /** ISO timestamp of the reading. */
  ts: string;
  online: boolean;
  active_seconds: number | null;
  last_active_at: string | null;
  total_orders: number | null;
  sell_orders: number | null;
  buy_orders: number | null;
  month_orders: number | null;
  month_sell_orders: number | null;
  finish_rate: number | null;
}

export interface WatchedMerchant {
  id: string;
  user_no: string;
  nick: string;
  created_at: string;
}

export type OrderCounter = 'total_orders' | 'sell_orders';

/** A reading older than this no longer says the merchant is online right now. */
const STALE_READING_MS = 15 * 60_000;

const startOfLocalDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface DayOrders {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  /** Orders the merchant completed that day, or null when nothing was being recorded yet. */
  orders: number | null;
}

/**
 * Orders completed per local day, from how the merchant's running order count
 * moved. Binance only exposes a running total, so a day's figure is the total
 * at its end minus the total at its start. The first day on record starts from
 * the first reading, and days before any reading are null rather than zero.
 */
export function ordersPerDay(
  snapshots: MerchantSnapshot[],
  options: { days: number; field?: OrderCounter; now?: number },
): DayOrders[] {
  const field = options.field ?? 'total_orders';
  const now = options.now ?? Date.now();
  const points = snapshots
    .filter(s => typeof s[field] === 'number')
    .map(s => ({ ts: new Date(s.ts).getTime(), value: s[field] as number }))
    .sort((a, b) => a.ts - b.ts);

  const lastBefore = (limit: number) => {
    let found: number | null = null;
    for (const p of points) {
      if (p.ts < limit) found = p.value; else break;
    }
    return found;
  };

  const out: DayOrders[] = [];
  const today = startOfLocalDay(now);
  for (let i = options.days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const start = d.getTime();
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    const end = lastBefore(next.getTime());
    if (end === null) { out.push({ day: localDayKey(start), orders: null }); continue; }
    let from = lastBefore(start);
    if (from === null) from = points.find(p => p.ts >= start && p.ts < next.getTime())?.value ?? end;
    out.push({ day: localDayKey(start), orders: Math.max(0, end - from) });
  }
  return out;
}

export interface OnlineState {
  online: boolean;
  /** Seconds since the merchant was last active, when known. */
  lastSeenSeconds: number | null;
  /** True when the newest reading is too old to trust. */
  stale: boolean;
}

export function onlineState(latest: MerchantSnapshot | undefined, now = Date.now()): OnlineState {
  if (!latest) return { online: false, lastSeenSeconds: null, stale: true };
  const readAt = new Date(latest.ts).getTime();
  const stale = now - readAt > STALE_READING_MS;
  const lastActive = latest.last_active_at ? new Date(latest.last_active_at).getTime() : null;
  const lastSeenSeconds = lastActive ? Math.max(0, Math.round((now - lastActive) / 1000)) : latest.active_seconds;
  return { online: latest.online && !stale, lastSeenSeconds, stale };
}

/** "5 min ago", "3 h ago" for a number of seconds. */
export function agoLabel(seconds: number | null, lang: 'en' | 'ar'): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const ar = lang === 'ar';
  if (seconds < 90) return ar ? 'قبل لحظات' : 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return ar ? `قبل ${minutes} دقيقة` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return ar ? `قبل ${hours} ساعة` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  return ar ? `قبل ${days} يوم` : `${days} d ago`;
}

/** Groups readings by merchant, oldest first. */
export function groupSnapshots(rows: MerchantSnapshot[]): Map<string, MerchantSnapshot[]> {
  const by = new Map<string, MerchantSnapshot[]>();
  for (const r of rows) {
    const list = by.get(r.user_no) ?? [];
    list.push(r);
    by.set(r.user_no, list);
  }
  for (const list of by.values()) list.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return by;
}

/** Pulls a Binance merchant id out of a pasted id or profile link. */
export function extractMerchantId(text: string): string | null {
  return text.match(/\bs[0-9a-f]{32}\b/i)?.[0] ?? null;
}
