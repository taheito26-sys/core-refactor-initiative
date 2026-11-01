import { extractImportedReference } from '@/features/exchanges/tracker-import';

interface ExchangeRecord {
  id: string;
  note?: string;
  importedFrom?: 'binance' | 'okx';
  exchangeOrderNumber?: string;
  revisions?: Array<{ before?: { note?: string } }>;
}

/** Recover only exact references; never guess registration from amount, date or customer. */
export function exchangeRegistration(row: Omit<ExchangeRecord, 'id'>): { reference: string; exchange?: ExchangeRecord['importedFrom'] } | null {
  const notes = [row.note ?? '', ...(row.revisions ?? []).map(revision => revision.before?.note ?? '')];
  const current = row.exchangeOrderNumber || extractImportedReference(notes[0]);
  const historical = [...new Set(notes.slice(1).map(extractImportedReference).filter(Boolean))];
  const reference = current || (historical.length === 1 ? historical[0] : null);
  if (!reference) return null;
  const sourceNote = notes.find(note => extractImportedReference(note) === reference);
  const exchange = row.importedFrom || sourceNote?.match(/Imported from (Binance|OKX) /i)?.[1]?.toLowerCase() as ExchangeRecord['importedFrom'];
  return { reference, exchange };
}

/** Same-id snapshot updates may edit values, but missing metadata must not unlink a saved exchange order. */
export function preserveExchangeRegistrations<T extends ExchangeRecord>(previous: T[] | undefined, incoming: T[]): T[] {
  const byId = new Map((previous ?? []).map(row => [row.id, row]));
  return incoming.map(row => {
    const old = byId.get(row.id);
    const identity = exchangeRegistration(row) || (old && exchangeRegistration(old));
    if (!identity) return row;
    return {
      ...row,
      exchangeOrderNumber: identity.reference,
      importedFrom: identity.exchange || (old && exchangeRegistration(old)?.reference === identity.reference ? old.importedFrom : undefined),
    };
  });
}
