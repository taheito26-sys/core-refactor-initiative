import type { LedgerDirection, LedgerParseContext, LedgerParseRow } from '@/types/ledgerImport';
import { hashNormalizedLine, normalizeLedgerLine } from './normalizer';

const UNSUPPORTED_KEYWORDS = ['اشتريت', 'شراء', 'ريال', 'اموال', 'رصيد', 'الفوائد', 'فوائد', 'تسوية', 'ملخص', 'interest', 'profit'];

function detectDirection(normalized: string): LedgerDirection | null {
  if (normalized.includes('محمد ارسللي')) return 'merchant_to_me';
  if (normalized.includes('ارسلت لمحمد')) return 'me_to_merchant';
  return null;
}

function extractIntermediary(rawLine: string, normalized: string): string | null {
  const byWay = normalized.match(/(?:بواسطة|عن طريق)\s+([^\d]+?)(?:\s+على|$)/);
  if (byWay?.[1]) return byWay[1].trim();
  if (normalized.includes('ابو تميم')) return 'ابو تميم';
  if (normalized.includes('ابو عوني')) return 'ابو عوني';

  const rawParen = rawLine.match(/[([]\s*([^\])]+)\s*[)\]]/);
  return rawParen?.[1]?.trim() || null;
}

function extractNumber(input: string, regex: RegExp): number | null {
  const value = input.match(regex)?.[1];
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function baseRow(rawLine: string, lineIndex: number, ctx: LedgerParseContext): Omit<LedgerParseRow, 'parsedType' | 'direction' | 'usdtAmount' | 'rate' | 'computedQarAmount' | 'confidence' | 'status' | 'parseResult' | 'skipReason' | 'saveEnabled' | 'intermediary'> & { normalizedHash: string; normalizedText: string } {
  const normalizedText = normalizeLedgerLine(rawLine);
  return {
    id: `${ctx.sourceType}-${lineIndex}`,
    rawLine,
    normalizedText,
    normalizedHash: hashNormalizedLine(normalizedText),
    sourceType: ctx.sourceType,
    sourceFileName: ctx.sourceFileName ?? null,
    lineIndex,
    uploaderUserId: ctx.uploaderUserId,
    selectedMerchantId: ctx.selectedMerchantId,
    selectedMerchantName: ctx.selectedMerchantName,
  };
}

export function classifyLedgerLine(rawLine: string, lineIndex: number, ctx: LedgerParseContext): LedgerParseRow {
  const base = baseRow(rawLine, lineIndex, ctx);
  const { normalizedText } = base;
  const usdtAmount = extractNumber(normalizedText, /usdt\s*([\d.]+)/i);
  const rate = extractNumber(normalizedText, /على\s*([\d.]+)/i);
  const direction = detectDirection(normalizedText);
  const intermediary = extractIntermediary(rawLine, normalizedText);

  if (UNSUPPORTED_KEYWORDS.some((k) => normalizedText.includes(k))) {
    return {
      ...base,
      parsedType: 'unsupported',
      direction: null,
      usdtAmount,
      rate,
      computedQarAmount: null,
      intermediary,
      confidence: 0,
      status: 'skipped',
      parseResult: 'Unsupported in Phase 1',
      skipReason: 'Unsupported transaction class',
      saveEnabled: false,
    };
  }

  const missing = [
    !normalizedText.includes('usdt') ? 'USDT' : null,
    usdtAmount == null ? 'amount' : null,
    rate == null ? 'rate' : null,
    direction == null ? 'direction' : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    return {
      ...base,
      parsedType: 'unsupported',
      direction,
      usdtAmount,
      rate,
      computedQarAmount: null,
      intermediary,
      confidence: 0.25,
      status: 'skipped',
      parseResult: 'Skipped',
      skipReason: `Missing ${missing.join(', ')}`,
      saveEnabled: false,
    };
  }

  const confidence = Math.max(0.3, 0.92 - (ctx.confidencePenalty ?? 0));
  const computedQarAmount = Number.parseFloat(((usdtAmount || 0) * (rate || 0)).toFixed(2));
  const needsReview = confidence < 0.7;

  return {
    ...base,
    parsedType: 'merchant_deal',
    direction,
    usdtAmount,
    rate,
    computedQarAmount,
    intermediary,
    confidence,
    status: needsReview ? 'needs_review' : 'parsed',
    parseResult: needsReview ? 'Needs review' : 'Ready to import',
    skipReason: needsReview ? 'Low confidence source' : null,
    saveEnabled: !needsReview,
  };
}
