// Smoke test: consignment corrections between two merchants, driven through the real screens on both sides.
// The backend is an in-memory stand-in following the same rules as the consignment SQL (participants only,
// the other side answers, counter = reject + replace, ratio changes by agreement and snapshotted per report,
// cancel by the sender only before anything is confirmed) and, like the real realtime client, throws when a
// listener is added to a channel that is already subscribed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { computeFIFO, totalStock, type TrackerState } from '@/lib/tracker-helpers';
import { findConsignment } from '@/features/stock/consignment';

vi.mock('@/lib/i18n', () => ({ useT: () => Object.assign((k: string) => k, { lang: 'en', isRTL: false }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const MERCHANTS = {
  A: { uid: 'uA', merchantId: 'MA', name: 'MOHAMED' },
  B: { uid: 'uB', merchantId: 'MB', name: 'zack' },
} as const;
type Side = keyof typeof MERCHANTS;
const current = { side: 'A' as Side };
const me = () => MERCHANTS[current.side];
const uidOf = (s: Side) => MERCHANTS[s].uid;
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ user: { id: me().uid } }) }));

type Cons = { id: string; sender: Side; receiver: Side; qty: number; base: number; share: number; ref: string | null; status: 'open' | 'closed' | 'cancelled'; pendingShare: number | null; pendingBy: Side | null };
type Ev = { id: string; cid: string; kind: 'sale' | 'return' | 'purchase' | 'settlement'; qty: number; price: number | null; by: Side; status: 'pending' | 'confirmed' | 'rejected'; share: number; replaces: string | null; seq: number };
const db = { cons: [] as Cons[], evs: [] as Ev[], seq: 0 };
const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');
const openQty = (c: Cons) => c.qty - db.evs.filter((e) => e.cid === c.id && (e.kind === 'sale' || e.kind === 'return') && e.status !== 'rejected').reduce((s, e) => s + e.qty, 0);

