import { describe, it, expect } from 'vitest';
import { analyzeDealDeleteDiagnostics } from '@/lib/merchant-deal-delete';

describe('merchant-deal-delete — analyzeDealDeleteDiagnostics', () => {
  const dealId = 'deal-1';

  it('returns empty blockers and ignored when no records', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [],
      profits: [],
    });
    expect(result.blockers).toEqual([]);
    expect(result.ignored).toEqual([]);
  });

  it('classifies approved settlement as BLOCKER: approved_record', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [{ id: 's1', status: 'approved', deal_id: dealId }],
      profits: [],
    });
    expect(result.blockers).toEqual([
      { kind: 'settlement', id: 's1', reason: 'approved_record' },
    ]);
  });

  it('classifies approved profit record as BLOCKER: approved_record', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [],
      profits: [{ id: 'p1', status: 'approved', deal_id: dealId }],
    });
    expect(result.blockers).toEqual([
      { kind: 'profit', id: 'p1', reason: 'approved_record' },
    ]);
  });

  it('classifies pending approval on settlement as BLOCKER: pending_approval', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [{ id: 's1', status: 'pending', deal_id: dealId, approval_id: 'a1', approval_status: 'pending' }],
      profits: [],
    });
    expect(result.blockers).toEqual([
      { kind: 'settlement', id: 's1', reason: 'pending_approval' },
    ]);
  });

  it('classifies orphaned pending (no approval_id) as IGNORED: orphaned_pending_record', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [{ id: 's1', status: 'pending', deal_id: dealId, approval_id: null }],
      profits: [],
    });
    expect(result.ignored).toEqual([
      { kind: 'settlement', id: 's1', reason: 'orphaned_pending_record' },
    ]);
  });

  it('classifies rejected records as IGNORED: rejected_record', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [{ id: 's1', status: 'rejected', deal_id: dealId }],
      profits: [],
    });
    expect(result.ignored).toEqual([
      { kind: 'settlement', id: 's1', reason: 'rejected_record' },
    ]);
  });

  it('classifies cancelled records as IGNORED: cancelled_record', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [],
      profits: [{ id: 'p1', status: 'cancelled', deal_id: dealId }],
    });
    expect(result.ignored).toEqual([
      { kind: 'profit', id: 'p1', reason: 'cancelled_record' },
    ]);
  });

  it('classifies expired records as IGNORED: expired_record', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [{ id: 's1', status: 'expired', deal_id: dealId }],
      profits: [],
    });
    expect(result.ignored).toEqual([
      { kind: 'settlement', id: 's1', reason: 'expired_record' },
    ]);
  });

  it('classifies duplicate stale records as IGNORED: duplicate_stale_record', () => {
    const settlement = { id: 's1', status: 'rejected', deal_id: dealId };
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [settlement, settlement], // duplicate
      profits: [],
    });
    expect(result.ignored).toHaveLength(2);
    expect(result.ignored[0].reason).toBe('rejected_record');
    expect(result.ignored[1].reason).toBe('duplicate_stale_record');
  });

  it('excludes records from unrelated deals', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [{ id: 's1', status: 'approved', deal_id: 'other-deal' }],
      profits: [{ id: 'p1', status: 'approved', deal_id: 'other-deal' }],
    });
    expect(result.blockers).toEqual([]);
    expect(result.ignored).toEqual([]);
  });

  it('handles mixed blockers and ignored correctly', () => {
    const result = analyzeDealDeleteDiagnostics({
      dealId,
      settlements: [
        { id: 's1', status: 'approved', deal_id: dealId },
        { id: 's2', status: 'rejected', deal_id: dealId },
      ],
      profits: [
        { id: 'p1', status: 'pending', deal_id: dealId, approval_id: 'a1', approval_status: 'pending' },
        { id: 'p2', status: 'cancelled', deal_id: dealId },
      ],
    });
    expect(result.blockers).toHaveLength(2);
    expect(result.ignored).toHaveLength(2);
  });
});
