// ─── Merchant Deal Delete Diagnostics ───────────────────────────────
// Analyzes whether a deal can be safely deleted by classifying
// its associated settlements and profit records as blockers or ignored.

export interface DealDeleteDiagnostics {
  blockers: Array<{
    kind: 'settlement' | 'profit';
    id: string;
    reason: 'approved_record' | 'pending_approval';
  }>;
  ignored: Array<{
    kind: 'settlement' | 'profit';
    id: string;
    reason:
      | 'rejected_record'
      | 'cancelled_record'
      | 'expired_record'
      | 'orphaned_pending_record'
      | 'duplicate_stale_record';
  }>;
}

interface RecordEntry {
  id: string;
  status: string;
  deal_id: string;
  approval_id?: string | null;
  approval_status?: string | null;
}

/**
 * Analyzes all settlements and profit records for a deal
 * to determine if the deal can be safely deleted.
 *
 * Classification Rules:
 * - BLOCKER: record.status === "approved" → reason: "approved_record"
 * - BLOCKER: approval_status === "pending" → reason: "pending_approval"
 * - IGNORED: record.status ∈ {rejected, cancelled, expired} → reason: "{status}_record"
 * - IGNORED: orphaned pending (no approval_id) → reason: "orphaned_pending_record"
 * - IGNORED: duplicate stale → reason: "duplicate_stale_record"
 */
export function analyzeDealDeleteDiagnostics({
  dealId,
  settlements,
  profits,
}: {
  dealId: string;
  settlements: RecordEntry[];
  profits: RecordEntry[];
}): DealDeleteDiagnostics {
  const result: DealDeleteDiagnostics = {
    blockers: [],
    ignored: [],
  };

  const classify = (records: RecordEntry[], kind: 'settlement' | 'profit') => {
    const seen = new Set<string>();

    for (const record of records) {
      if (record.deal_id !== dealId) continue;

      // Check for duplicates (stale)
      const key = `${kind}-${record.id}`;
      if (seen.has(key)) {
        result.ignored.push({ kind, id: record.id, reason: 'duplicate_stale_record' });
        continue;
      }
      seen.add(key);

      // BLOCKER: approved record
      if (record.status === 'approved') {
        result.blockers.push({ kind, id: record.id, reason: 'approved_record' });
        continue;
      }

      // BLOCKER: pending approval
      if (record.approval_status === 'pending') {
        result.blockers.push({ kind, id: record.id, reason: 'pending_approval' });
        continue;
      }

      // IGNORED: rejected/cancelled/expired
      if (['rejected', 'cancelled', 'expired'].includes(record.status)) {
        result.ignored.push({
          kind,
          id: record.id,
          reason: `${record.status}_record` as 'rejected_record' | 'cancelled_record' | 'expired_record',
        });
        continue;
      }

      // IGNORED: orphaned pending (no approval_id)
      if (record.status === 'pending' && !record.approval_id) {
        result.ignored.push({ kind, id: record.id, reason: 'orphaned_pending_record' });
        continue;
      }
    }
  };

  classify(settlements, 'settlement');
  classify(profits, 'profit');

  return result;
}