function rpc(fn: string, a: Record<string, unknown>): { data?: unknown; error?: Error } {
  const mine = current.side;
  const cons = (id: unknown) => db.cons.find((c) => c.id === id);
  const fail = (m: string) => ({ error: new Error(m) });
  const report = (cid: string, kind: Ev['kind'], qty: number, price: number | null): { data?: unknown; error?: Error } => {
    const c = cons(cid);
    if (!c || (c.sender !== mine && c.receiver !== mine)) return fail('consignment not found');
    if (c.status !== 'open' && (kind === 'sale' || kind === 'return')) return fail('consignment is closed');
    if ((kind === 'sale' || kind === 'return') && qty > openQty(c) + 1e-6) return fail('quantity exceeds what is still with the receiver');
    if (kind === 'sale' && !(price && price > 0)) return fail('sale price must be positive');
    const e: Ev = { id: `ev${(db.seq += 1)}`, cid, kind, qty, price: kind === 'return' ? null : price, by: mine, status: 'pending', share: c.share, replaces: null, seq: db.seq };
    db.evs.push(e);
    return { data: e.id };
  };
  switch (fn) {
    case 'create_merchant_consignment_v2': {
      const c: Cons = { id: `cn${(db.seq += 1)}`, sender: mine, receiver: other(mine), qty: Number(a.p_qty), base: Number(a.p_base_price), share: Number(a.p_sender_share_pct), ref: (a.p_tracker_ref as string) ?? null, status: 'open', pendingShare: null, pendingBy: null };
      db.cons.push(c);
      return { data: c.id };
    }
    case 'report_consignment_event_v2': return report(a.p_consignment_id as string, a.p_kind as Ev['kind'], Number(a.p_qty), a.p_price == null ? null : Number(a.p_price));
    case 'respond_consignment_event': {
      const e = db.evs.find((x) => x.id === a.p_event_id);
      if (!e || e.by === mine) return fail('not allowed to respond');
      if (e.status !== 'pending') return fail('already answered');
      e.status = a.p_accept ? 'confirmed' : 'rejected';
      const c = cons(e.cid)!;
      if (a.p_accept && openQty(c) <= 1e-6 && !db.evs.some((x) => x.cid === c.id && x.status === 'pending' && (x.kind === 'sale' || x.kind === 'return'))) c.status = 'closed';
      return {};
    }
    case 'counter_consignment_event': {
      const e = db.evs.find((x) => x.id === a.p_event_id);
      if (!e || e.by === mine || e.status !== 'pending') return fail('not allowed to respond');
      e.status = 'rejected';
      const r = report(e.cid, e.kind, Number(a.p_qty), a.p_price == null ? null : Number(a.p_price));
      if (r.error) return r;
      db.evs.find((x) => x.id === r.data)!.replaces = e.id;
      return r;
    }
    case 'propose_consignment_share': {
      const c = cons(a.p_consignment_id);
      if (!c || c.status !== 'open') return fail('consignment is not open');
      c.pendingShare = Number(a.p_sender_share_pct); c.pendingBy = mine;
      return {};
    }
    case 'respond_consignment_share': {
      const c = cons(a.p_consignment_id);
      if (!c || c.pendingShare == null || c.pendingBy === mine) return fail('not allowed to respond');
      if (a.p_accept) c.share = c.pendingShare;
      c.pendingShare = null; c.pendingBy = null;
      return {};
    }
    case 'withdraw_consignment_share': {
      const c = cons(a.p_consignment_id);
      if (!c || c.pendingBy !== mine) return fail('nothing to withdraw');
      c.pendingShare = null; c.pendingBy = null;
      return {};
    }
    case 'cancel_merchant_consignment': {
      const c = cons(a.p_consignment_id);
      if (!c || c.sender !== mine) return fail('not allowed');
      if (db.evs.some((e) => e.cid === c!.id && e.status === 'confirmed')) return fail('consignment has confirmed events');
      db.evs.filter((e) => e.cid === c.id && e.status === 'pending').forEach((e) => { e.status = 'rejected'; });
      c.status = 'cancelled';
      return {};
    }
    default: return {};
  }
}

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
    if (table === 'merchant_profiles') {
      const all = [{ merchant_id: 'MA', user_id: 'uA', display_name: 'MOHAMED' }, { merchant_id: 'MB', user_id: 'uB', display_name: 'zack' }];
      if (ops.eq) return all.filter((p) => (p as Record<string, string>)[ops.eq![0]] === ops.eq![1]);
      if (ops.ins) return all.filter((p) => ops.ins![1].includes(p.merchant_id));
      return all;
    }
    if (table === 'merchant_relationships') return [{ id: 'rel-1', merchant_a_id: 'MA', merchant_b_id: 'MB', status: 'active' }];
    if (table === 'merchant_consignments') {
      return db.cons.map((c) => ({
        id: c.id, relationship_id: 'rel-1', sender_merchant_id: MERCHANTS[c.sender].merchantId, receiver_merchant_id: MERCHANTS[c.receiver].merchantId,
        sender_user_id: uidOf(c.sender), receiver_user_id: uidOf(c.receiver), qty_usdt: c.qty, base_price_qar: c.base, sender_share_pct: c.share,
        tracker_ref: c.ref, status: c.status, created_at: '2026-11-20T00:00:00Z',
        pending_share_pct: c.pendingShare, pending_share_by: c.pendingBy ? uidOf(c.pendingBy) : null,
      }));
    }
    if (table === 'merchant_consignment_events') {
      return db.evs.map((e) => ({
        id: e.id, consignment_id: e.cid, kind: e.kind, qty_usdt: e.qty, price_qar: e.price, amount_qar: null, funded_from_sale_id: null,
        reported_by: uidOf(e.by), status: e.status, created_at: `2026-11-20T00:00:${String(10 + e.seq).padStart(2, '0')}Z`,
        sender_share_pct: e.share, replaces_event_id: e.replaces,
      }));
    }
    return [];
  }
  return q;
}

