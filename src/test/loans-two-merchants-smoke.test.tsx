// Smoke test: a connected loan between two merchants, driven through the real Loans screens on both sides.
// The backend is an in-memory stand-in that follows the same rules as the merchant_loan_moves SQL
// (participants only, the other side answers, one answer, proposer may withdraw) and, like the real
// realtime client, throws when a listener is added to a channel that is already subscribed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { computeFIFO, type TrackerState } from '@/lib/tracker-helpers';
import { merchantNet } from '@/features/stock/loan-ledger';

vi.mock('@/lib/i18n', () => ({ useT: () => Object.assign((k: string) => k, { lang: 'en', isRTL: false }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/features/exchanges/hooks/useExchangeTransfers', () => ({ useExchangeTransfers: () => ({ data: [] }) }));
vi.mock('@/features/exchanges/hooks/useExchangeP2POrders', () => ({ useExchangeP2POrders: () => ({ data: [] }) }));
vi.mock('@/features/exchanges/hooks/useExchangeOrderLinks', () => ({ useExchangeOrderLinks: () => ({ data: new Map() }), sumLinkedAmount: () => 0 }));

// ── The two merchants ──
const MERCHANTS = {
  A: { uid: 'uA', merchantId: 'MA', name: 'MOHAMED' },
  B: { uid: 'uB', merchantId: 'MB', name: 'zack' },
} as const;
type Side = keyof typeof MERCHANTS;
const current = { side: 'A' as Side };
const me = () => MERCHANTS[current.side];

type Row = { id: string; proposer: Side; responder: Side; direction: 'out' | 'in'; amount: number; at: string; status: 'pending' | 'approved' | 'rejected' | 'cancelled' };
const db = { moves: [] as Row[], seq: 0 };
const sideOfUid = (uid: string) => (uid === 'uA' ? 'A' : 'B') as Side;

vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ user: { id: me().uid } }) }));

function select(table: string) {
  const ops: { eq?: [string, string]; ins?: [string, string[]] } = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q, order: () => q, limit: () => q, or: () => q,
    eq: (c: string, v: string) => { ops.eq = [c, v]; return q; },
    in: (c: string, v: string[]) => { ops.ins = [c, v]; return q; },
    maybeSingle: async () => ({ data: rows()[0] ?? null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (res: any) => res({ data: rows(), error: null }),
  };
  function rows(): unknown[] {
    const m = me();
    if (table === 'merchant_profiles') {
      const all = [
        { merchant_id: 'MA', user_id: 'uA', display_name: 'MOHAMED' },
        { merchant_id: 'MB', user_id: 'uB', display_name: 'zack' },
      ];
      if (ops.eq) return all.filter((p) => (p as Record<string, string>)[ops.eq![0]] === ops.eq![1]);
      if (ops.ins) return all.filter((p) => ops.ins![1].includes(p.merchant_id));
      return all;
    }
    if (table === 'merchant_relationships') return [{ id: 'rel-1', merchant_a_id: 'MA', merchant_b_id: 'MB', status: 'active' }];
    if (table === 'merchant_loan_moves') {
      // RLS: only the two participants can read.
      return db.moves
        .filter((r) => r.proposer === current.side || r.responder === current.side)
        .map((r) => ({
          id: r.id, proposer_user_id: MERCHANTS[r.proposer].uid, responder_user_id: MERCHANTS[r.responder].uid,
          proposer_merchant_id: MERCHANTS[r.proposer].merchantId, responder_merchant_id: MERCHANTS[r.responder].merchantId,
          direction: r.direction, amount_usdt: r.amount, moved_at: r.at, status: r.status,
        }));
    }
    void m;
    return [];
  }
  return q;
}

const channels = new Map<string, { subscribed: boolean }>();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: me().uid } } }) },
    from: (t: string) => select(t),
    rpc: async (fn: string, a: Record<string, unknown>) => {
      const mine = current.side;
      const other: Side = mine === 'A' ? 'B' : 'A';
      if (fn === 'create_merchant_loan_move') {
        const row: Row = { id: `mv${(db.seq += 1)}`, proposer: mine, responder: other, direction: a.p_direction as 'out' | 'in', amount: Number(a.p_amount), at: String(a.p_moved_at), status: 'pending' };
        db.moves.push(row);
        return { data: row.id, error: null };
      }
      const row = db.moves.find((r) => r.id === (a.p_move_id as string));
      if (fn === 'respond_merchant_loan_move') {
        if (!row || row.responder !== mine) return { error: new Error('not allowed to respond') };
        if (row.status !== 'pending') return { error: new Error('already answered') };
        row.status = a.p_accept ? 'approved' : 'rejected';
        return { error: null };
      }
      if (fn === 'cancel_merchant_loan_move') {
        if (!row || row.proposer !== mine || row.status !== 'pending') return { error: new Error('cannot cancel') };
        row.status = 'cancelled';
        return { error: null };
      }
      return { data: null, error: null };
    },
    channel: (name: string) => {
      // Real client: a repeated name returns the same subscribed channel, and adding a listener then throws.
      const existing = channels.get(name);
      const c = existing ?? { subscribed: false };
      channels.set(name, c);
      const api = {
        on: () => { if (c.subscribed) throw new Error(`cannot add postgres_changes callbacks for realtime:${name} after subscribe()`); return api; },
        subscribe: () => { c.subscribed = true; return api; },
      };
      return api;
    },
    removeChannel: () => {},
  },
}));

