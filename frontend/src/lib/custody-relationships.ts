/**
 * Normalization layer for merchant relationships in the cash custody flow.
 * Resolves the real counterparty from any relationship row,
 * regardless of which side (A or B) the logged-in merchant is on.
 */

export interface NormalizedCounterparty {
  relationshipId: string;
  counterpartyMerchantId: string;
  counterpartyUserId: string;
  counterpartyLabel: string;
  status: string;
}

interface RawRelationship {
  id: string;
  merchant_a_id: string;
  merchant_b_id: string;
  status: string;
}

interface ProfileLookup {
  merchant_id: string;
  user_id: string;
  display_name: string;
  nickname: string;
}

/**
 * Given raw relationships and merchant profiles, produce a deduped
 * list of counterparties relative to the logged-in merchant.
 */
export function normalizeCounterparties(
  myMerchantId: string,
  myUserId: string,
  relationships: RawRelationship[],
  profiles: ProfileLookup[],
): NormalizedCounterparty[] {
  if (!myMerchantId || !myUserId) return [];

  const profileMap = new Map(profiles.map(p => [p.merchant_id, p]));

  const candidates: NormalizedCounterparty[] = [];

  for (const rel of relationships) {
    // Only include active/approved relationships
    if (rel.status !== 'active' && rel.status !== 'approved') {
      continue;
    }

    // Determine which side the current merchant is on
    let counterpartyMerchantId: string | null = null;
    if (rel.merchant_a_id === myMerchantId) {
      counterpartyMerchantId = rel.merchant_b_id;
    } else if (rel.merchant_b_id === myMerchantId) {
      counterpartyMerchantId = rel.merchant_a_id;
    } else {
      // This relationship does not belong to the current merchant
      console.warn('[custody-relationships] skipping unrelated relationship:', rel.id);
      continue;
    }

    // Guard: reject if counterparty resolves back to self
    if (counterpartyMerchantId === myMerchantId) {
      console.warn('[custody-relationships] self-referencing relationship:', rel.id);
      continue;
    }

    if (!counterpartyMerchantId) {
      console.warn('[custody-relationships] missing counterparty merchant_id:', rel.id);
      continue;
    }

    // Resolve counterparty profile
    const profile = profileMap.get(counterpartyMerchantId);
    if (!profile) {
      console.warn('[custody-relationships] no profile for merchant:', counterpartyMerchantId);
      continue;
    }

    // Guard: counterparty must have a valid user_id
    if (!profile.user_id) {
      console.warn('[custody-relationships] missing user_id for merchant:', counterpartyMerchantId);
      continue;
    }

    // Guard: counterparty user_id must not be the same as the current user
    if (profile.user_id === myUserId) {
      console.warn('[custody-relationships] counterparty user_id resolves to self:', rel.id);
      continue;
    }

    candidates.push({
      relationshipId: rel.id,
      counterpartyMerchantId,
      counterpartyUserId: profile.user_id,
      counterpartyLabel: profile.nickname || profile.display_name || counterpartyMerchantId,
      status: rel.status,
    });
  }

  // Dedupe by counterpartyMerchantId — prefer active, then most recent (first match)
  const seen = new Map<string, NormalizedCounterparty>();
  for (const c of candidates) {
    const existing = seen.get(c.counterpartyMerchantId);
    if (!existing) {
      seen.set(c.counterpartyMerchantId, c);
    } else if (c.status === 'active' && existing.status !== 'active') {
      seen.set(c.counterpartyMerchantId, c);
    }
  }

  return Array.from(seen.values());
}
