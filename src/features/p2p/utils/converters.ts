import { format } from 'date-fns';
import { DaySummary, P2POffer, P2PHistoryPoint, P2PSnapshot } from '../types';

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeSnapshotTimestamp(rawTs: unknown, fetchedAt?: string): number {
  const fetchedAtMs = fetchedAt ? new Date(fetchedAt).getTime() : null;
  const hasValidFetchedAt = fetchedAtMs != null && Number.isFinite(fetchedAtMs);

  const raw = toFiniteNumber(rawTs);
  if (raw == null) return hasValidFetchedAt ? fetchedAtMs : Date.now();

  const normalizedRaw = raw < 1e12 ? raw * 1000 : raw;
  if (!Number.isFinite(normalizedRaw)) {
    return hasValidFetchedAt ? fetchedAtMs : Date.now();
  }

  if (hasValidFetchedAt) {
    const driftMs = Math.abs(normalizedRaw - fetchedAtMs);
    if (driftMs > 12 * 60 * 60 * 1000) return fetchedAtMs;
  }

  return normalizedRaw;
}

function normalizeRatio(value: number | null): number | null {
  if (value == null) return null;
  if (value > 1 && value <= 100) return value / 100;
  return value;
}

function readRecord(source: Record<string, unknown> | undefined, key: string): unknown {
  return source ? source[key] : undefined;
}

function readNestedRecord(source: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const label = readString(
        readRecord(record, 'tradeMethodName') ??
        readRecord(record, 'name') ??
        readRecord(record, 'methodName') ??
        readRecord(record, 'identifier') ??
        readRecord(record, 'code') ??
        readRecord(record, 'label')
      );
      return label ? [label] : [];
    }
    return [];
  });
}

function readMethods(source: Record<string, unknown>): string[] {
  const nested = readNestedRecord(source, 'advertiser', 'adv');
  const fromRoot = readStringArray(readRecord(source, 'methods'));
  const fromTradeMethods = readStringArray(readRecord(source, 'tradeMethods'));
  const fromNestedMethods = nested ? readStringArray(readRecord(nested, 'tradeMethods')) : [];
  const fromNestedAlt = nested ? readStringArray(readRecord(nested, 'methods')) : [];
  return [...fromRoot, ...fromTradeMethods, ...fromNestedMethods, ...fromNestedAlt].filter(Boolean);
}

function readMerchantNick(source: Record<string, unknown>): string {
  const nested = readNestedRecord(source, 'advertiser', 'adv');
  return (
    readString(readRecord(source, 'nick')) ??
    readString(readRecord(source, 'merchantName')) ??
    readString(readRecord(source, 'merchant_name')) ??
    readString(readRecord(source, 'advertiserName')) ??
    readString(readRecord(source, 'advertiserNickName')) ??
    readString(readRecord(source, 'nickname')) ??
    readString(readRecord(nested, 'nick')) ??
    readString(readRecord(nested, 'merchantName')) ??
    readString(readRecord(nested, 'merchant_name')) ??
    readString(readRecord(nested, 'advertiserName')) ??
    'Unknown trader'
  );
}

function readMerchantMessage(source: Record<string, unknown>): string | undefined {
  const nested = readNestedRecord(source, 'advertiser', 'adv');
  const message = readString(
    readRecord(source, 'message') ??
    readRecord(source, 'advertiserMessage') ??
    readRecord(source, 'advertiserInfo') ??
    readRecord(source, 'advertContent') ??
    readRecord(source, 'advertiserContent') ??
    readRecord(source, 'remark') ??
    readRecord(source, 'remarks') ??
    readRecord(source, 'autoReplyMsg') ??
    readRecord(source, 'additionalInfo') ??
    readRecord(source, 'advertiserTerms') ??
    readRecord(nested, 'message') ??
    readRecord(nested, 'advertiserMessage') ??
    readRecord(nested, 'advertiserInfo') ??
    readRecord(nested, 'remark') ??
    readRecord(nested, 'remarks') ??
    readRecord(nested, 'autoReplyMsg') ??
    readRecord(nested, 'additionalInfo') ??
    readRecord(nested, 'advertiserTerms')
  );
  return message ?? undefined;
}

