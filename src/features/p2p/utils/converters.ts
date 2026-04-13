import { P2POffer, P2PSnapshot, P2PHistoryPoint, DaySummary } from '../types';
import { format } from 'date-fns';
import { classifyPaymentMethods } from './paymentMethodClassifier';

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeSnapshotTimestamp(rawTs: unknown, fetchedAt?: string): number {
  const fetchedAtMs = fetchedAt ? new Date(fetchedAt).getTime() : null;
  const hasValidFetchedAt = fetchedAtMs != null && Number.isFinite(fetchedAtMs);

  const raw = toFiniteNumber(rawTs);
  if (raw == null || !Number.isFinite(raw)) {
    return hasValidFetchedAt ? fetchedAtMs : Date.now();
  }

  const normalizedRaw = raw < 1e12 ? raw * 1000 : raw;
  if (!Number.isFinite(normalizedRaw)) {
    return hasValidFetchedAt ? fetchedAtMs : Date.now();
  }

  if (hasValidFetchedAt) {
    const driftMs = Math.abs(normalizedRaw - fetchedAtMs);
    const suspiciousDriftMs = 12 * 60 * 60 * 1000; // 12h
    if (driftMs > suspiciousDriftMs) return fetchedAtMs;
  }

  return normalizedRaw;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function toOnlineStatus(value: unknown): 'online' | 'offline' | 'unknown' | null {
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v === 'online') return 'online';
    if (v === 'offline') return 'offline';
    if (v === 'unknown') return 'unknown';
  }
  return null;
}

export function toOffer(value: unknown): P2POffer | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const price = toFiniteNumber(source.price);
  if (price === null) return null;

  const methods = Array.isArray(source.methods)
    ? source.methods.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    : [];

  // Parse merchant intelligence fields with multiple upstream key fallbacks
  const merchant30dTrades = toFiniteNumber(
    source.merchant30dTrades ?? source.monthOrderCount ?? source.monthlyOrderCount ?? source.tradeCount30d
  );
  const merchant30dCompletion = toFiniteNumber(
    source.merchant30dCompletion ?? source.monthFinishRate ?? source.monthlyFinishRate ?? source.completionRate30d
  );
  const advertiserMessage = toStringOrNull(
    source.advertiserMessage ?? source.advertiserInfo ?? source.advertContent ?? source.advertiserContent
  );
  const feedbackCount = toFiniteNumber(
    source.feedbackCount ?? source.positiveCount ?? source.positiveFeedbackCount ?? source.userPositiveCount
  );
  const avgReleaseMinutes = toFiniteNumber(
    source.avgReleaseMinutes ?? source.avgReleaseTime ?? source.releaseTime
  );
  const avgPayMinutes = toFiniteNumber(
    source.avgPayMinutes ?? source.avgPayTime ?? source.payTime
  );
  const allTrades = toFiniteNumber(
    source.allTrades ?? source.tradeCount ?? source.totalTrades ?? source.totalOrderCount
  );
  const tradeType = toStringOrNull(source.tradeType ?? source.tradeTypeName);
  const onlineStatus = toOnlineStatus(
    source.onlineStatus ?? source.userOnlineStatus ?? source.isOnline
  );

  return {
    price,
    min: toFiniteNumber(source.min) ?? 0,
    max: toFiniteNumber(source.max) ?? 0,
    nick: typeof source.nick === 'string' && source.nick.trim() ? source.nick : 'Unknown trader',
    methods,
    available: toFiniteNumber(source.available) ?? 0,
    trades: toFiniteNumber(source.trades) ?? 0,
    completion: toFiniteNumber(source.completion) ?? 0,
    merchant30dTrades,
    merchant30dCompletion,
    advertiserMessage,
    feedbackCount,
    avgReleaseMinutes,
    avgPayMinutes,
    allTrades,
    tradeType,
    onlineStatus,
    paymentMethodCategories: classifyPaymentMethods(methods),
  };
}

