export type LedgerRowType = 'merchant_deal' | 'unsupported';
export type LedgerDirection = 'merchant_to_me' | 'me_to_merchant';
export type LedgerParseStatus = 'parsed' | 'skipped' | 'needs_review';

export interface LedgerParseRow {
  id: string;
  rawLine: string;
  normalizedLine: string;
  normalizedHash: string;
  type: LedgerRowType;
  direction: LedgerDirection | null;
  usdtAmount: number | null;
  rate: number | null;
  computedQarAmount: number | null;
  ownerUserId: string;
  counterpartyMerchant: string;
  intermediary: string | null;
  confidence: number;
  status: LedgerParseStatus;
  parseResult: string;
  saveEnabled: boolean;
}

export interface LedgerParseContext {
  ownerUserId: string;
  ownerDisplayName?: string;
  defaultCounterpartyMerchant: string;
}

export interface ParsedLedgerBatch {
  batchId: string;
  rows: LedgerParseRow[];
  totals: {
    parsed: number;
    skipped: number;
    needsReview: number;
  };
}