function readOfferNumber(source: Record<string, unknown>, keys: string[], nested?: Record<string, unknown>): number | null {
  const values: unknown[] = [];
  for (const key of keys) values.push(readRecord(source, key));
  if (nested) {
    for (const key of keys) values.push(readRecord(nested, key));
  }
  return readNumber(...values);
}

function readOfferStatus(source: Record<string, unknown>): string | undefined {
  const nested = readNestedRecord(source, 'advertiser', 'adv');
  return (
    readString(readRecord(source, 'status')) ??
    readString(readRecord(source, 'onlineStatus')) ??
    readString(readRecord(source, 'userOnlineStatus')) ??
    readString(readRecord(source, 'merchantStatus')) ??
    readString(readRecord(nested, 'status')) ??
    readString(readRecord(nested, 'onlineStatus')) ??
    readString(readRecord(nested, 'userOnlineStatus')) ??
    readString(readRecord(nested, 'merchantStatus')) ??
    undefined
  );
}

function readOfferTradeType(source: Record<string, unknown>): string | undefined {
  const nested = readNestedRecord(source, 'advertiser', 'adv');
  return (
    readString(readRecord(source, 'tradeType')) ??
    readString(readRecord(source, 'tradeTypeName')) ??
    readString(readRecord(nested, 'tradeType')) ??
    readString(readRecord(nested, 'tradeTypeName')) ??
    undefined
  );
}

