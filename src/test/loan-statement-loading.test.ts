import { describe, expect, it, vi } from 'vitest';
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

  it('does not calculate other buyers or currencies while keeping duplicate buyer records', async () => {
    const { client } = fakeClient();
    const spy = vi.spyOn(await import('@/features/stock/utils/loanStatement'), 'buildBuyerStatements');
    const buyerLoan = (state.customerLoans as object[])[0];
    const originalCustomers = state.customers;
    const originalLoans = state.customerLoans;
    state.customers = [{ id: 'c1', name: 'Buyer' }, { id: 'duplicate', name: 'Buyer' }, { id: 'other', name: 'Other' }];
    state.customerLoans = [buyerLoan,
      { ...buyerLoan, id: 'l2', customerId: 'duplicate' },
      { ...buyerLoan, id: 'l3', customerId: 'other' },
      { ...buyerLoan, id: 'l4', currency: 'EGP' },
    ];
    try {
      const result = await buildLoanStatementResponse(client, { user_id: 'm1', customer_id: 'c1', currency: 'QAR' }, false);
      expect(result?.totalLoaned).toBe(200);
      expect(result?.outstanding).toBe(120);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        loans: expect.arrayContaining([expect.objectContaining({ id: 'l1' }), expect.objectContaining({ id: 'l2' })]),
      }));
      expect(spy.mock.calls[0][0].loans).toHaveLength(2);
    } finally {
      state.customers = originalCustomers;
      state.customerLoans = originalLoans;
      spy.mockRestore();
    }
  });

  it('returns nothing for a merchant without a snapshot', async () => {
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    expect(await buildLoanStatementResponse(client, { user_id: 'm', customer_id: 'c', currency: 'QAR' }, false)).toBeNull();
  });
});
