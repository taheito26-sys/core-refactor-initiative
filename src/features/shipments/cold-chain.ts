import type { ShipmentReading } from './types';

export type ColdChainBand = 'stable' | 'watch' | 'risk' | 'none';

export interface ColdChainStats {
  readingCount: number;
  inRangeCount: number;
  alertCount: number;
  /** Share of readings inside the allowed range, 0-100. Null with no readings. */
  inRangePct: number | null;
  minC: number | null;
  maxC: number | null;
  avgC: number | null;
  /** Population standard deviation, °C. */
  stdC: number | null;
  spreadC: number | null;
  /** Runs of consecutive out-of-range readings, not the number of bad readings. */
  excursionCount: number;
  /** Longest run, from its first bad reading to the next good reading (or now if it is still open). */
  longestExcursionMs: number;
  /** 0-100: mostly in-range, with penalties for instability and repeated excursions. */
  score: number;
  band: ColdChainBand;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The cold-chain view of a trip: how much of the record stayed inside the allowed band, how wide
 * the temperature spread was, and whether the excursions were isolated or repeated.
 */
export function coldChainStats(
  readings: ShipmentReading[],
  targetC: number,
  toleranceC: number,
  now: number,
): ColdChainStats {
  const points = [...readings]
    .filter((r) => Number.isFinite(Number(r.temperature_c)))
    .sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime());
  const temps = points.map((r) => Number(r.temperature_c));
  const readingCount = points.length;
  const alertCount = points.filter((r) => r.is_alert).length;
  const inRangeCount = readingCount - alertCount;
  const inRangePct = readingCount ? Math.round((inRangeCount / readingCount) * 100) : null;

  const minC = temps.length ? Math.min(...temps) : null;
  const maxC = temps.length ? Math.max(...temps) : null;
  const avgC = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const variance = avgC === null ? null : temps.reduce((a, b) => a + (b - avgC) ** 2, 0) / temps.length;
  const stdC = variance === null ? null : Math.sqrt(variance);
  const spreadC = minC === null || maxC === null ? null : maxC - minC;

  let excursionCount = 0;
  let longestExcursionMs = 0;
  let runStart: number | null = null;
  let lastAlertAt: number | null = null;

  for (const point of points) {
    const at = new Date(point.taken_at).getTime();
    if (point.is_alert) {
      if (runStart === null) {
        runStart = at;
        excursionCount += 1;
      }
      lastAlertAt = at;
    } else if (runStart !== null) {
      longestExcursionMs = Math.max(longestExcursionMs, Math.max(0, at - runStart));
      runStart = null;
      lastAlertAt = null;
    }
  }
  if (runStart !== null) {
    longestExcursionMs = Math.max(longestExcursionMs, Math.max(0, now - (lastAlertAt ?? runStart)));
  }

  const instabilityPenalty = stdC === null ? 0 : Math.min(25, (stdC / Math.max(toleranceC, 0.1)) * 15);
  const excursionPenalty = Math.min(20, excursionCount * 4);
  const score = readingCount
    ? Math.round(clamp((inRangePct ?? 0) - instabilityPenalty - excursionPenalty, 0, 100))
    : 0;
  const band: ColdChainBand = !readingCount ? 'none' : score >= 90 ? 'stable' : score >= 70 ? 'watch' : 'risk';

  return {
    readingCount,
    inRangeCount,
    alertCount,
    inRangePct,
    minC: minC === null ? null : round1(minC),
    maxC: maxC === null ? null : round1(maxC),
    avgC: avgC === null ? null : round1(avgC),
    stdC: stdC === null ? null : round1(stdC),
    spreadC: spreadC === null ? null : round1(spreadC),
    excursionCount,
    longestExcursionMs,
    score,
    band,
  };
}
