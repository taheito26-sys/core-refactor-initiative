import { routeDistanceKm } from './driver-stats';
import { placeText } from './geo';
import { stopProgress, type Lang } from './route';
import type { ShipmentWithDetails } from './types';

export interface TripSummary {
  /** Time on the road so far, or the whole trip once delivered. Null before the trip starts. */
  elapsedMs: number | null;
  stopsDone: number;
  stopsTotal: number;
  readingsCount: number;
  /** Share of readings inside the allowed range, 0 to 100. Null with no readings. */
  inRangePct: number | null;
  alertCount: number;
  minC: number | null;
  maxC: number | null;
  avgC: number | null;
  /** Approximate: worked out from the position points, which are about an hour apart. */
  distanceKm: number;
  /** Where the truck was last seen, named, in the reader's language. */
  lastPlace: string | null;
}

type Source = Pick<ShipmentWithDetails, 'status' | 'started_at' | 'delivered_at' | 'stops' | 'readings' | 'locations'>;

export function tripSummary(s: Source, now: number, lang: Lang): TripSummary {
  const readings = s.readings;
  const temps = readings.map((r) => Number(r.temperature_c)).filter(Number.isFinite);
  const alerts = readings.filter((r) => r.is_alert).length;
  const progress = stopProgress(s.stops);
  const start = s.started_at ? new Date(s.started_at).getTime() : null;
  const end = s.delivered_at ? new Date(s.delivered_at).getTime() : s.status === 'cancelled' ? null : now;
  const newest = [...s.locations].sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0];
  return {
    elapsedMs: start !== null && end !== null ? Math.max(0, end - start) : null,
    stopsDone: progress.reachedCount,
    stopsTotal: progress.total,
    readingsCount: readings.length,
    inRangePct: readings.length ? Math.round(((readings.length - alerts) / readings.length) * 100) : null,
    alertCount: alerts,
    minC: temps.length ? Math.min(...temps) : null,
    maxC: temps.length ? Math.max(...temps) : null,
    avgC: temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
    distanceKm: Math.round(routeDistanceKm(s.locations)),
    lastPlace: placeText(newest, lang),
  };
}