export function toOffer(value: unknown): P2POffer | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const nested = readNestedRecord(source, 'advertiser', 'adv');
  const price = readNumber(
    readRecord(source, 'price'),
    readRecord(source, 'advPrice'),
    readRecord(nested, 'price'),
    readRecord(nested, 'advPrice'),
  );
  if (price == null) return null;

  const completion = normalizeRatio(readNumber(
    readRecord(source, 'completion'),
    readRecord(source, 'completionRate'),
    readRecord(source, 'monthFinishRate'),
    readRecord(source, 'monthlyFinishRate'),
    readRecord(source, 'finishRate'),
    readRecord(nested, 'completion'),
    readRecord(nested, 'completionRate'),
    readRecord(nested, 'monthFinishRate'),
    readRecord(nested, 'monthlyFinishRate'),
    readRecord(nested, 'finishRate'),
  )) ?? 0;

  const feedback = normalizeRatio(readNumber(
    readRecord(source, 'feedback'),
    readRecord(source, 'feedbackRate'),
    readRecord(source, 'positiveRate'),
    readRecord(source, 'positiveFeedbackRate'),
    readRecord(source, 'feedbackScore'),
    readRecord(nested, 'feedback'),
    readRecord(nested, 'feedbackRate'),
    readRecord(nested, 'positiveRate'),
    readRecord(nested, 'positiveFeedbackRate'),
    readRecord(nested, 'feedbackScore'),
  ));

  const avgPay = readNumber(
    readRecord(source, 'avgPay'),
    readRecord(source, 'avgPayMinutes'),
    readRecord(source, 'avgPayTime'),
    readRecord(source, 'payTime'),
    readRecord(source, 'avgPaymentTime'),
    readRecord(nested, 'avgPay'),
    readRecord(nested, 'avgPayMinutes'),
    readRecord(nested, 'avgPayTime'),
    readRecord(nested, 'payTime'),
    readRecord(nested, 'avgPaymentTime'),
  );

  const avgRelease = readNumber(
    readRecord(source, 'avgRelease'),
    readRecord(source, 'avgReleaseMinutes'),
    readRecord(source, 'avgReleaseTime'),
    readRecord(source, 'releaseTime'),
    readRecord(source, 'avgReleaseMinutes'),
    readRecord(nested, 'avgRelease'),
    readRecord(nested, 'avgReleaseMinutes'),
    readRecord(nested, 'avgReleaseTime'),
    readRecord(nested, 'releaseTime'),
  );

  const allTimeTrades = readNumber(
    readRecord(source, 'allTimeTrades'),
    readRecord(source, 'allTrades'),
    readRecord(source, 'tradeCount'),
    readRecord(source, 'totalTrades'),
    readRecord(source, 'totalOrderCount'),
    readRecord(nested, 'allTimeTrades'),
    readRecord(nested, 'allTrades'),
    readRecord(nested, 'tradeCount'),
    readRecord(nested, 'totalTrades'),
    readRecord(nested, 'totalOrderCount'),
  );

  const trades = readNumber(
    readRecord(source, 'trades'),
    readRecord(source, 'monthOrderCount'),
    readRecord(source, 'monthlyOrderCount'),
    readRecord(source, 'tradeCount30d'),
    readRecord(source, 'orderCount30d'),
    readRecord(nested, 'trades'),
    readRecord(nested, 'monthOrderCount'),
    readRecord(nested, 'monthlyOrderCount'),
    readRecord(nested, 'tradeCount30d'),
    readRecord(nested, 'orderCount30d'),
  ) ?? 0;

  const available = readNumber(
    readRecord(source, 'available'),
    readRecord(source, 'availableAmount'),
    readRecord(source, 'tradeAvailable'),
    readRecord(source, 'availableQty'),
    readRecord(source, 'tradableQuantity'),
    readRecord(nested, 'available'),
    readRecord(nested, 'availableAmount'),
    readRecord(nested, 'tradeAvailable'),
    readRecord(nested, 'availableQty'),
    readRecord(nested, 'tradableQuantity'),
  ) ?? 0;

  const min = readNumber(
    readRecord(source, 'min'),
    readRecord(source, 'minAmount'),
    readRecord(source, 'minTrade'),
    readRecord(nested, 'min'),
    readRecord(nested, 'minAmount'),
    readRecord(nested, 'minTrade'),
  ) ?? 0;

  const max = readNumber(
    readRecord(source, 'max'),
    readRecord(source, 'maxAmount'),
    readRecord(source, 'maxTrade'),
    readRecord(nested, 'max'),
    readRecord(nested, 'maxAmount'),
    readRecord(nested, 'maxTrade'),
  ) ?? 0;

  return {
    price,
    min,
    max,
    nick: readMerchantNick(source),
    methods: readMethods(source),
    available,
    trades,
    completion,
    ...(feedback != null ? { feedback } : {}),
    ...(readOfferStatus(source) ? { status: readOfferStatus(source) } : {}),
    ...(avgPay != null ? { avgPay } : {}),
    ...(avgRelease != null ? { avgRelease } : {}),
    ...(allTimeTrades != null ? { allTimeTrades } : {}),
    ...(readOfferTradeType(source) ? { tradeType: readOfferTradeType(source) } : {}),
    ...(readMerchantMessage(source) ? { message: readMerchantMessage(source) } : {}),
  };
}

export function toSnapshot(value: unknown, fetchedAt?: string): P2PSnapshot {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const ts = normalizeSnapshotTimestamp(source.ts, fetchedAt);

  const rawSellAvg = toFiniteNumber(source.sellAvg);
  const rawBuyAvg = toFiniteNumber(source.buyAvg);
  const isSwapped = rawSellAvg != null && rawBuyAvg != null && rawSellAvg < rawBuyAvg;

  const sellOffersRaw = Array.isArray(source.sellOffers)
    ? source.sellOffers.map(toOffer).filter((offer): offer is P2POffer => offer !== null)
    : [];
  const buyOffersRaw = Array.isArray(source.buyOffers)
    ? source.buyOffers.map(toOffer).filter((offer): offer is P2POffer => offer !== null)
    : [];

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

export function computeDistinctMerchantAverage(offers: P2POffer[], limit = 20): number | null {
  const seen = new Set<string>();
  const values: number[] = [];
  for (const offer of [...offers].sort((a, b) => a.price - b.price)) {
    const nick = offer.nick.trim();
    if (!nick || seen.has(nick)) continue;
    seen.add(nick);
    values.push(offer.price);
    if (values.length >= limit) break;
  }
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
