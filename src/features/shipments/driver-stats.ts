import { haversineKm } from './geo';
import type { Shipment, ShipmentLocation, ShipmentReading, ShipmentStop } from './types';

export interface TripLike extends Pick<Shipment, 'status' | 'started_at' | 'delivered_at' | 'weight_tons' | 'reading_interval_hours'> {
  stops: Pick<ShipmentStop, 'reached_at'>[];
  readings: Pick<ShipmentReading, 'taken_at' | 'is_alert'>[];
  locations: Pick<ShipmentLocation, 'latitude' | 'longitude' | 'recorded_at'>[];
}

export interface MonthStats {
  month: string;
  tripsStarted: number;
  tripsDelivered: number;
  tons: number;
  distanceKm: number;
  /** Hours from start to delivery, averaged over delivered trips; null with none. */
  avgTripHours: number | null;
  readings: number;
  alerts: number;
  /** Share of readings inside the allowed range, 0-100; null with no readings. */
  inRangePct: number | null;
  /** Share of expected readings sent on time, 0-100; null before any is expected. */
  onTimePct: number | null;
  missedReadings: number;
  stopsConfirmed: number;
}

const HOUR = 3_600_000;
/** A reading counts as on time when it comes within the interval plus this much. */
const GRACE_MS = 30 * 60_000;
/** A hop between two position points faster than this is a GPS glitch, not driving. */
const MAX_PLAUSIBLE_KMH = 160;

/** "2026-11" for the month (device local time) a date falls in. */
export function monthKey(iso: string | number | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The last `count` months ending with the one `now` is in, oldest first. */
export function lastMonths(count: number, now: number): string[] {
  const d = new Date(now);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(monthKey(new Date(d.getFullYear(), d.getMonth() - i, 1)));
  return out;
}

/** Driven distance from the trail of position points, ignoring impossible jumps. Approximate: hourly points straighten the road. */
export function routeDistanceKm(points: Pick<ShipmentLocation, 'latitude' | 'longitude' | 'recorded_at'>[]): number {
  const sorted = [...points].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  let km = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const d = haversineKm(a, b);
    const hours = (new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()) / HOUR;
    if (hours <= 0) continue;
    if (d / hours <= MAX_PLAUSIBLE_KMH) km += d;
  }
  return km;
}

/**
 * How well one trip kept to its reading schedule. Walks the trip from its start: a reading within the
 * interval (plus a grace) of the one before is on time; a longer gap makes it late and counts the readings
 * that should have come in between as missed. A trip still on the road is measured up to `now`.
 */
export function tripPunctuality(trip: TripLike, now: number): { onTime: number; late: number; missed: number } {
  const result = { onTime: 0, late: 0, missed: 0 };
  if (!trip.started_at) return result;
  const interval = trip.reading_interval_hours * HOUR;
  const start = new Date(trip.started_at).getTime();
  const end = trip.delivered_at ? new Date(trip.delivered_at).getTime() : now;
  const times = trip.readings.map((r) => new Date(r.taken_at).getTime()).filter((t) => t >= start && t <= end).sort((a, b) => a - b);
  const missedIn = (gap: number) => Math.max(0, Math.floor((gap - GRACE_MS) / interval));
  let prev = start;
  for (const t of times) {
    const gap = t - prev;
    if (gap <= interval + GRACE_MS) result.onTime += 1;
    else { result.late += 1; result.missed += missedIn(gap); }
    prev = t;
  }
  if (end - prev > interval + GRACE_MS) result.missed += missedIn(end - prev);
  return result;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** One month of a driver's work. A trip is counted in the month it started, everything about it included. */
export function driverMonthStats(trips: TripLike[], month: string, now: number): MonthStats {
  const inMonth = trips.filter((t) => t.started_at && t.status !== 'cancelled' && monthKey(t.started_at) === month);
  const delivered = inMonth.filter((t) => t.status === 'delivered');
  const readings = inMonth.flatMap((t) => t.readings);
  const alerts = readings.filter((r) => r.is_alert).length;
  const punctual = inMonth.map((t) => tripPunctuality(t, now));
  const onTime = punctual.reduce((s, p) => s + p.onTime, 0);
  const late = punctual.reduce((s, p) => s + p.late, 0);
  const missed = punctual.reduce((s, p) => s + p.missed, 0);
  const durations = delivered.filter((t) => t.delivered_at).map((t) => (new Date(t.delivered_at as string).getTime() - new Date(t.started_at as string).getTime()) / HOUR);

  return {
    month,
    tripsStarted: inMonth.length,
    tripsDelivered: delivered.length,
    tons: Math.round(delivered.reduce((s, t) => s + (t.weight_tons ?? 0), 0) * 10) / 10,
    distanceKm: Math.round(inMonth.reduce((s, t) => s + routeDistanceKm(t.locations), 0)),
    avgTripHours: durations.length ? Math.round((durations.reduce((s, h) => s + h, 0) / durations.length) * 10) / 10 : null,
    readings: readings.length,
    alerts,
    inRangePct: pct(readings.length - alerts, readings.length),
    onTimePct: pct(onTime, onTime + late + missed),
    missedReadings: missed,
    // The first stop is confirmed automatically when the trip starts, so it is not the driver's doing.
    stopsConfirmed: inMonth.reduce((s, t) => s + Math.max(0, t.stops.filter((st) => st.reached_at).length - 1), 0),
  };
}

export type Grade = 'good' | 'fair' | 'poor';

/** Words for a percentage, so the screen never relies on colour alone. */
export function gradeOf(percent: number | null): Grade | null {
  if (percent === null) return null;
  return percent >= 95 ? 'good' : percent >= 85 ? 'fair' : 'poor';
}

export const durationHoursLabel = (hours: number, lang: 'en' | 'ar'): string => {
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return d > 0 ? (lang === 'ar' ? `${d} يوم ${h} ساعة` : `${d} d ${h} h`) : lang === 'ar' ? `${h} ساعة` : `${h} h`;
};
