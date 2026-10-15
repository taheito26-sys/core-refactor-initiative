import { useEffect, useMemo, useState } from 'react';
import { rateTrend, recordRate, type RateReading, type RateTrend } from './home-model';

function readHistory(key: string): RateReading[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter(r => r && Number.isFinite(r.t) && Number.isFinite(r.v)) : [];
  } catch { return []; }
}

/**
 * The change chip and little line on a rate card. The market feed carries no
 * history, so each device remembers the readings it has seen and shows the move
 * since the oldest reading of the last day.
 */
export function useRateTrend(key: string, value: number | null): RateTrend {
  const [history, setHistory] = useState<RateReading[]>(() => readHistory(key));
  useEffect(() => {
    if (value == null) return;
    setHistory(prev => {
      const next = recordRate(prev, value, Date.now());
      if (next !== prev) { try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable: the trend lasts for this visit */ } }
      return next;
    });
  }, [key, value]);
  return useMemo(() => rateTrend(history, Date.now()), [history]);
}
