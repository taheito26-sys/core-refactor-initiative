import { describe, expect, it } from 'vitest';
import { buildLoanStatementResponse, loadStatementState, type StatementState } from '../../supabase/functions/_shared/buildLoanStatement.ts';

const state: StatementState = {
  customers: [{ id: 'c1', name: 'Buyer' }],
  customerLoans: [{
    id: 'l1', customerId: 'c1', currency: 'QAR', principal: 100, ts: 1, createdAt: 1, status: 'open',
    repayments: [{ id: 'r1', ts: 2, amount: 40, batchId: 'b1', note: 'x' }],
  }],
  trades: [],
};

function fakeClient() {
  const reads: string[] = [];
  const builder = (table: string, columns?: string) => {
    const b: Record<string, unknown> = {
      select: (cols: string) => builder(table, cols),
      eq: () => b, in: () => b, is: () => b,
      maybeSingle: async () => {
        if (table === 'tracker_snapshots') reads.push(columns ?? '');
        return { data: table === 'tracker_snapshots' ? state : null, error: null };
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    return b;
  };
  return { client: { from: (t: string) => builder(t) }, reads };
}

describe('buyer statement loading', () => {
  it('reads only the parts of the tracker snapshot it needs', async () => {
    const { client, reads } = fakeClient();
    await loadStatementState(client, 'm1');
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('state->customerLoans');
    expect(reads[0]).not.toBe('state');
  });

  it('shares one snapshot read between links to the same merchant and builds each statement', async () => {
    const { client, reads } = fakeClient();
    const snapshots = new Map<string, Promise<StatementState | null>>();
    const links = [
      { user_id: 'm1', customer_id: 'c1', currency: 'QAR' },
      { user_id: 'm1', customer_id: 'c1', currency: 'QAR' },
    ];
    const built = await Promise.all(links.map(l => buildLoanStatementResponse(client, l, false, { snapshots })));
    expect(reads).toHaveLength(1);
    for (const s of built) {
      expect(s?.outstanding).toBe(60);
      expect(s?.payments).toHaveLength(1);
      expect(s?.payments[0].amount).toBe(40);
    }
  });

  it('returns nothing for a merchant without a snapshot', async () => {
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    expect(await buildLoanStatementResponse(client, { user_id: 'm', customer_id: 'c', currency: 'QAR' }, false)).toBeNull();
  });
});
