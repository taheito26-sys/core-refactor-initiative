export type LiquidityPublishMode = 'exact' | 'range' | 'status';
export type LiquidityStatus = 'available' | 'limited' | 'unavailable';

export interface LiquiditySideConfig {
  enabled: boolean;
  mode: LiquidityPublishMode;
  exactAmount: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
  status: LiquidityStatus;
  reserveBuffer: number;
}

export interface LiquidityPublishProfile {
  merchantId: string;
  publishCashEnabled: boolean;
  publishUsdtEnabled: boolean;
  publishedCashAmount: number | null;
  publishedUsdtAmount: number | null;
  cashPublishMode: LiquidityPublishMode;
  usdtPublishMode: LiquidityPublishMode;
  cashRangeMin: number | null;
  cashRangeMax: number | null;
  usdtRangeMin: number | null;
  usdtRangeMax: number | null;
  cashStatus: LiquidityStatus;
  usdtStatus: LiquidityStatus;
  reserveBufferCash: number;
  reserveBufferUsdt: number;
  visibilityScope: 'relationships' | 'network';
  autoSyncEnabled: boolean;
  lastPublishedAt: string | null;
  expiresAt: string | null;
  status: 'active' | 'paused' | 'expired';
}

export interface InternalLiquiditySnapshot {
  cashAvailable: number;
  usdtAvailable: number;
  reservedCash: number;
  reservedUsdt: number;
}

export interface LiquidityBoardEntry {
  merchantId: string;
  relationshipId: string | null;
  merchantName: string;
  relationshipStatus: string;
  region: string | null;
  cash: LiquiditySideConfig;
  usdt: LiquiditySideConfig;
  updatedAt: string;
  expiresAt: string | null;
  isStale: boolean;
}

export interface LiquidityFilters {
  side: 'cash' | 'usdt' | 'both';
  minAmount: number;
  relationship: 'all' | 'active' | 'pending';
  updatedRecentlyHours: number | null;
}

export function computePublishedExact(input: {
  exactAmount: number | null;
  reserveBuffer: number;
  internalAvailable?: number;
  reservedCommitments?: number;
}): number {
  const exact = Math.max(0, Number(input.exactAmount || 0));
  const reserve = Math.max(0, Number(input.reserveBuffer || 0));
  const commitments = Math.max(0, Number(input.reservedCommitments || 0));
  const internalCap = input.internalAvailable == null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Number(input.internalAvailable));
  return Math.max(0, Math.min(exact, internalCap) - reserve - commitments);
}

export function computePublishedRange(input: {
  minAmount: number | null;
  maxAmount: number | null;
  reserveBuffer: number;
  internalAvailable?: number;
  reservedCommitments?: number;
}): { min: number; max: number } {
  const minRaw = Math.max(0, Number(input.minAmount || 0));
  const maxRaw = Math.max(minRaw, Number(input.maxAmount || 0));
  const reserve = Math.max(0, Number(input.reserveBuffer || 0));
  const commitments = Math.max(0, Number(input.reservedCommitments || 0));
  const internalCap = input.internalAvailable == null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Number(input.internalAvailable));
  const adjustedMin = Math.max(0, Math.min(minRaw, internalCap) - reserve - commitments);
  const adjustedMax = Math.max(adjustedMin, Math.min(maxRaw, internalCap) - reserve - commitments);
  return { min: adjustedMin, max: adjustedMax };
}

export function isLiquidityStale(updatedAt: string | null, expiresAt: string | null, now = Date.now()): boolean {
  if (expiresAt) {
    return new Date(expiresAt).getTime() <= now;
  }
  if (!updatedAt) return true;
  return now - new Date(updatedAt).getTime() > 1000 * 60 * 60 * 24;
}

export function isLiquiditySufficient(side: LiquiditySideConfig, minAmount: number): boolean {
  if (!side.enabled) return false;
  if (side.mode === 'status') return side.status !== 'unavailable';
  if (side.mode === 'range') return Math.max(0, side.rangeMax || 0) >= minAmount;
  return Math.max(0, side.exactAmount || 0) >= minAmount;
}

export function rankLiquidityEntries(entries: LiquidityBoardEntry[], side: 'cash' | 'usdt', requestedAmount: number): LiquidityBoardEntry[] {
  const relationshipScore = (status: string) => status === 'active' ? 2 : status === 'pending' ? 1 : 0;
  return [...entries].sort((a, b) => {
    const aSide = side === 'cash' ? a.cash : a.usdt;
    const bSide = side === 'cash' ? b.cash : b.usdt;
    const aSufficient = isLiquiditySufficient(aSide, requestedAmount) ? 1 : 0;
    const bSufficient = isLiquiditySufficient(bSide, requestedAmount) ? 1 : 0;
    if (aSufficient !== bSufficient) return bSufficient - aSufficient;
    const relDiff = relationshipScore(b.relationshipStatus) - relationshipScore(a.relationshipStatus);
    if (relDiff !== 0) return relDiff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function aggregateLiquidityOverview(entries: LiquidityBoardEntry[], now = Date.now()) {
  const active = entries.filter((entry) => !isLiquidityStale(entry.updatedAt, entry.expiresAt, now));
  const staleCount = entries.length - active.length;

  const totalCashAvailable = active.reduce((sum, entry) => {
    if (!entry.cash.enabled) return sum;
    if (entry.cash.mode === 'exact') return sum + Number(entry.cash.exactAmount || 0);
    if (entry.cash.mode === 'range') return sum + Number(entry.cash.rangeMin || 0);
    return sum;
  }, 0);

  const totalUsdtAvailable = active.reduce((sum, entry) => {
    if (!entry.usdt.enabled) return sum;
    if (entry.usdt.mode === 'exact') return sum + Number(entry.usdt.exactAmount || 0);
    if (entry.usdt.mode === 'range') return sum + Number(entry.usdt.rangeMin || 0);
    return sum;
  }, 0);

  const mostRecentUpdate = active
    .map((entry) => new Date(entry.updatedAt).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0] || null;

  return {
    totalCashAvailable,
    totalUsdtAvailable,
    activeMerchantsCount: active.length,
    staleCount,
    mostRecentUpdate,
  };
}

export function buildLiquidityActions(relationshipId: string | null) {
  if (!relationshipId) {
    return {
      workspacePath: null,
      chatPath: null,
      dealPath: null,
    };
  }

  return {
    workspacePath: `/merchants/${relationshipId}`,
    chatPath: `/trading/merchants?tab=chat&relationship=${relationshipId}`,
    dealPath: `/trading/orders?relationship=${relationshipId}`,
  };
}

export function filterLiquidityEntries(entries: LiquidityBoardEntry[], filters: LiquidityFilters): LiquidityBoardEntry[] {
  const now = Date.now();
  const recentThreshold = filters.updatedRecentlyHours != null
    ? now - filters.updatedRecentlyHours * 60 * 60 * 1000
    : null;

  return entries.filter((entry) => {
    if (filters.relationship !== 'all' && entry.relationshipStatus !== filters.relationship) {
      return false;
    }

    if (recentThreshold != null && new Date(entry.updatedAt).getTime() < recentThreshold) {
      return false;
    }

    if (filters.side === 'cash') return isLiquiditySufficient(entry.cash, filters.minAmount);
    if (filters.side === 'usdt') return isLiquiditySufficient(entry.usdt, filters.minAmount);
    return isLiquiditySufficient(entry.cash, filters.minAmount) || isLiquiditySufficient(entry.usdt, filters.minAmount);
  });
}
