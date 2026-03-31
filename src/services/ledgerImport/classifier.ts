import type { LedgerDirection, LedgerParseContext, LedgerParseRow } from '@/types/ledgerImport';
import { hashNormalizedLine, normalizeLedgerLine } from './normalizer';

const MERCHANT_TO_ME = ['ارسللي', 'حوللي', 'اعطاني', 'سلملي'];
const ME_TO_MERCHANT = ['ارسلت', 'حولت', 'اعطيت'];

function detectDirection(normalized: string): LedgerDirection | null {
  if (MERCHANT_TO_ME.some((keyword) => normalized.includes(keyword))) return 'merchant_to_me';
  if (ME_TO_MERCHANT.some((keyword) => normalized.includes(keyword))) return 'me_to_merchant';
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

function findRate(normalized: string): number | null {
  const matches = normalized.match(/\d+(?:\.\d+)?/g) || [];
  for (const part of matches) {
    const num = Number.parseFloat(part);
    if (num >= 3.5 && num <= 4.0 && part.includes('.')) return num;
  }
  return null;
}

function findQarAmount(normalized: string): number | null {
  const qarMatch = normalized.match(/(?:يساوي|=|او|ريال)\s*(\d{1,9})/);
  if (!qarMatch?.[1]) return null;
  const n = Number.parseInt(qarMatch[1], 10);
  return Number.isFinite(n) ? n : null;
}

function findUsdtAmount(normalized: string, qarAmount: number | null): number | null {
  const tokens = normalized.split(/\s+/);
  const usdtIndex = tokens.findIndex((token) => token.includes('usdt'));
  const candidates: Array<{ value: number; distance: number }> = [];

  tokens.forEach((token, idx) => {
    if (!/^\d+$/.test(token)) return;
    const value = Number.parseInt(token, 10);
    if (value < 1 || value > 1_000_000) return;
    if (qarAmount != null && value === qarAmount) return;

    const distance = usdtIndex >= 0 ? Math.abs(usdtIndex - idx) : 100;
    candidates.push({ value, distance });
  });

  if (candidates.length === 0) return null;

  const nearUsdt = candidates.filter((c) => c.distance <= 3);
  const pool = nearUsdt.length > 0 ? nearUsdt : candidates;
  return pool.sort((a, b) => b.value - a.value)[0].value;
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

  const direction = detectDirection(normalizedText);
  const rate = findRate(normalizedText);
  const qarAmount = findQarAmount(normalizedText);
  const usdtAmount = findUsdtAmount(normalizedText, qarAmount);
  const intermediary = extractIntermediary(rawLine, normalizedText);

  console.debug('[ledger-import:classify]', {
    lineIndex,
    usdtAmount,
    rate,
    direction,
  });

  const hasSignals = usdtAmount != null && rate != null && direction != null;
  if (!hasSignals) {
    return {
      ...base,
      parsedType: 'unsupported',
      direction,
      usdtAmount,
      rate,
      computedQarAmount: qarAmount,
      intermediary,
      confidence: 0.2,
      status: 'skipped',
      parseResult: 'Skipped',
      skipReason: 'Missing required merchant_deal signals',
      saveEnabled: false,
    };
  }

  const confidence = Math.max(0.3, 0.92 - (ctx.confidencePenalty ?? 0));
  const computedQarAmount = qarAmount ?? Number.parseFloat((usdtAmount * rate).toFixed(2));
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
