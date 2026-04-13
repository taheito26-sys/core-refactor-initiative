import { describe, expect, it } from 'vitest';
import { getWorkspaceDealPerspective, isDealVisibleInWorkspace } from '@/features/orders/utils/workspaceDealScope';

const relAB = { id: 'rel-ab', merchant_a_id: 'A', merchant_b_id: 'B' };
const relCD = { id: 'rel-cd', merchant_a_id: 'C', merchant_b_id: 'D' };

const relationshipById = new Map([
  [relAB.id, relAB],
  [relCD.id, relCD],
]);

const merchantUserByMerchantId = new Map([
  ['A', 'user-a'],
  ['B', 'user-b'],
  ['C', 'user-c'],
  ['D', 'user-d'],
]);

describe('workspace deal scoping', () => {
  it('A workspace sees A-B deal', () => {
    const visible = isDealVisibleInWorkspace({
      deal: { relationship_id: 'rel-ab' },
      workspaceMerchantId: 'A',
      workspaceRelationshipIds: new Set(['rel-ab']),
    });
    expect(visible).toBe(true);
  });

  it('B workspace also sees A-B deal', () => {
    const visible = isDealVisibleInWorkspace({
      deal: { relationship_id: 'rel-ab' },
      workspaceMerchantId: 'B',
      workspaceRelationshipIds: new Set(['rel-ab']),
    });
    expect(visible).toBe(true);
  });

  it('C workspace does not see A-B deal', () => {
    const visible = isDealVisibleInWorkspace({
      deal: { relationship_id: 'rel-ab' },
      workspaceMerchantId: 'C',
      workspaceRelationshipIds: new Set(['rel-cd']),
    });
    expect(visible).toBe(false);
  });

  it('multiple relationships only include matching relationship_id', () => {
    const workspaceRelationshipIds = new Set(['rel-cd']);
    expect(isDealVisibleInWorkspace({ deal: { relationship_id: 'rel-ab' }, workspaceMerchantId: 'C', workspaceRelationshipIds })).toBe(false);
    expect(isDealVisibleInWorkspace({ deal: { relationship_id: 'rel-cd' }, workspaceMerchantId: 'C', workspaceRelationshipIds })).toBe(true);
  });

  it('created_by matches user but relationship mismatch still hidden', () => {
    const visible = isDealVisibleInWorkspace({
      deal: { relationship_id: 'rel-ab', created_by: 'user-c' },
      workspaceMerchantId: 'C',
      workspaceRelationshipIds: new Set(['rel-cd']),
    });
    expect(visible).toBe(false);
  });

  it('perspective classification uses workspace merchant membership after visibility check', () => {
    const outgoing = getWorkspaceDealPerspective({
      deal: { relationship_id: 'rel-ab', created_by: 'user-a' },
      workspaceMerchantId: 'A',
      relationshipById,
      merchantUserByMerchantId,
    });
    const incoming = getWorkspaceDealPerspective({
      deal: { relationship_id: 'rel-ab', created_by: 'user-a' },
      workspaceMerchantId: 'B',
      relationshipById,
      merchantUserByMerchantId,
    });
    expect(outgoing).toBe('outgoing');
    expect(incoming).toBe('incoming');
  });

  it('unknown creator mapping returns null perspective (safe false-negative)', () => {
    const perspective = getWorkspaceDealPerspective({
      deal: { relationship_id: 'rel-ab', created_by: 'user-x' },
      workspaceMerchantId: 'A',
      relationshipById,
      merchantUserByMerchantId,
    });
    expect(perspective).toBeNull();
  });
});