export function toSnapshot(value: unknown, fetchedAt?: string): P2PSnapshot {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const ts = normalizeSnapshotTimestamp(source.ts, fetchedAt);

  const rawSellAvg = toFiniteNumber(source.sellAvg);
  const rawBuyAvg = toFiniteNumber(source.buyAvg);
  const isSwapped = rawSellAvg != null && rawBuyAvg != null && rawSellAvg < rawBuyAvg;

  const sellOffersRaw = Array.isArray(source.sellOffers) ? source.sellOffers.map(toOffer).filter((o): o is P2POffer => o !== null) : [];
  const buyOffersRaw = Array.isArray(source.buyOffers) ? source.buyOffers.map(toOffer).filter((o): o is P2POffer => o !== null) : [];

  if (isSwapped) {
    return {
      ts,
      sellAvg: rawBuyAvg,
      buyAvg: rawSellAvg,
      bestSell: toFiniteNumber(source.bestBuy),
      bestBuy: toFiniteNumber(source.bestSell),
      spread: rawBuyAvg != null && rawSellAvg != null ? rawBuyAvg - rawSellAvg : null,
      spreadPct: rawBuyAvg != null && rawSellAvg != null && rawSellAvg > 0 ? ((rawBuyAvg - rawSellAvg) / rawSellAvg) * 100 : null,
      sellDepth: toFiniteNumber(source.buyDepth) ?? 0,
      buyDepth: toFiniteNumber(source.sellDepth) ?? 0,
      sellOffers: buyOffersRaw.sort((a, b) => b.price - a.price),
      buyOffers: sellOffersRaw.sort((a, b) => a.price - b.price),
    };
  }

  return {
    ts,
    sellAvg: rawSellAvg,
    buyAvg: rawBuyAvg,
    bestSell: toFiniteNumber(source.bestSell),
    bestBuy: toFiniteNumber(source.bestBuy),
    spread: toFiniteNumber(source.spread),
    spreadPct: toFiniteNumber(source.spreadPct),
    sellDepth: toFiniteNumber(source.sellDepth) ?? 0,
    buyDepth: toFiniteNumber(source.buyDepth) ?? 0,
    sellOffers: sellOffersRaw,
    buyOffers: buyOffersRaw,
  };
}

/**
 * Filter a snapshot's offers by payment method categories.
 * Recomputes averages from up to 20 distinct eligible merchants.
 */
export function filterSnapshotByPaymentMethods(
  snapshot: P2PSnapshot,
  allowedCategories: Set<string>,
  excludeCategories?: Set<string>
): P2PSnapshot {
  const filterOffers = (offers: P2POffer[]): P2POffer[] =>
    offers.filter(o => {
      const cats = o.paymentMethodCategories ?? [];
      if (cats.length === 0) return false;
      const hasAllowed = cats.some(c => allowedCategories.has(c));
      if (!hasAllowed) return false;
      if (excludeCategories) {
        const allExcluded = cats.every(c => excludeCategories.has(c));
        if (allExcluded) return false;
      }
      return true;
    });

  const filteredSell = filterOffers(snapshot.sellOffers);
  const filteredBuy = filterOffers(snapshot.buyOffers);

  const computeAvg20 = (offers: P2POffer[]): number | null => {
    const best = new Map<string, number>();
    for (const o of offers) {
      const nick = o.nick.trim();
      const existing = best.get(nick);
      if (existing == null || o.price > existing) best.set(nick, o.price);
    }
    const prices = Array.from(best.values()).sort((a, b) => b - a).slice(0, 20);
    return prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : null;
  };

  const sellAvg = computeAvg20(filteredSell);
  const buyAvg = computeAvg20(filteredBuy);
  const bestSell = filteredSell.length ? Math.max(...filteredSell.map(o => o.price)) : null;
  const bestBuy = filteredBuy.length ? Math.min(...filteredBuy.map(o => o.price)) : null;
  const spread = sellAvg != null && buyAvg != null ? sellAvg - buyAvg : null;
  const spreadPct = sellAvg != null && buyAvg != null && buyAvg > 0 ? ((sellAvg - buyAvg) / buyAvg) * 100 : null;

  return {
    ...snapshot,
    sellOffers: filteredSell,
    buyOffers: filteredBuy,
    sellAvg,
    buyAvg,
    bestSell,
    bestBuy,
    spread,
    spreadPct,
    sellDepth: filteredSell.reduce((s, o) => s + o.available, 0),
    buyDepth: filteredBuy.reduce((s, o) => s + o.available, 0),
  };
}

export function computeDailySummaries(history: P2PHistoryPoint[]): DaySummary[] {
  const byDate = new Map<string, DaySummary>();
  for (const pt of history) {
    const date = format(new Date(pt.ts), 'yyyy-MM-dd');
    let day = byDate.get(date);
    if (!day) {
      day = { date, highSell: 0, lowSell: null, highBuy: 0, lowBuy: null, polls: 0 };
      byDate.set(date, day);
    }
    if (pt.sellAvg != null) {
      day.highSell = Math.max(day.highSell, pt.sellAvg);
      day.lowSell = day.lowSell === null ? pt.sellAvg : Math.min(day.lowSell, pt.sellAvg);
    }
    if (pt.buyAvg != null) {
      day.highBuy = Math.max(day.highBuy, pt.buyAvg);
      day.lowBuy = day.lowBuy === null ? pt.buyAvg : Math.min(day.lowBuy, pt.buyAvg);
    }
    day.polls++;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