const channels = new Map<string, { subscribed: boolean }>();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: me().uid } } }) },
    from: (t: string) => select(t),
    rpc: async (fn: string, a: Record<string, unknown>) => ({ data: null, error: null, ...rpc(fn, a) }),
    channel: (name: string) => {
      const c = channels.get(name) ?? { subscribed: false };
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

// Exchange records waiting in "needs a decision" (merchant A only).
const exchangeApi = { dismissTransfer: vi.fn(async () => {}), undismissTransfer: vi.fn(async () => {}), addOrderLink: vi.fn(async () => {}), removeOrderLink: vi.fn(async () => {}), dismissExchangeRecord: vi.fn(async () => {}), restoreExchangeRecord: vi.fn(async () => {}) };
vi.mock('@/features/exchanges/api', () => ({
  dismissTransfer: (...a: unknown[]) => exchangeApi.dismissTransfer(...(a as [])),
  undismissTransfer: (...a: unknown[]) => exchangeApi.undismissTransfer(...(a as [])),
  addOrderLink: (...a: unknown[]) => exchangeApi.addOrderLink(...(a as [])),
  removeOrderLink: (...a: unknown[]) => exchangeApi.removeOrderLink(...(a as [])),
  dismissExchangeRecord: (...a: unknown[]) => exchangeApi.dismissExchangeRecord(...(a as [])),
  restoreExchangeRecord: (...a: unknown[]) => exchangeApi.restoreExchangeRecord(...(a as [])),
}));
const records = { transfers: [] as unknown[] };
vi.mock('@/features/exchanges/hooks/useExchangeTransfers', () => ({ useExchangeTransfers: () => ({ data: records.transfers }) }));
vi.mock('@/features/exchanges/hooks/useExchangeP2POrders', () => ({ useExchangeP2POrders: () => ({ data: [] }) }));
vi.mock('@/features/exchanges/hooks/useExchangeOrderLinks', () => ({ useExchangeOrderLinks: () => ({ data: new Map() }), sumLinkedAmount: () => 0 }));

import { ConsignmentsPanel } from '@/features/stock/components/ConsignmentsPanel';
import { LoansPanel } from '@/features/stock/components/LoansPanel';

// A real merchant has a cash account; booking a consignment sale as the receiver needs one to hold the proceeds.
const cashAccounts = [{ id: 'cash1', name: 'Cash', type: 'hand', currency: 'QAR', status: 'active', createdAt: 0 }];
const emptyState = (usdt: number): TrackerState => ({
  currency: 'QAR', range: 'all',
  batches: usdt ? [{ id: 'b', ts: 1, source: 'S', note: '', buyPriceQAR: 3.7, initialUSDT: usdt, revisions: [] }] : [],
  trades: [], customers: [], suppliers: [], cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts, cashLedger: [], customerLoans: [], usdtTransfers: [],
  settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 10, selectedDay: null },
} as unknown as TrackerState);
const trackers: Record<Side, TrackerState> = { A: emptyState(50000), B: emptyState(0) };

type Screen = 'consignments' | 'loans';
function openAs(side: Side, which: Screen = 'consignments') {
  cleanup();
  channels.clear();
  current.side = side;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const derived = () => computeFIFO(trackers[side].batches, trackers[side].trades, trackers[side].usdtTransfers);
  const view = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        {which === 'consignments'
          ? <ConsignmentsPanel state={trackers[side]} derived={derived()} applyStateAndCommit={commit} />
          : <LoansPanel state={trackers[side]} derived={derived()} applyStateAndCommit={commit} onImportPurchase={vi.fn()} />}
      </MemoryRouter>
    </QueryClientProvider>
  );
  async function commit(next: TrackerState) { trackers[side] = next; await Promise.resolve(); act(() => { utils.rerender(view()); }); }
  const utils = render(view());
  return utils;
}

const stockOf = (s: Side) => totalStock(computeFIFO(trackers[s].batches, trackers[s].trades, trackers[s].usdtTransfers));
const netOf = (s: Side, id: string) => computeFIFO(trackers[s].batches, trackers[s].trades, trackers[s].usdtTransfers).tradeCalc.get(id)!.netQAR;

async function sendFromA(qty: string, share = '50') {
  openAs('A');
  await screen.findByRole('option', { name: 'zack' });
  fireEvent.change(screen.getByLabelText('consMerchant'), { target: { value: 'rel-1' } });
  fireEvent.change(screen.getByPlaceholderText('consQty'), { target: { value: qty } });
  fireEvent.change(screen.getByPlaceholderText('consMyShare'), { target: { value: share } });
  fireEvent.click(screen.getByText('consSend'));
  await waitFor(() => expect(db.cons).toHaveLength(1));
  await waitFor(() => expect(trackers.A.usdtTransfers).toHaveLength(1));
}
async function reportSale(qty: string, price: string) {
  fireEvent.click(await screen.findByText('consReportSold'));
  // The send form above also has a quantity box; the report form is the last one on screen.
  const qtyBoxes = screen.getAllByPlaceholderText('consQty');
  fireEvent.change(qtyBoxes[qtyBoxes.length - 1], { target: { value: qty } });
  fireEvent.change(screen.getByPlaceholderText('consPrice'), { target: { value: price } });
  fireEvent.click(screen.getByText('consSendBtn'));
}

