import { P2POffer, P2PSnapshot, P2PHistoryPoint, DaySummary } from '../types';
import { format } from 'date-fns';
import { classifyPaymentMethods } from './paymentMethodClassifier';

type UnknownRecord = Record<string, unknown>;

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

function asRecord(value: unknown): UnknownRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as UnknownRecord;
  return null;
}

function readPath(source: UnknownRecord, path: string[]): unknown {
  let current: unknown = source;
  for (const part of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[part];
  }
  return current;
}

function firstPathValue(source: UnknownRecord, paths: string[][]): unknown {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value != null) return value;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function toOnlineStatus(value: unknown): 'online' | 'offline' | 'unknown' | null {
  if (typeof value === 'boolean') return value ? 'online' : 'offline';
  if (typeof value === 'number') {
    if (value === 1) return 'online';
    if (value === 0) return 'offline';
  }
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v === 'online') return 'online';
    if (v === 'offline') return 'offline';
    if (v === 'unknown') return 'unknown';
    if (v === 'true' || v === '1') return 'online';
    if (v === 'false' || v === '0') return 'offline';
  }
  return null;
}

function toMethods(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const methods: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      methods.push(item);
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const label = toStringOrNull(
      record.tradeMethodName ??
      record.identifier ??
      record.methodName ??
      record.name ??
      record.displayName
    );
    if (label) methods.push(label);
  }
  return methods;
}

