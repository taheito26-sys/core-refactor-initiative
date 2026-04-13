// P2P Market — Converter Safeguards
// Handles timestamp drift, swapped-side correction, ratio normalization

import type { P2POffer, P2PSnapshot } from '../types';
import { EMPTY_SNAPSHOT } from '../types';

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Normalize completion/feedback: if >1 assume percent-style, divide by 100
function normalizeRatio(v: number | null): number | null {
  if (v === null) return null;
  if (v > 1) return v / 100;
  return v;
}

export function toOffer(value: unknown): P2POffer | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  const price = toFiniteNumber(s.price);
  if (price === null) return null;

  const completion = normalizeRatio(toFiniteNumber(s.completion)) ?? 0;
  const rawFeedback = normalizeRatio(toFiniteNumber(s.feedback));
  const rawAvgPay = toFiniteNumber(s.avgPay);
  const rawAvgRelease = toFiniteNumber(s.avgRelease);
  const rawAllTime = toFiniteNumber(s.allTimeTrades);

  return {
    price,
    min: toFiniteNumber(s.min) ?? 0,
    max: toFiniteNumber(s.max) ?? 0,
    nick: typeof s.nick === 'string' && s.nick.trim() ? s.nick : 'Unknown',
    methods: Array.isArray(s.methods)
      ? s.methods.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      : [],
    available: toFiniteNumber(s.available) ?? 0,
    trades: toFiniteNumber(s.trades) ?? 0,
    completion,
    ...(rawFeedback != null      && { feedback:      rawFeedback }),
    ...(typeof s.status === 'string' && s.status && { status: s.status }),
    ...(rawAvgPay   != null && { avgPay:       rawAvgPay }),
    ...(rawAvgRelease != null && { avgRelease: rawAvgRelease }),
    ...(rawAllTime  != null && { allTimeTrades: rawAllTime }),
    ...(typeof s.tradeType === 'string' && s.tradeType && { tradeType: s.tradeType }),
    ...(typeof s.message   === 'string' && s.message.trim() && { message: s.message }),
  };
}

export function toSnapshot(value: unknown, fetchedAt?: string): P2PSnapshot {
  const source =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  // Timestamp normalization with drift correction against fetched_at
  const fetchedMs = fetchedAt ? new Date(fetchedAt).getTime() : null;
  let ts = toFiniteNumber(source.ts);
  // If ts is missing or drifts >1h from fetched_at, use fetched_at
  if (ts === null || (fetchedMs && Math.abs(ts - fetchedMs) > 60 * 60 * 1000)) {
    ts = fetchedMs ?? Date.now();
  }

  const rawSellAvg = toFiniteNumber(source.sellAvg);
  const rawBuyAvg  = toFiniteNumber(source.buyAvg);

  // Auto-detect swapped orientation: if sellAvg < buyAvg the sides are inverted
  const isSwapped =
    rawSellAvg != null && rawBuyAvg != null && rawSellAvg < rawBuyAvg;

  const sellOffersRaw = Array.isArray(source.sellOffers)
    ? source.sellOffers.map(toOffer).filter((o): o is P2POffer => o !== null)
    : [];
  const buyOffersRaw = Array.isArray(source.buyOffers)
    ? source.buyOffers.map(toOffer).filter((o): o is P2POffer => o !== null)
    : [];

  if (isSwapped) {
    // Swap everything: historical data had sell/buy reversed
    return {
      ts,
      sellAvg:   rawBuyAvg,
      buyAvg:    rawSellAvg,
      bestSell:  toFiniteNumber(source.bestBuy),
      bestBuy:   toFiniteNumber(source.bestSell),
      spread:
        rawBuyAvg != null && rawSellAvg != null ? rawBuyAvg - rawSellAvg : null,
      spreadPct:
        rawBuyAvg != null && rawSellAvg != null && rawSellAvg > 0
          ? ((rawBuyAvg - rawSellAvg) / rawSellAvg) * 100
          : null,
      sellDepth: toFiniteNumber(source.buyDepth)  ?? 0,
      buyDepth:  toFiniteNumber(source.sellDepth) ?? 0,
      sellOffers: buyOffersRaw.sort((a, b) => b.price - a.price),
      buyOffers:  sellOffersRaw.sort((a, b) => a.price - b.price),
    };
  }

  return {
    ts,
    sellAvg:   rawSellAvg,
    buyAvg:    rawBuyAvg,
    bestSell:  toFiniteNumber(source.bestSell),
    bestBuy:   toFiniteNumber(source.bestBuy),
    spread:    toFiniteNumber(source.spread),
    spreadPct: toFiniteNumber(source.spreadPct),
    sellDepth: toFiniteNumber(source.sellDepth) ?? 0,
    buyDepth:  toFiniteNumber(source.buyDepth)  ?? 0,
    sellOffers: sellOffersRaw,
    buyOffers:  buyOffersRaw,
  };
}

// Export EMPTY_SNAPSHOT re-export for convenience
export { EMPTY_SNAPSHOT };
