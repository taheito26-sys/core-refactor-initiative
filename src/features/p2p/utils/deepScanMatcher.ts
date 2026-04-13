import type { P2POffer } from '../types';
import type { DeepScanRequest, DeepScanCandidate, DeepScanResult } from '../types.deepScan';

export function isOfferEligibleForScan(
  offer: P2POffer,
  request: DeepScanRequest
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (offer.available < request.requiredUsdt) {
    reasons.push(`Available ${offer.available} < required ${request.requiredUsdt}`);
  }

  if ((request.mode === 'single_merchant_only' || request.requireFullCoverage) && offer.max < request.requiredUsdt) {
    reasons.push(`Max ${offer.max} < required ${request.requiredUsdt}`);
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
  if (averageEligiblePrice && averageEligiblePrice > 0 && offer.price > 0) {
    const priceRatio = offer.price / averageEligiblePrice;
    score += Math.min(40, priceRatio * 40);
  } else {
    score += 20;
  }

  // ── 30d trades component (25%) ──
  const trades = offer.merchant30dTrades ?? offer.trades ?? 0;
  score += Math.min(25, (trades / 1000) * 25);

  // ── Completion rate component (20%) ──
  const completion = offer.merchant30dCompletion ?? offer.completion ?? 0;
  score += (completion / 100) * 20;

  // ── Capacity coverage (15%) ──
  const effectiveCoverage = request.mode === 'single_merchant_only'
    ? Math.min(offer.available, offer.max)
    : offer.available;
  if (request.requiredUsdt > 0 && effectiveCoverage > 0) {
    const coverageRatio = Math.min(2, effectiveCoverage / request.requiredUsdt);
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

  for (const [nick, offer] of bestByNick) {
    const { eligible: isEligible, reasons } = isOfferEligibleForScan(offer, request);
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
      coversFullAmount: offer.available >= request.requiredUsdt && offer.max >= request.requiredUsdt,
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
    topCandidates: eligible,
    excludedCandidates: excluded,
    averageEligiblePrice,
    eligibleMerchantCount: eligible.length,
  };
}
