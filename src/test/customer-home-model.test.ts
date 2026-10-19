import { describe, expect, it } from 'vitest';
import type { WorkflowOrder } from '@/features/orders/shared-order-workflow';
import { buildActivity, chartPoints, formatActivityStamp, formatPaymentStamp, rateTrend, recordRate, smoothPath, sparkPath } from '@/features/customer/home/home-model';

const order = (over: Partial<WorkflowOrder>): WorkflowOrder => ({
  id: 'o', customer_user_id: 'c', merchant_id: 'm', connection_id: 'x', order_type: 't', amount: 100, currency: 'QAR', status: 's', note: null,
  workflow_status: 'approved', placed_by_role: 'merchant', placed_by_user_id: null, approval_required_from_role: null, approved_by_user_id: null,
  approved_at: null, rejected_by_user_id: null, rejected_at: null, rejection_reason: null, revision_no: 0, edited_from_order_id: null, fx_rate: 14,
  fulfillment_mode: null, usdt_qar_rate: null, required_usdt: null, send_country: null, receive_country: null, send_currency: 'QAR', receive_currency: 'EGP',
  payout_rail: null, corridor_label: null, created_at: new Date(2026, 9, 13, 12, 0).toISOString(), updated_at: '', ...over,
} as WorkflowOrder);

describe('buildActivity', () => {
  it('shows a payment the buyer reported while it waits for the merchant, but not accepted or withdrawn ones', () => {
    const rows = buildActivity({
      orders: [],
      payments: [],
      claims: [
        { id: 'p', ts: 3000, amount: 60000, status: 'pending' },
        { id: 'r', ts: 2000, amount: 100, status: 'rejected' },
        { id: 'a', ts: 1500, amount: 200, status: 'accepted' },
        { id: 'w', ts: 1000, amount: 300, status: 'withdrawn' },
      ],
    });
    expect(rows.map(r => [r.claimState, r.amount])).toEqual([['pending', 60000], ['rejected', 100]]);
    expect(rows[0]).toMatchObject({ kind: 'paid', sign: '-', status: 'proc' });
  });

  it('lists orders the merchant recorded on credit alongside payments, newest first', () => {
    const rows = buildActivity({
      orders: [],
      payments: [{ date: 1000, amount: 500 }],
      loans: [
        { ref: 'A', date: 3000, amount: 8000, paid: 0, settled: false, currency: 'QAR', egpAmount: 112000 },
        { ref: 'B', date: 2000, amount: 4000, paid: 1000, settled: false },
        { ref: 'C', date: 500, amount: 100, paid: 100, settled: true },
      ],
      limit: 10,
    });
    expect(rows.map(r => r.kind)).toEqual(['loan', 'loan', 'paid', 'loan']);
    expect(rows.filter(r => r.kind === 'loan').map(r => r.loanState)).toEqual(['unpaid', 'partial', 'settled']);
    // an order whose exchange record is known reads in the Egyptian pound the buyer received
    expect(rows[0]).toMatchObject({ sign: '+', amount: 112000, currency: 'EGP', loanPct: 0 });
    expect(rows[1]).toMatchObject({ amount: 4000, currency: undefined, loanPct: 25 });
  });

  it('maps the three kinds of rows the design shows', () => {
    const rows = buildActivity({
      orders: [
        order({ id: 'a', placed_by_role: 'merchant', workflow_status: 'approved', created_at: new Date(2026, 9, 13, 12).toISOString() }),
        order({ id: 'b', workflow_status: 'pending_customer_approval', created_at: new Date(2026, 9, 12, 9, 45).toISOString() }),
        order({ id: 'c', placed_by_role: 'customer', workflow_status: 'approved', created_at: new Date(2026, 9, 11, 16, 20).toISOString() }),
      ],
      payments: [],
    });
    expect(rows.map(r => [r.kind, r.sign, r.status])).toEqual([['received', '+', 'ok'], ['new', '+', 'proc'], ['paid', '-', 'bad']]);
  });
  it('merges payments in by date and keeps the newest three', () => {
    const rows = buildActivity({ orders: [order({ id: 'a' })], payments: [{ date: new Date(2026, 9, 14).getTime(), amount: 500 }, { date: new Date(2026, 9, 1).getTime(), amount: 1 }, { date: new Date(2026, 8, 1).getTime(), amount: 2 }] });
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows[0].amount).toBe(500);
  });
  it('marks cancelled orders', () => {
    const [r] = buildActivity({ orders: [order({ workflow_status: 'cancelled' })], payments: [] });
    expect(r.cancelled).toBe(true);
    expect(r.status).toBe('bad');
  });
});

describe('stamps', () => {
  const ts = new Date(2026, 9, 13, 12, 0).getTime();
  it('uses western digits and a 24-hour clock', () => {
    expect(formatActivityStamp(ts, 'ar')).toMatch(/^13 .+ 2026 • 12:00$/);
    expect(formatPaymentStamp(ts, 'ar')).toMatch(/^13 .+ 2026, 12:00$/);
    expect(formatActivityStamp(ts, 'en')).toContain('13 October 2026');
  });
});

describe('rate trend', () => {
  const now = Date.UTC(2026, 9, 14, 12);
  it('records a reading only when the value moved or half an hour passed', () => {
    const one = recordRate([], 54, now);
    expect(recordRate(one, 54, now + 60_000)).toBe(one);
    expect(recordRate(one, 54, now + 31 * 60_000)).toHaveLength(2);
    expect(recordRate(one, 54.1, now + 60_000)).toHaveLength(2);
    expect(recordRate(one, null, now)).toBe(one);
  });
  it('reports the change against the oldest reading of the last day', () => {
    const history = [{ t: now - 30 * 3600_000, v: 50 }, { t: now - 5 * 3600_000, v: 54 }, { t: now, v: 54.54 }];
    const t = rateTrend(history, now);
    expect(t.pct).toBeCloseTo(1, 1);
    expect(t.up).toBe(true);
    expect(rateTrend([{ t: now, v: 54 }], now)).toMatchObject({ pct: 0, up: true });
  });
  it('shows a falling rate as down', () => {
    expect(rateTrend([{ t: now - 3600_000, v: 55 }, { t: now, v: 54 }], now).up).toBe(false);
  });
});

describe('chart geometry', () => {
  it('climbs from the baseline to the top and keeps x positions', () => {
    const pts = chartPoints([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [10, 20, 30, 40, 50, 60, 70, 80], 60, 170);
    expect(pts.map(p => p.x)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(pts[7].y).toBe(60);
    expect(pts[0].y).toBeGreaterThan(pts[3].y);
  });
  it('is flat on the baseline with no volume', () => {
    expect(chartPoints([0, 0, 0], [1, 2], 10, 100).map(p => p.y)).toEqual([100, 100]);
  });
  it('builds paths', () => {
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toMatch(/^M0.0 0.0 C/);
    expect(sparkPath([1, 2, 3], 20, 10)).toBe('M0.0 10.0 L10.0 5.0 L20.0 0.0');
    expect(sparkPath([], 20, 10)).toBe('M0 5 L20 5');
  });
});
