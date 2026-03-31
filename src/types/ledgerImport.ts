export type LedgerSourceType = 'pasted_text' | 'text_file' | 'spreadsheet' | 'image';
export type LedgerRowType = 'merchant_deal' | 'unsupported';
export type LedgerDirection = 'merchant_to_me' | 'me_to_merchant';
export type LedgerParseStatus = 'parsed' | 'skipped' | 'needs_review';

export interface LedgerParseRow {
  id: string;
  rawLine: string;
  normalizedText: string;
  normalizedHash: string;
  sourceType: LedgerSourceType;
  sourceFileName: string | null;
  lineIndex: number;
  parsedType: LedgerRowType;
  direction: LedgerDirection | null;
  usdtAmount: number | null;
  rate: number | null;
  computedQarAmount: number | null;
  uploaderUserId: string;
  selectedMerchantId: string | null;
  selectedMerchantName: string | null;
  intermediary: string | null;
  confidence: number;
  status: LedgerParseStatus;
  parseResult: string;
  skipReason: string | null;
  saveEnabled: boolean;
}

export interface LedgerParseContext {
  uploaderUserId: string;
  selectedMerchantId: string | null;
  selectedMerchantName: string | null;
  sourceType: LedgerSourceType;
  sourceFileName?: string | null;
  lineOffset?: number;
  confidencePenalty?: number;
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

export interface LedgerNetworkMerchant {
  relationshipId: string;
  merchantId: string;
  merchantName: string;
  merchantCode: string | null;
  merchantNickname: string | null;
}