import { LoansPanel } from '@/features/stock/components/LoansPanel';

// ── Each merchant's own tracker ──
const emptyState = (usdt: number): TrackerState => ({
  currency: 'QAR', range: 'all',
  batches: usdt ? [{ id: 'b', ts: 1, source: 'S', note: '', buyPriceQAR: 3.7, initialUSDT: usdt, revisions: [] }] : [],
  trades: [], customers: [], suppliers: [], cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts: [], cashLedger: [], customerLoans: [], usdtTransfers: [],
  settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 10, selectedDay: null },
} as unknown as TrackerState);
const trackers: Record<Side, TrackerState> = { A: emptyState(50000), B: emptyState(0) };
const commits: Record<Side, number> = { A: 0, B: 0 };

/** Opens a merchant's Loans screen, like signing in as them. Remounting stands in for the realtime refresh. */
function openAs(side: Side) {
  cleanup();
  channels.clear();
  current.side = side;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LoansPanel
          state={trackers[side]}
          derived={computeFIFO(trackers[side].batches, trackers[side].trades, trackers[side].usdtTransfers)}
          applyStateAndCommit={async (next) => { trackers[side] = next; commits[side] += 1; await Promise.resolve(); act(() => { utils.rerender(view()); }); }}
          onImportPurchase={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(view());
  return utils;
}

/** Records a loan movement through the Record movement button and the dialog, as a merchant would. */
async function recordMovement(direction: 'out' | 'in', amount: string) {
  fireEvent.click(screen.getAllByText('loansRecordMovement')[0]);
  fireEvent.click(await screen.findByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(current.side === 'A' ? 'zack' : 'MOHAMED') }));
  if (direction === 'in') fireEvent.click(screen.getByText('loansReceivedUsdt'));
  fireEvent.change(screen.getByLabelText('mloanAmount'), { target: { value: amount } });
  fireEvent.click(screen.getByText('loansSaveMovement'));
}

const net = (side: Side, name: string) => merchantNet(trackers[side].usdtTransfers, name);

