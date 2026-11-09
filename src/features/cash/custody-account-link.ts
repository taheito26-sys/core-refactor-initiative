import type { CashAccount } from '@/lib/tracker-helpers';
import type { NormalizedCounterparty } from '@/lib/custody-relationships';

type Link = Pick<CashAccount, 'merchantId' | 'relationshipId' | 'purpose'>;
const marker = /\[\[custody-link:([^\]]+)\]\]$/;

/** Keep custody identity in the existing notes column on schemas without dedicated link columns. */
export function encodeCustodyAccountNotes(account: CashAccount): string | null {
  if (account.type !== 'merchant_custody' || (!account.merchantId && !account.relationshipId)) return account.notes ?? null;
  const link: Link = { merchantId: account.merchantId, relationshipId: account.relationshipId, purpose: account.purpose };
  return `${account.notes || ''}${account.notes ? ' ' : ''}[[custody-link:${encodeURIComponent(JSON.stringify(link))}]]`;
}

export function decodeCustodyAccountNotes(notes: string | null | undefined): { notes?: string; link: Link } {
  const raw = notes || '';
  const found = raw.match(marker);
  if (found) {
    try {
      const value = JSON.parse(decodeURIComponent(found[1]));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid custody link');
      const merchantId = typeof value.merchantId === 'string' && value.merchantId.trim() ? value.merchantId : undefined;
      const relationshipId = typeof value.relationshipId === 'string' && value.relationshipId.trim() ? value.relationshipId : undefined;
      if (!merchantId && !relationshipId) throw new Error('Empty custody link');
      const purpose = ['custody', 'clearing', 'settlement'].includes(value.purpose) ? value.purpose as CashAccount['purpose'] : undefined;
      const prefix = raw.slice(0, found.index);
      return { notes: (prefix.endsWith(' ') ? prefix.slice(0, -1) : prefix) || undefined, link: { merchantId, relationshipId, purpose } };
    } catch { /* Preserve unrecognized notes verbatim. */ }
  }
  return { notes: notes ?? undefined, link: {} };
}

/** Never fall back to a name when a stored identity contradicts the available relationships. */
export function resolveCustodyAccountRecipient(account: CashAccount, counterparties: NormalizedCounterparty[]): NormalizedCounterparty | undefined {
  const approved = counterparties.filter(cp => ['active', 'approved'].includes(cp.status) && cp.counterpartyUserId);
  if (account.merchantId) return approved.find(cp => cp.counterpartyMerchantId === account.merchantId);
  if (account.relationshipId) return approved.find(cp => cp.relationshipId === account.relationshipId);
  const normalize = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const name = normalize(account.name.replace(/^Custody\s*[—–-]\s*/i, ''));
  if (!name) return undefined;
  const matches = approved.filter(cp => normalize(cp.counterpartyMerchantId) === name || normalize(cp.counterpartyLabel) === name);
  return matches.length === 1 ? matches[0] : undefined;
}
