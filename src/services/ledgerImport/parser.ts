import type { LedgerParseContext, LedgerParseRow, ParsedLedgerBatch } from '@/types/ledgerImport';
import { classifyLedgerLine } from './classifier';
import { splitLedgerLines } from './normalizer';

export function parseLedgerText(rawText: string, context: LedgerParseContext): ParsedLedgerBatch {
  const batchId = crypto.randomUUID();
  const lines = splitLedgerLines(rawText);
  const seen = new Set<string>();

  const rows: LedgerParseRow[] = lines.map((line, index) => {
    const lineIndex = (context.lineOffset ?? 0) + index;
    const parsed = classifyLedgerLine(line, lineIndex, context);

    if (seen.has(parsed.normalizedHash)) {
      return {
        ...parsed,
        parsedType: 'unsupported',
        status: 'skipped',
        parseResult: 'Skipped',
        skipReason: 'Duplicate line in batch',
        confidence: 0,
        saveEnabled: false,
      };
    }

    seen.add(parsed.normalizedHash);
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
