import { activeTripMs, approvalWaitMs } from './timing';
import { gpsCoverage, routeDistanceKm } from './driver-stats';
import { placeText } from './geo';
import { stopProgress, type Lang } from './route';
import type { ShipmentWithDetails } from './types';

export interface TripSummary {
  /** Time on the road so far, or the whole trip once delivered. Null before the trip starts. */
  elapsedMs: number | null;
  waitingApprovalMs: number;
  timingEstimated: boolean;
  gpsSamples: number; gpsCoveragePct: number | null; distanceIncomplete: boolean;
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

type Source = Pick<ShipmentWithDetails, 'status' | 'started_at' | 'delivered_at' | 'ended_at' | 'stops' | 'readings' | 'locations' | 'sessions' | 'events'>;

export function tripSummary(s: Source, now: number, lang: Lang): TripSummary {
  const readings = s.readings;
  const temps = readings.map((r) => Number(r.temperature_c)).filter(Number.isFinite);
  const alerts = readings.filter((r) => r.is_alert).length;
  const progress = stopProgress(s.stops);
  const active = activeTripMs(s, now);
  const coverage = gpsCoverage(s.locations, active);
  const newest = [...s.locations].sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0];
  return {
    elapsedMs: active,
    timingEstimated: s.sessions === undefined ? !!s.started_at : s.sessions.some(session => session.is_legacy),
    waitingApprovalMs: approvalWaitMs(s.events, now, s.status === 'ended_early' ? s.ended_at : null),
    gpsSamples: coverage.samples, gpsCoveragePct: coverage.percent, distanceIncomplete: coverage.incomplete,
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
