import { P2POffer, P2PSnapshot, P2PHistoryPoint, DaySummary } from '../types';
import { format } from 'date-fns';

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

export function toOffer(value: unknown): P2POffer | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const price = toFiniteNumber(source.price);
  if (price === null) return null;
  return {
    price,
    min: toFiniteNumber(source.min) ?? 0,
    max: toFiniteNumber(source.max) ?? 0,
    nick: typeof source.nick === 'string' && source.nick.trim() ? source.nick : 'Unknown trader',
    methods: Array.isArray(source.methods)
      ? source.methods.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      : [],
    available: toFiniteNumber(source.available) ?? 0,
    trades: toFiniteNumber(source.trades) ?? 0,
    completion: toFiniteNumber(source.completion) ?? 0,
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