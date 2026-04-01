import type { ProfitShareAgreementType, ProfitShareSettlementWay } from '@/types/domain';

export interface SharedProfitShareFieldsInput {
  agreementType: ProfitShareAgreementType;
  investedCapitalRaw: string;
  settlementWay: ProfitShareSettlementWay;
}

export interface SharedProfitShareFieldsResult {
  investedCapital: number;
  settlementWay: ProfitShareSettlementWay;
}

export function parseInvestedCapital(raw: string): number {
  const cleaned = raw.trim();
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invested capital must be a non-negative number');
  }
  return value;
}

export function buildSharedProfitShareFields(input: SharedProfitShareFieldsInput): SharedProfitShareFieldsResult {
  return {
    investedCapital: parseInvestedCapital(input.investedCapitalRaw),
    settlementWay: input.settlementWay,
  };
}

