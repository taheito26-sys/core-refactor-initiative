import type { MerchantDeal, MerchantRelationship } from '@/types/domain';

export function isDealVisibleInWorkspace({
  deal,
  workspaceMerchantId,
  workspaceRelationshipIds,
}: {
  deal: MerchantDeal | any;
  workspaceMerchantId: string;
  workspaceRelationshipIds: Set<string>;
}): boolean {
  if (!workspaceMerchantId) return false;
  if (!deal?.relationship_id) return false;
  return workspaceRelationshipIds.has(deal.relationship_id);
}

export function getWorkspaceDealPerspective({
  deal,
  workspaceMerchantId,
  relationshipById,
  merchantUserByMerchantId,
}: {
  deal: MerchantDeal | any;
  workspaceMerchantId: string;
  relationshipById: Map<string, Pick<MerchantRelationship, 'merchant_a_id' | 'merchant_b_id'>>;
  merchantUserByMerchantId: Map<string, string>;
}): 'incoming' | 'outgoing' | null {
  const rel = relationshipById.get(deal.relationship_id);
  if (!rel) return null;

  const creatorUserId = String(deal.created_by || '');
  const aUserId = merchantUserByMerchantId.get(rel.merchant_a_id);
  const bUserId = merchantUserByMerchantId.get(rel.merchant_b_id);

  let creatorMerchantId: string | null = null;
  if (creatorUserId && aUserId && creatorUserId === aUserId) creatorMerchantId = rel.merchant_a_id;
  else if (creatorUserId && bUserId && creatorUserId === bUserId) creatorMerchantId = rel.merchant_b_id;

  // Safe default: unknown creator-side in relationship => exclude from perspective views.
  if (!creatorMerchantId) return null;
  return creatorMerchantId === workspaceMerchantId ? 'outgoing' : 'incoming';
}
