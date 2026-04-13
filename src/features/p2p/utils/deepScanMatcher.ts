import type { P2POffer } from '../types';
import type { DeepScanRequest, DeepScanCandidate, DeepScanResult } from '../types.deepScan';

export function isOfferEligibleForScan(
  offer: P2POffer,
  request: DeepScanRequest
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Full coverage check
  const effectiveMax = Math.max(offer.available, offer.max);
  if ((request.mode === 'single_merchant_only' || request.requireFullCoverage) && effectiveMax < request.requiredUsdt) {
    reasons.push(`Capacity ${effectiveMax} < required ${request.requiredUsdt}`);
  }

  // 30d trades threshold
  if (request.min30dTrades > 0) {
    const trades = offer.merchant30dTrades;
    if (trades == null || trades < request.min30dTrades) {
      reasons.push(`30d trades ${trades ?? '—'} < min ${request.min30dTrades}`);
    }
  }

  // Completion rate threshold
  if (request.minCompletionPct > 0) {
    const comp = offer.merchant30dCompletion;
    if (comp == null || comp < request.minCompletionPct) {
      reasons.push(`Completion ${comp != null ? comp.toFixed(1) + '%' : '—'} < min ${request.minCompletionPct}%`);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

const RISK_KEYWORDS = /whatsapp|telegram|contact me|اتصل|واتساب|تليجرام|external|manual|delayed/i;

export function scoreEligibleOffer(
  offer: P2POffer,
  request: DeepScanRequest,
  averageEligiblePrice: number | null
): number {
  let score = 0;

  // ── Price component (40%) ──
  // Higher sell price → better for operator selling USDT
  if (averageEligiblePrice && averageEligiblePrice > 0 && offer.price > 0) {
    const priceRatio = offer.price / averageEligiblePrice;
    score += Math.min(40, priceRatio * 40);
  } else {
    score += 20; // neutral
  }

  // ── 30d trades component (25%) ──
  const trades = offer.merchant30dTrades ?? offer.trades ?? 0;
  // Normalize: 1000 trades → full 25 points
  score += Math.min(25, (trades / 1000) * 25);

  // ── Completion rate component (20%) ──
  const completion = offer.merchant30dCompletion ?? offer.completion ?? 0;
  // 100% → 20 points
  score += (completion / 100) * 20;

  // ── Capacity coverage (15%) ──
  const effectiveMax = Math.max(offer.available, offer.max);
  if (request.requiredUsdt > 0 && effectiveMax > 0) {
    const coverageRatio = Math.min(2, effectiveMax / request.requiredUsdt);
    score += (coverageRatio / 2) * 15;
  }

  // ── Advertiser message risk penalty ──
  if (offer.advertiserMessage && RISK_KEYWORDS.test(offer.advertiserMessage)) {
    score *= 0.9;
  }

  return Math.round(score * 100) / 100;
}

export function buildDeepScanResult(
  offers: P2POffer[],
  request: DeepScanRequest
): DeepScanResult {
  // Deduplicate by nick — keep best price per merchant
  const bestByNick = new Map<string, P2POffer>();
  for (const o of offers) {
    const nick = o.nick.trim();
    if (!nick) continue;
    const existing = bestByNick.get(nick);
    if (!existing || o.price > existing.price) {
      bestByNick.set(nick, o);
    }
  }

  const eligible: DeepScanCandidate[] = [];
  const excluded: DeepScanCandidate[] = [];

  // First pass: classify eligibility
  for (const [nick, offer] of bestByNick) {
    const { eligible: isEligible, reasons } = isOfferEligibleForScan(offer, request);
    const effectiveMax = Math.max(offer.available, offer.max);
    const candidate: DeepScanCandidate = {
      nick,
      score: 0,
      price: offer.price,
      available: offer.available,
      max: offer.max,
      merchant30dTrades: offer.merchant30dTrades ?? null,
      merchant30dCompletion: offer.merchant30dCompletion ?? null,
      feedbackCount: offer.feedbackCount ?? null,
      advertiserMessage: offer.advertiserMessage ?? null,
      methodCategories: offer.paymentMethodCategories ?? [],
      coversFullAmount: effectiveMax >= request.requiredUsdt,
      rejectionReasons: reasons,
      sourceOffer: offer,
    };

    if (isEligible) {
      eligible.push(candidate);
    } else {
      excluded.push(candidate);
    }
  }

  // Average eligible price from up to 20 distinct merchants
  const eligiblePrices = eligible.map(c => c.price).filter(p => p > 0);
  const top20Prices = eligiblePrices.sort((a, b) => b - a).slice(0, 20);
  const averageEligiblePrice = top20Prices.length > 0
    ? top20Prices.reduce((s, p) => s + p, 0) / top20Prices.length
    : null;

  // Score eligible candidates
  for (const c of eligible) {
    c.score = scoreEligibleOffer(c.sourceOffer, request, averageEligiblePrice);
  }

  // Sort by score descending
  eligible.sort((a, b) => b.score - a.score);

  const winner = eligible.length > 0 ? eligible[0] : null;

  return {
    request,
    winner,
    topCandidates: eligible.slice(0, 5),
    excludedCandidates: excluded,
    averageEligiblePrice,
    eligibleMerchantCount: eligible.length,
  };
}
