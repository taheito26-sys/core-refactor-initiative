import type { MarketId, P2POffer, PaymentMethodCategory } from './types';

export type DeepScanMode = 'single_merchant_only' | 'allow_multi_fallback';

export interface DeepScanRequest {
  market: MarketId;
  requiredUsdt: number;
  mode: DeepScanMode;
  requireFullCoverage: boolean;
}

export interface DeepScanCandidate {
  nick: string;
  score: number;
  price: number;
  available: number;
  max: number;
  merchant30dTrades: number | null;
  merchant30dCompletion: number | null;
  feedbackCount: number | null;
  advertiserMessage: string | null;
  methodCategories: PaymentMethodCategory[];
  coversFullAmount: boolean;
  rejectionReasons: string[];
  sourceOffer: P2POffer;
}

export interface DeepScanResult {
  request: DeepScanRequest;
  winner: DeepScanCandidate | null;
  topCandidates: DeepScanCandidate[];
  excludedCandidates: DeepScanCandidate[];
  averageEligiblePrice: number | null;
  eligibleMerchantCount: number;
}
