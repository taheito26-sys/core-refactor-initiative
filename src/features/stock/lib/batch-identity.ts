import type { Batch } from '@/lib/tracker-helpers';

const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

/** Purchase identity excludes editable notes and funding choices. Order splits remain distinct by supplier and quantity. */
export function batchPurchaseKey(batch: Pick<Batch, 'ts' | 'source' | 'initialUSDT' | 'buyPriceQAR' | 'note' | 'importedFrom'>): string {
  const reference = batch.note.match(/P2P order (\S+)/)?.[1] ?? batch.note.match(/\(ref ([^)]+)\)/)?.[1];
  return JSON.stringify([
    reference ? [batch.importedFrom ?? '', reference] : Math.floor(batch.ts / 60_000),
    normalize(batch.source),
    Number(batch.initialUSDT.toFixed(8)),
    // An exchange reference identifies the purchase even if its local fiat rate changes.
    reference ? null : Number(batch.buyPriceQAR.toFixed(8)),
  ]);
}

/** UUID-shaped deterministic IDs also keep cash-ledger retries idempotent. */
export async function batchPurchaseId(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`stock-purchase:v1:${key}`)));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Reject new duplicates before committing either stock or cash; preserve existing historical records. */
export function assertNoNewDuplicateBatches(existing: Batch[], incoming: Batch[]): void {
  const ids = new Set(existing.map(b => b.id));
  const keys = new Map(existing.map(b => [b.purchaseKey ?? batchPurchaseKey(b), b.id]));
  for (const batch of incoming) {
    const key = batch.purchaseKey ?? batchPurchaseKey(batch);
    if (!ids.has(batch.id) && keys.has(key) && keys.get(key) !== batch.id) {
      throw new Error('This stock purchase is already recorded. Reload the tracker before saving.');
    }
    keys.set(key, batch.id);
  }
}
