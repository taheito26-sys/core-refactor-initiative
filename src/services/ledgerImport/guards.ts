import type { LedgerParseRow } from '@/types/ledgerImport';

export function canSaveImportedRows(userId: string | null, selectedRelationshipId: string, rows: LedgerParseRow[]): boolean {
  if (!userId) return false;
  if (!selectedRelationshipId) return false;
  return rows.some((row) => row.status === 'parsed' && row.parsedType === 'merchant_deal' && row.saveEnabled);
}