function extractOfferArray(source: UnknownRecord, key: 'sellOffers' | 'buyOffers'): unknown[] {
  const altKey = key === 'sellOffers' ? 'sell_offers' : 'buy_offers';
  const values = [
    source[key],
    source[altKey],
    readPath(source, ['offers', key === 'sellOffers' ? 'sell' : 'buy']),
  ];
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function merchantKey(nick: string): string {
  return nick.trim().toLowerCase();
}

export function computeDistinctMerchantAverage(
  offers: P2POffer[],
  direction: 'highest' | 'lowest',
  limit = 20
): number | null {
  const best = new Map<string, number>();
  for (const offer of offers) {
    const key = merchantKey(offer.nick);
    if (!key) continue;
    const existing = best.get(key);
    const shouldReplace = existing == null
      || (direction === 'highest' ? offer.price > existing : offer.price < existing);
    if (shouldReplace) best.set(key, offer.price);
  }

  const prices = Array.from(best.values())
    .sort((a, b) => direction === 'highest' ? b - a : a - b)
    .slice(0, limit);

  return prices.length > 0
    ? prices.reduce((sum, price) => sum + price, 0) / prices.length
    : null;
}

export function toOffer(value: unknown): P2POffer | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const advertiser = asRecord(source.advertiser);
  const adv = asRecord(source.adv);
  const price = toFiniteNumber(source.price ?? adv?.price);
  if (price === null) return null;

  const methods = toMethods(source.methods ?? adv?.tradeMethods);

  const merchant30dTrades = toFiniteNumber(
    firstPathValue(source, [
      ['merchant30dTrades'],
      ['monthOrderCount'],
      ['monthlyOrderCount'],
      ['tradeCount30d'],
      ['advertiser', 'monthOrderCount'],
      ['advertiser', 'monthlyOrderCount'],
      ['advertiser', 'tradeCount30d'],
      ['merchant', 'monthOrderCount'],
    ])
  );
  const merchant30dCompletion = toFiniteNumber(
    firstPathValue(source, [
      ['merchant30dCompletion'],
      ['monthFinishRate'],
      ['monthlyFinishRate'],
      ['completionRate30d'],
      ['advertiser', 'monthFinishRate'],
      ['advertiser', 'monthlyFinishRate'],
      ['advertiser', 'completionRate30d'],
      ['merchant', 'monthFinishRate'],
    ])
  );
  const advertiserMessage = toStringOrNull(
    firstPathValue(source, [
      ['advertiserMessage'],
      ['advertiserInfo'],
      ['advertContent'],
      ['advertiserContent'],
      ['adv', 'remark'],
      ['adv', 'remarks'],
      ['adv', 'autoReplyMsg'],
      ['adv', 'additionalInfo'],
      ['adv', 'advertiserTerms'],
    ])
  );
  const feedbackCount = toFiniteNumber(
    firstPathValue(source, [
      ['feedbackCount'],
      ['positiveCount'],
      ['positiveFeedbackCount'],
      ['userPositiveCount'],
      ['advertiser', 'positiveCount'],
      ['advertiser', 'positiveFeedbackCount'],
      ['advertiser', 'userPositiveCount'],
    ])
  );
  const avgReleaseMinutes = toFiniteNumber(
    firstPathValue(source, [
      ['avgReleaseMinutes'],
      ['avgReleaseTime'],
      ['releaseTime'],
      ['advertiser', 'avgReleaseTime'],
      ['advertiser', 'avgReleaseMinutes'],
      ['advertiser', 'releaseTime'],
    ])
  );
  const avgPayMinutes = toFiniteNumber(
    firstPathValue(source, [
      ['avgPayMinutes'],
      ['avgPayTime'],
      ['payTime'],
      ['advertiser', 'avgPayTime'],
      ['advertiser', 'avgPayMinutes'],
      ['advertiser', 'payTime'],
    ])
  );
  const allTrades = toFiniteNumber(
    firstPathValue(source, [
      ['allTrades'],
      ['tradeCount'],
      ['totalTrades'],
      ['totalOrderCount'],
      ['advertiser', 'totalOrderCount'],
      ['advertiser', 'totalTrades'],
      ['advertiser', 'tradeCount'],
    ])
  );
  const tradeType = toStringOrNull(
    firstPathValue(source, [
      ['tradeType'],
      ['tradeTypeName'],
      ['adv', 'tradeType'],
      ['adv', 'tradeTypeName'],
    ])
  );
  const onlineStatus = toOnlineStatus(
    firstPathValue(source, [
      ['onlineStatus'],
      ['userOnlineStatus'],
      ['isOnline'],
      ['advertiser', 'onlineStatus'],
      ['advertiser', 'userOnlineStatus'],
      ['advertiser', 'isOnline'],
    ])
  );

  return {
    price,
    min: toFiniteNumber(source.min ?? adv?.minSingleTransAmount) ?? 0,
    max: toFiniteNumber(source.max ?? adv?.maxSingleTransAmount) ?? 0,
    nick: toStringOrNull(source.nick ?? advertiser?.nickName ?? advertiser?.nickname) ?? 'Unknown trader',
    methods,
    available: toFiniteNumber(source.available ?? adv?.surplusAmount) ?? 0,
    trades: toFiniteNumber(source.trades ?? advertiser?.monthOrderCount) ?? 0,
    completion: toFiniteNumber(source.completion ?? advertiser?.monthFinishRate) ?? 0,
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
    // Map head legacy field names
    feedback: feedbackCount ?? undefined,
    status: onlineStatus ?? undefined,
    avgPay: avgPayMinutes ?? undefined,
    avgRelease: avgReleaseMinutes ?? undefined,
    allTimeTrades: allTrades ?? undefined,
    message: advertiserMessage ?? undefined,
  };
}

export function toSnapshot(value: unknown, fetchedAt?: string): P2PSnapshot {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const ts = normalizeSnapshotTimestamp(source.ts, fetchedAt);

  const rawSellAvg = toFiniteNumber(source.sellAvg);
  const rawBuyAvg = toFiniteNumber(source.buyAvg);
  const isSwapped = rawSellAvg != null && rawBuyAvg != null && rawSellAvg < rawBuyAvg;

  const sellOffersRaw = extractOfferArray(source, 'sellOffers').map(toOffer).filter((o): o is P2POffer => o !== null);
  const buyOffersRaw = extractOfferArray(source, 'buyOffers').map(toOffer).filter((o): o is P2POffer => o !== null);

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
      if (excludeCategories && cats.some(c => excludeCategories.has(c))) return false;
      return true;
    });

  const filteredSell = filterOffers(snapshot.sellOffers);
  const filteredBuy = filterOffers(snapshot.buyOffers);

  const sellAvg = computeDistinctMerchantAverage(filteredSell, 'highest');
  const buyAvg = computeDistinctMerchantAverage(filteredBuy, 'lowest');
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