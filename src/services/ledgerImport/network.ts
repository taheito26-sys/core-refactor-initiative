import type { LedgerNetworkMerchant } from '@/types/ledgerImport';

interface RelationshipRow {
  id: string;
  merchant_a_id: string;
  merchant_b_id: string;
}

interface ProfileRow {
  merchant_id: string;
  display_name: string | null;
  nickname: string | null;
  merchant_code: string | null;
}

export function buildNetworkMerchants(
  myMerchantId: string,
  relationships: RelationshipRow[],
  profiles: ProfileRow[],
): LedgerNetworkMerchant[] {
  const profileMap = new Map(profiles.map((p) => [p.merchant_id, p]));

  return relationships.map((rel) => {
    const merchantId = rel.merchant_a_id === myMerchantId ? rel.merchant_b_id : rel.merchant_a_id;
    const profile = profileMap.get(merchantId);
    return {
      relationshipId: rel.id,
      merchantId,
      merchantName: profile?.display_name || profile?.nickname || merchantId,
      merchantCode: profile?.merchant_code || null,
      merchantNickname: profile?.nickname || null,
    };
  });
}
