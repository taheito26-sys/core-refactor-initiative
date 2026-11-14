import type { Shipment, ShipmentReading, ShipmentStop, ShipmentStatus } from './types';

export type Lang = 'en' | 'ar';

export interface RouteStopDef {
  nameEn: string;
  nameAr: string;
}

/**
 * The fixed Egypt → Qatar route every shipment starts with, in driving order. Drivers can add
 * their own stops between these while on the road; the customer cannot reorder them.
 */
export const FIXED_ROUTE: RouteStopDef[] = [
  { nameEn: 'Obour (Cairo)', nameAr: 'العبور' },
  { nameEn: 'Kafr El Sheikh', nameAr: 'كفر الشيخ' },
  { nameEn: 'Port Said', nameAr: 'بورسعيد' },
  { nameEn: 'Safaga port', nameAr: 'ميناء سفاجا' },
  { nameEn: 'Saudi Arabia', nameAr: 'السعودية' },
  { nameEn: 'Qatar (delivery)', nameAr: 'قطر (التسليم)' },
];

/** Shape the create_customer_shipment function expects for its stops. */
export const fixedRouteForRpc = () => FIXED_ROUTE.map((s) => ({ name_en: s.nameEn, name_ar: s.nameAr }));

export const DEFAULT_TARGET_TEMP_C = -15;
export const DEFAULT_TOLERANCE_C = 3;
export const DEFAULT_READING_INTERVAL_HOURS = 3;

export const stopName = (stop: Pick<ShipmentStop, 'name_en' | 'name_ar'>, lang: Lang) =>
  (lang === 'ar' ? stop.name_ar : stop.name_en) || stop.name_en || stop.name_ar;

export const sortStops = (stops: ShipmentStop[]) => [...stops].sort((a, b) => Number(a.seq) - Number(b.seq));

export interface StopProgress {
  stops: ShipmentStop[];
  reachedCount: number;
  total: number;
  /** Last stop the driver confirmed, null before the trip starts. */
  current: ShipmentStop | null;
  /** Next stop to confirm, null once everything is reached. */
  next: ShipmentStop | null;
  origin: ShipmentStop | null;
  destination: ShipmentStop | null;
}

export function stopProgress(rawStops: ShipmentStop[]): StopProgress {
  const stops = sortStops(rawStops);
  const reached = stops.filter((s) => s.reached_at);
  return {
    stops,
    reachedCount: reached.length,
    total: stops.length,
    current: reached.length ? reached[reached.length - 1] : null,
    next: stops.find((s) => !s.reached_at) ?? null,
    origin: stops[0] ?? null,
    destination: stops.length ? stops[stops.length - 1] : null,
  };
}

/** True when a reading is outside the shipment's allowed band. Mirrors driver_submit_reading in the database. */
export function isOutOfRange(temperature: number, target: number, tolerance: number): boolean {
  return Math.abs(temperature - target) > tolerance;
}

export type ReadingDueState = 'idle' | 'ok' | 'due_soon' | 'overdue';

export interface ReadingDue {
  state: ReadingDueState;
  dueAt: number | null;
  /** Milliseconds past due (0 unless overdue). */
  overdueMs: number;
}

const DUE_SOON_MS = 30 * 60 * 1000;

/**
 * When the next temperature photo is due: the shipment's interval after the last reading, or after
 * the trip started when there is none yet. Only a shipment on the road is ever due.
 */
export function readingDue(
  shipment: Pick<Shipment, 'status' | 'started_at' | 'reading_interval_hours'>,
  lastReadingAt: string | null,
  now: number,
): ReadingDue {
  if (shipment.status !== 'on_the_road') return { state: 'idle', dueAt: null, overdueMs: 0 };
  const base = lastReadingAt ?? shipment.started_at;
  if (!base) return { state: 'idle', dueAt: null, overdueMs: 0 };
  const dueAt = new Date(base).getTime() + shipment.reading_interval_hours * 3600_000;
  if (now > dueAt) return { state: 'overdue', dueAt, overdueMs: now - dueAt };
  return { state: dueAt - now <= DUE_SOON_MS ? 'due_soon' : 'ok', dueAt, overdueMs: 0 };
}

export const latestReading = (readings: ShipmentReading[]): ShipmentReading | null =>
  readings.reduce<ShipmentReading | null>(
    (best, r) => (!best || new Date(r.taken_at).getTime() > new Date(best.taken_at).getTime() ? r : best),
    null,
  );

/** "18 min ago", "2 h ago", "3 d ago" — in the portal's language. */
export function agoLabel(iso: string, now: number, lang: Lang): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return lang === 'ar' ? 'الآن' : 'just now';
  const [n, unitEn, unitAr] =
    minutes < 60 ? [minutes, 'min', 'دقيقة']
      : minutes < 1440 ? [Math.floor(minutes / 60), 'h', 'ساعة']
        : [Math.floor(minutes / 1440), 'd', 'يوم'];
  return lang === 'ar' ? `منذ ${n} ${unitAr}` : `${n} ${unitEn} ago`;
}

/** Duration as "2 h 15 min" for the overdue / due-in labels. */
export function durationLabel(ms: number, lang: Lang): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hUnit = lang === 'ar' ? 'ساعة' : 'h';
  const mUnit = lang === 'ar' ? 'دقيقة' : 'min';
  if (h === 0) return `${m} ${mUnit}`;
  return m === 0 ? `${h} ${hUnit}` : `${h} ${hUnit} ${m} ${mUnit}`;
}

export const STATUS_LABELS: Record<ShipmentStatus, { en: string; ar: string }> = {
  preparing: { en: 'Preparing', ar: 'قيد التجهيز' },
  on_the_road: { en: 'On the road', ar: 'في الطريق' },
  delivered: { en: 'Delivered', ar: 'تم التسليم' },
  cancelled: { en: 'Cancelled', ar: 'ملغاة' },
};

/** Parses what a driver typed: accepts a comma decimal and Arabic-Indic digits, returns null when it is not a number. */
export function parseTemperatureInput(raw: string): number | null {
  const normalized = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,٫]/g, '.')
    .replace(/[−–—]/g, '-');
  if (!/^-?\d{1,2}(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return value >= -60 && value <= 60 ? value : null;
}

/** Flips the sign of the typed text, so a phone keypad without a minus key can still enter -15. */
export function toggleSign(raw: string): string {
  const t = raw.trim();
  if (t === '') return '-';
  return t.startsWith('-') ? t.slice(1) : `-${t}`;
}