describe('consignment corrections, both merchants', () => {
  beforeEach(() => {
    db.cons = []; db.evs = []; db.seq = 0; records.transfers = [];
    trackers.A = emptyState(50000); trackers.B = emptyState(0);
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('counter a wrong price; then change the ratio by agreement and see it apply only to later sales', async () => {
    await sendFromA('10000');
    expect(trackers.A.usdtTransfers![0].consignment!.remoteId).toBe('cn1');
    expect(stockOf('A')).toBe(40000);

    // zack reports a sale at the wrong price.
    openAs('B');
    expect(await screen.findByText('consIncoming')).toBeTruthy();
    await reportSale('6000', '3.80');
    await waitFor(() => expect(db.evs).toHaveLength(1));

    // Mohamed counters with the right price instead of rejecting.
    openAs('A');
    fireEvent.click(await screen.findByText('consCounter'));
    fireEvent.change(screen.getByLabelText('consPrice'), { target: { value: '3.85' } });
    fireEvent.click(screen.getByText('consSendCounter'));
    await waitFor(() => expect(db.evs).toHaveLength(2));
    expect(db.evs[0].status).toBe('rejected');
    expect(db.evs[1]).toMatchObject({ kind: 'sale', price: 3.85, by: 'A', status: 'pending', replaces: db.evs[0].id });

    // zack confirms the corrected sale; both trackers book it at 3.85.
    openAs('B');
    fireEvent.click(await screen.findByText('consConfirm'));
    await waitFor(() => expect(db.evs[1].status).toBe('confirmed'));
    await waitFor(() => expect(trackers.B.trades).toHaveLength(1));
    expect(trackers.B.trades[0]).toMatchObject({ amountUSDT: 6000, sellPriceQAR: 3.85 });
    openAs('A');
    await waitFor(() => expect(trackers.A.trades).toHaveLength(1));
    expect(trackers.A.trades[0]).toMatchObject({ amountUSDT: 6000, sellPriceQAR: 3.85 });
    expect(netOf('A', db.evs[1].id)).toBeCloseTo(6000 * 0.15 * 0.5, 6); // 450
    expect(netOf('B', db.evs[1].id)).toBeCloseTo(6000 * 0.15 * 0.5, 6); // 450 — both sides agree

    // zack asks for 60% for himself (sender 40%); Mohamed accepts.
    openAs('B');
    fireEvent.click(await screen.findByText('consChangeRatio'));
    fireEvent.change(screen.getByLabelText('consMyShare'), { target: { value: '60' } });
    fireEvent.click(screen.getByText('consSendBtn'));
    await waitFor(() => expect(db.cons[0].pendingShare).toBe(40));
    openAs('A');
    fireEvent.click(await screen.findByText('consConfirm'));
    await waitFor(() => expect(db.cons[0].share).toBe(40));
    openAs('A');
    await waitFor(() => expect(findConsignment(trackers.A, trackers.A.usdtTransfers![0].id)!.profitSharePct).toBe(40));

    // A later sale uses the new ratio; the earlier one is untouched.
    openAs('B');
    await reportSale('2000', '3.90');
    await waitFor(() => expect(db.evs).toHaveLength(3));
    expect(db.evs[2].share).toBe(40);
    openAs('A');
    fireEvent.click(await screen.findByText('consConfirm'));
    await waitFor(() => expect(db.evs[2].status).toBe('confirmed'));
    await waitFor(() => expect(trackers.A.trades).toHaveLength(2));
    expect(netOf('A', db.evs[2].id)).toBeCloseTo(2000 * 0.20 * 0.40, 6); // 160 at the new ratio
    expect(netOf('A', db.evs[1].id)).toBeCloseTo(450, 6); // unchanged
    openAs('B');
    await waitFor(() => expect(trackers.B.trades).toHaveLength(2));
    expect(netOf('B', db.evs[2].id)).toBeCloseTo(2000 * 0.20 * 0.60, 6); // his 60% of the later sale: 240
  });

  it('a cancelled consignment: pending reports are rejected, the receiver is told, and the sender gets the stock back', async () => {
    await sendFromA('3000');
    expect(stockOf('A')).toBe(47000);
    openAs('B');
    await reportSale('500', '3.80');
    await waitFor(() => expect(db.evs).toHaveLength(1));

    openAs('A');
    fireEvent.click(await screen.findByText('consCancel'));
    await waitFor(() => expect(db.cons[0].status).toBe('cancelled'));
    expect(db.evs[0].status).toBe('rejected');
    await waitFor(() => expect(stockOf('A')).toBe(50000)); // the USDT is back in stock
    expect(trackers.A.usdtTransfers!.every((x) => x.voided)).toBe(true);

    openAs('B');
    expect(await screen.findByText('consCancelledLabel')).toBeTruthy();
    expect(screen.queryByText('consReportSold')).toBeNull(); // nothing more can be reported
  });

  it('a cancel is refused once a sale is confirmed', async () => {
    await sendFromA('1000');
    openAs('B');
    await reportSale('100', '3.80');
    await waitFor(() => expect(db.evs).toHaveLength(1));
    openAs('A');
    fireEvent.click(await screen.findByText('consConfirm'));
    await waitFor(() => expect(db.evs[0].status).toBe('confirmed'));
    await waitFor(() => expect(trackers.A.trades).toHaveLength(1));
    expect(screen.queryByText('consCancel')).toBeNull();
  });

  describe('USDT coming back arrives as an exchange record', () => {
    const incoming = () => ({ id: 't-in', exchange: 'binance', kind: 'pay', direction: 'in', asset: 'USDT', amount: 4000, status: 'ok', reference: 'R2', counterparty: 'zack', network: null, transfer_time: new Date(2026, 10, 5).toISOString(), linked_entity_type: null, linked_entity_id: null, linked_at: null, dismissed_at: null, created_at: '' });

    async function recordReturnFromRecord() {
      await sendFromA('10000');
      records.transfers = [incoming()];
      openAs('A', 'loans');
      fireEvent.click(await screen.findByRole('tab', { name: /loansReview/ }));
      fireEvent.click(await screen.findByText('consItsReturn'));
      fireEvent.click(await screen.findByText('consSave'));
      await waitFor(() => expect(db.evs).toHaveLength(1));
      expect(db.evs[0]).toMatchObject({ kind: 'return', qty: 4000, by: 'A', status: 'pending' });
      await waitFor(() => expect(trackers.A.usdtTransfers).toHaveLength(2));
    }

    it('books a return at the original cost, hides the record, and does not book it twice once zack confirms', async () => {
      await recordReturnFromRecord();
      const ret = trackers.A.usdtTransfers![1];
      expect(ret).toMatchObject({ kind: 'lend_return', amountUSDT: 4000, remoteEventId: db.evs[0].id });
      expect(exchangeApi.dismissTransfer).toHaveBeenCalledWith('t-in');
      expect(stockOf('A')).toBe(44000);
      expect(trackers.A.batches).toHaveLength(1); // not booked as a purchase

      openAs('B');
      fireEvent.click(await screen.findByText('consConfirm'));
      await waitFor(() => expect(db.evs[0].status).toBe('confirmed'));
      openAs('A');
      await waitFor(() => expect(screen.queryByText('consConfirm')).toBeNull());
      await new Promise((r) => setTimeout(r, 200));
      expect(trackers.A.usdtTransfers!.filter((x) => x.kind === 'lend_return')).toHaveLength(1); // exactly once
      expect(stockOf('A')).toBe(44000);
    });

    it('takes the return back out and restores the record when zack rejects it', async () => {
      await recordReturnFromRecord();
      openAs('B');
      fireEvent.click(await screen.findByText('consReject'));
      await waitFor(() => expect(db.evs[0].status).toBe('rejected'));
      openAs('A');
      await waitFor(() => expect(trackers.A.usdtTransfers!.find((x) => x.kind === 'lend_return')!.voided).toBe(true));
      expect(exchangeApi.undismissTransfer).toHaveBeenCalledWith('t-in');
      expect(stockOf('A')).toBe(40000);
    });
  });
});
void within;