describe('connected loan, both merchants', () => {
  beforeEach(() => {
    db.moves = []; db.seq = 0;
    trackers.A = emptyState(50000); trackers.B = emptyState(0);
    commits.A = 0; commits.B = 0;
  });

  it('A sends 10,000: it appears for B, B approves, both ledgers agree — then B returns 4,000 and A approves', async () => {
    // 1. Mohamed records "I sent 10,000 USDT" to zack. The Record movement dialog opens without crashing.
    openAs('A');
    await recordMovement('out', '10000');
    await waitFor(() => expect(db.moves).toHaveLength(1));
    expect(db.moves[0]).toMatchObject({ proposer: 'A', responder: 'B', direction: 'out', amount: 10000, status: 'pending' });
    await waitFor(() => expect(commits.A).toBe(1));
    expect(trackers.A.usdtTransfers).toEqual([expect.objectContaining({ kind: 'lend_out', amountUSDT: 10000, remoteLoanId: 'mv1', counterpartyName: 'zack' })]);
    expect(await screen.findByText('loansWaiting')).toBeTruthy(); // waiting on zack

    // 2. zack signs in: the request is there at once, with Approve / Reject. Nothing is booked yet.
    openAs('B');
    expect(await screen.findByText('loansReqSentYou')).toBeTruthy();
    expect(trackers.B.usdtTransfers).toHaveLength(0);
    fireEvent.click(screen.getByText('loansApprove'));
    await waitFor(() => expect(db.moves[0].status).toBe('approved'));
    // Approving books it on zack's side: he borrowed 10,000 from Mohamed.
    await waitFor(() => expect(trackers.B.usdtTransfers).toHaveLength(1));
    expect(trackers.B.usdtTransfers![0]).toMatchObject({ kind: 'borrow_in', amountUSDT: 10000, counterpartyName: 'MOHAMED' });
    expect(net('B', 'MOHAMED')).toBe(10000); // zack owes
    expect(screen.queryByText('loansReqSentYou')).toBeNull();

    // 3. Mohamed comes back: the movement is approved, still booked exactly once.
    openAs('A');
    await waitFor(() => expect(screen.queryByText('loansWaiting')).toBeNull());
    expect(trackers.A.usdtTransfers).toHaveLength(1);
    expect(net('A', 'zack')).toBe(-10000); // zack owes Mohamed

    // 4. The other direction: zack sends 4,000 back, Mohamed approves.
    openAs('B');
    await recordMovement('out', '4000');
    await waitFor(() => expect(db.moves).toHaveLength(2));
    expect(db.moves[1]).toMatchObject({ proposer: 'B', responder: 'A', direction: 'out', amount: 4000, status: 'pending' });
    await waitFor(() => expect(trackers.B.usdtTransfers).toHaveLength(2));
    expect(trackers.B.usdtTransfers![1]).toMatchObject({ kind: 'borrow_repay', amountUSDT: 4000 });

    openAs('A');
    expect(await screen.findByText('loansReqSentYou')).toBeTruthy();
    fireEvent.click(screen.getByText('loansApprove'));
    await waitFor(() => expect(db.moves[1].status).toBe('approved'));
    await waitFor(() => expect(trackers.A.usdtTransfers).toHaveLength(2));
    expect(trackers.A.usdtTransfers![1]).toMatchObject({ kind: 'lend_return', amountUSDT: 4000, counterpartyName: 'zack' });

    // 5. Both ledgers say the same thing: zack still owes Mohamed 6,000.
    expect(net('A', 'zack')).toBe(-6000);
    expect(net('B', 'MOHAMED')).toBe(6000);

    // 6. Stock moved by the same amounts on each side, with no sale and no profit.
    const dA = computeFIFO(trackers.A.batches, trackers.A.trades, trackers.A.usdtTransfers);
    expect(dA.batches.reduce((s, b) => s + b.remainingUSDT, 0)).toBe(50000 - 10000 + 4000);
    expect(trackers.A.trades).toHaveLength(0);
    expect(trackers.B.trades).toHaveLength(0);
  });

  it('a rejected request is taken back out of the sender, and nothing is booked for the receiver', async () => {
    openAs('A');
    await recordMovement('out', '500');
    await waitFor(() => expect(trackers.A.usdtTransfers).toHaveLength(1));

    openAs('B');
    expect(await screen.findByText('loansReqSentYou')).toBeTruthy();
    fireEvent.click(screen.getByText('loansReject'));
    await waitFor(() => expect(db.moves[0].status).toBe('rejected'));
    expect(trackers.B.usdtTransfers).toHaveLength(0);

    openAs('A');
    await waitFor(() => expect(trackers.A.usdtTransfers!.every((x) => x.voided)).toBe(true));
    expect(net('A', 'zack')).toBe(0);
  });

  it('a withdrawn request disappears for the receiver and is taken back out of the sender', async () => {
    openAs('A');
    await recordMovement('out', '700');
    await waitFor(() => expect(trackers.A.usdtTransfers).toHaveLength(1));
    fireEvent.click(await screen.findByText('loansWithdraw'));
    await waitFor(() => expect(db.moves[0].status).toBe('cancelled'));
    await waitFor(() => expect(trackers.A.usdtTransfers!.every((x) => x.voided)).toBe(true));

    openAs('B');
    await waitFor(() => expect(screen.queryByText('loansReqSentYou')).toBeNull());
    expect(trackers.B.usdtTransfers).toHaveLength(0);
  });

  it('"I received" is mirrored the other way round: the sender lends, the receiver borrows', async () => {
    openAs('B');
    await recordMovement('in', '2500'); // zack says he received 2,500 from Mohamed
    await waitFor(() => expect(db.moves).toHaveLength(1));
    expect(db.moves[0]).toMatchObject({ proposer: 'B', direction: 'in', amount: 2500 });
    await waitFor(() => expect(trackers.B.usdtTransfers).toHaveLength(1));
    expect(trackers.B.usdtTransfers![0]).toMatchObject({ kind: 'borrow_in', amountUSDT: 2500 });

    openAs('A');
    expect(await screen.findByText('loansReqYouSent')).toBeTruthy(); // "zack says you sent them 2,500"
    fireEvent.click(screen.getByText('loansApprove'));
    await waitFor(() => expect(trackers.A.usdtTransfers).toHaveLength(1));
    expect(trackers.A.usdtTransfers![0]).toMatchObject({ kind: 'lend_out', amountUSDT: 2500, counterpartyName: 'zack' });
    expect(net('A', 'zack')).toBe(-2500);
    expect(net('B', 'MOHAMED')).toBe(2500);
  });
});
