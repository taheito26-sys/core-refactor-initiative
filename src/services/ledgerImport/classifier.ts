import type { LedgerDirection, LedgerParseContext, LedgerParseRow } from '@/types/ledgerImport';
import { hashNormalizedLine, normalizeLedgerLine } from './normalizer';

const UNSUPPORTED_KEYWORDS = [
  'اشتريت',
  'شراء',
  'ريال',
  'اموال',
  'رصيد',
  'الفوائد',
  'فوائد',
  'تسوية',
  'ملخص',
  'interest',
  'profit',
];

const INTERMEDIARY_PATTERNS = [
  /\b(?:بواسطة|عن طريق)\s+(.+?)\s+على/,
  /\b(?:بواسطة|عن طريق)\s+(.+)$/,
  /\b(?:ابو\s+عوني|ابو\s+تميم)\b/,
];

function detectDirection(normalized: string): LedgerDirection | null {
  if (normalized.includes('محمد ارسللي')) return 'merchant_to_me';
  if (normalized.includes('ارسلت لمحمد')) return 'me_to_merchant';
  return null;
}

function extractIntermediary(rawLine: string, normalized: string): string | null {
  for (const pattern of INTERMEDIARY_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const captured = (match[1] || match[0] || '').trim();
    const cleaned = captured
      .replace(/\b(?:بواسطة|عن طريق)\b/g, '')
      .trim();
    if (cleaned && cleaned !== 'محمد') {
      return cleaned;
    }
  }


  if (normalized.includes('ابو تميم')) return 'ابو تميم';
  if (normalized.includes('ابو عوني')) return 'ابو عوني';

  const rawParen = rawLine.match(/[([]\s*([^\])]+)\s*[)\]]/);
  if (rawParen?.[1]) {
    const candidate = rawParen[1].trim();
    if (candidate && candidate !== 'محمد') return candidate;
  }

  return null;
}

function extractNumber(input: string, regex: RegExp): number | null {
  const match = input.match(regex);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasUnsupportedKeyword(normalized: string): boolean {
  return UNSUPPORTED_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function classifyLedgerLine(rawLine: string, ctx: LedgerParseContext): LedgerParseRow {
  const normalizedLine = normalizeLedgerLine(rawLine);
  const normalizedHash = hashNormalizedLine(normalizedLine);

  const usdtAmount = extractNumber(normalizedLine, /usdt\s*([\d.]+)/i);
  const rate = extractNumber(normalizedLine, /على\s*([\d.]+)/i);
  const direction = detectDirection(normalizedLine);

  if (hasUnsupportedKeyword(normalizedLine)) {
    return {
      id: normalizedHash,
      rawLine,
      normalizedLine,
      normalizedHash,
      type: 'unsupported',
      direction: null,
      usdtAmount,
      rate,
      computedQarAmount: null,
      ownerUserId: ctx.ownerUserId,
      counterpartyMerchant: ctx.defaultCounterpartyMerchant,
      intermediary: null,
      confidence: 0,
      status: 'skipped',
      parseResult: 'Unsupported in Phase 1',
      saveEnabled: false,
    };
  }

  if (!normalizedLine.includes('usdt') || usdtAmount == null || rate == null || direction == null) {
    const missingSignals = [
      !normalizedLine.includes('usdt') ? 'USDT' : null,
      usdtAmount == null ? 'amount' : null,
      rate == null ? 'rate' : null,
      direction == null ? 'direction' : null,
    ].filter(Boolean);

    return {
      id: normalizedHash,
      rawLine,
      normalizedLine,
      normalizedHash,
      type: 'unsupported',
      direction,
      usdtAmount,
      rate,
      computedQarAmount: null,
      ownerUserId: ctx.ownerUserId,
      counterpartyMerchant: ctx.defaultCounterpartyMerchant,
      intermediary: null,
      confidence: 0.25,
      status: 'skipped',
      parseResult: `Missing ${missingSignals.join(', ')}`,
      saveEnabled: false,
    };
  }

  const intermediary = extractIntermediary(rawLine, normalizedLine);
  const computedQarAmount = Number.parseFloat((usdtAmount * rate).toFixed(2));

  return {
    id: normalizedHash,
    rawLine,
    normalizedLine,
    normalizedHash,
    type: 'merchant_deal',
    direction,
    usdtAmount,
    rate,
    computedQarAmount,
    ownerUserId: ctx.ownerUserId,
    counterpartyMerchant: ctx.defaultCounterpartyMerchant,
    intermediary,
    confidence: intermediary ? 0.95 : 0.9,
    status: 'parsed',
    parseResult: 'Ready to import',
    saveEnabled: true,
  };
}
