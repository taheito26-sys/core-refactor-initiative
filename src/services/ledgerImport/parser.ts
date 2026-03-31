import type { LedgerParseContext, LedgerParseRow, ParsedLedgerBatch } from '@/types/ledgerImport';
import { classifyLedgerLine } from './classifier';
import { splitLedgerLines } from './normalizer';

export function parseLedgerText(rawText: string, context: LedgerParseContext): ParsedLedgerBatch {
  const batchId = crypto.randomUUID();
  const lines = splitLedgerLines(rawText);
  const seenHashes = new Set<string>();

  const rows: LedgerParseRow[] = lines.map((line) => {
    const parsed = classifyLedgerLine(line, context);

    if (seenHashes.has(parsed.normalizedHash)) {
      return {
        ...parsed,
        status: 'skipped',
        type: 'unsupported',
        parseResult: 'Duplicate line in batch',
        confidence: 0,
        saveEnabled: false,
      };
    }

    seenHashes.add(parsed.normalizedHash);

    const lowConfidence = parsed.confidence < 0.7;
    if (lowConfidence && parsed.status === 'parsed') {
      return {
        ...parsed,
        status: 'needs_review',
        parseResult: 'Low confidence, review required',
        saveEnabled: false,
      };
    }

    return parsed;
  });

  return {
    batchId,
    rows,
    totals: {
      parsed: rows.filter((row) => row.status === 'parsed').length,
      skipped: rows.filter((row) => row.status === 'skipped').length,
      needsReview: rows.filter((row) => row.status === 'needs_review').length,
    },
  };
}
