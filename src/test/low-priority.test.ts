import { describe, expect, it } from 'vitest';
import { computeFIFO, stockCostQAR, totalStock, type TrackerState } from '@/lib/tracker-helpers';
import { getUsdtTransferBalances } from '@/lib/usdt-transfers';
import {
  recordConsignmentReturn, recordConsignmentSale, recordConsignmentShortfall, sendConsignment, undoConsignmentTransfer,
} from '@/features/stock/consignment';
import { undoConsignmentRecord } from '@/features/stock/consignment-sources';
import { applyLoanMove, canEditLoanMove, editLoanMove, undoLoanMove } from '@/features/stock/loan-ledger';
import { TransferFeeError, voidTransferFees, withTransferFee } from '@/features/stock/transfer-fee';
import { buildMerchantStatementData, buildMerchantStatementHtml, merchantStatementFileBase } from '@/features/stock/utils/merchantStatementExport';
import { TagError } from '@/features/stock/usdt-tagging';

const base = (usdt = 50000): TrackerState => ({
  batches: [{ id: 'b', ts: 1, source: 'S', note: '', buyPriceQAR: 3.7, initialUSDT: usdt, revisions: [] }],
  trades: [], usdtTransfers: [], cashAccounts: [], cashLedger: [], customerLoans: [],
}) as unknown as TrackerState;
const figs = (s: TrackerState) => {
  const d = computeFIFO(s.batches, s.trades, s.usdtTransfers);
  let pnl = 0;
  for (const t of s.trades) { const c = d.tradeCalc.get(t.id); if (c && !t.voided) pnl += c.netQAR; }
  return { stock: totalStock(d), cost: stockCostQAR(d), pnl };
};

describe('network fee on a move', () => {
  it('leaves stock at cost and shows as an expense, without any revenue', () => {
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'zack', qty: 10000 }, 100);
    s = withTransferFee(s, { feeUSDT: 2, feeOf: 'c1', counterpartyName: 'zack', ts: 100, id: 'f1' });
    expect(figs(s).stock).toBeCloseTo(40000 - 2, 6);
    expect(figs(s).pnl).toBeCloseTo(-2 * 3.7, 6);
    expect(s.trades[0]).toMatchObject({ transferFeeOf: 'c1', sellPriceQAR: 0, usesStock: true });
  });

  it('does nothing for no fee, books once, and refuses a fee the stock cannot cover', () => {
    const s = sendConsignment(base(10000), { id: 'c1', counterpartyName: 'zack', qty: 10000 }, 100);
    expect(withTransferFee(s, { feeUSDT: 0, feeOf: 'c1', counterpartyName: 'zack', ts: 100, id: 'f1' })).toBe(s);
    expect(() => withTransferFee(s, { feeUSDT: 5, feeOf: 'c1', counterpartyName: 'zack', ts: 100, id: 'f1' })).toThrow(TransferFeeError);
    const ok = withTransferFee(sendConsignment(base(), { id: 'c1', counterpartyName: 'zack', qty: 100 }, 100), { feeUSDT: 1, feeOf: 'c1', counterpartyName: 'zack', ts: 100, id: 'f1' });
    expect(withTransferFee(ok, { feeUSDT: 1, feeOf: 'c1', counterpartyName: 'zack', ts: 100, id: 'f1' }).trades).toHaveLength(1);
  });

  it('goes with the move when it is cancelled or undone', () => {
    const before = figs(base());
    let s = sendConsignment(base(), { id: 'c1', counterpartyName: 'zack', qty: 1000 }, 100);
    s = withTransferFee(s, { feeUSDT: 1, feeOf: 'c1', counterpartyName: 'zack', ts: 100, id: 'f1' });
    const a = undoConsignmentTransfer(s, 'c1');
    expect(a.trades[0].voided).toBe(true);
    expect(figs(a)).toEqual(before);
    const b = undoConsignmentRecord(s, 'c1');
    expect(figs(b.state)).toEqual(before);
    expect(voidTransferFees(a, ['c1'])).toBe(a); // nothing left to void
  });

  it('goes with a loan movement when it is undone', () => {
    const loan = applyLoanMove(base(), { type: 'manual', direction: 'out', ts: 100 }, 'Ahmed', 1000, (() => { let i = 0; return () => `l${i++}`; })());
    const withFee = withTransferFee(loan.state, { feeUSDT: 1, feeOf: 'l0', counterpartyName: 'Ahmed', ts: 100, id: 'f1' });
    const undone = undoLoanMove(withFee, 'l0');
    expect(undone.state.trades[0].voided).toBe(true);
    expect(figs(undone.state)).toEqual(figs(base()));
  });
});

describe('editing a hand-typed loan movement', () => {
  const loan = () => applyLoanMove(base(), { type: 'manual', direction: 'out', ts: 100 }, 'Ahmed', 1000, (() => { let i = 0; return () => `l${i++}`; })()).state;

  it('changes the amount, date and note, and stock and balance follow', () => {
    const s = editLoanMove(loan(), 'l0', { amountUSDT: 1500, ts: 200, note: 'corrected' }, 1000);
    expect(s.usdtTransfers![0]).toMatchObject({ amountUSDT: 1500, ts: 200, note: 'corrected' });
    expect(getUsdtTransferBalances(s.usdtTransfers)[0].owedToMe).toBe(1500);
    expect(figs(s).stock).toBe(48500);
  });

  it('rejects zero amounts and future dates', () => {
    expect(() => editLoanMove(loan(), 'l0', { amountUSDT: 0 })).toThrow(TagError);
    expect(() => editLoanMove(loan(), 'l0', { ts: Date.now() + 5 * 86_400_000 })).toThrow(TagError);
  });

  it('does not edit moves tied to an exchange record, a connected merchant, a split, or a consignment', () => {
    const t = loan().usdtTransfers![0];
    expect(canEditLoanMove(t)).toBe(true);
    expect(canEditLoanMove({ ...t, source: { type: 'batch', id: 'b' } })).toBe(false);
    expect(canEditLoanMove({ ...t, remoteLoanId: 'm1' })).toBe(false);
    expect(canEditLoanMove({ ...t, groupId: 'g' })).toBe(false);
    expect(canEditLoanMove({ ...t, consignment: { profitSharePct: 50, soldUSDT: 0 } })).toBe(false);
    expect(canEditLoanMove({ ...t, voided: true })).toBe(false);
    expect(() => editLoanMove({ ...loan(), usdtTransfers: [{ ...t, remoteLoanId: 'm1' }] } as TrackerState, 'l0', { amountUSDT: 5 })).toThrow(TagError);
  });
});

describe('statement for one merchant', () => {
  const build = () => {
    let s = applyLoanMove(base(), { type: 'manual', direction: 'out', ts: Date.UTC(2026, 9, 1) }, 'zack <b>&co</b>', 2000, (() => { let i = 0; return () => `l${i++}`; })()).state;
    s = sendConsignment(s, { id: 'c1', counterpartyName: 'zack <b>&co</b>', qty: 10000, profitSharePct: 50 }, Date.UTC(2026, 10, 1));
    s = recordConsignmentSale(s, { consignmentId: 'c1', saleId: 'e1', qty: 6000, priceQAR: 3.8, unitCostQAR: 3.7 }, Date.UTC(2026, 10, 3));
    s = recordConsignmentReturn(s, { consignmentId: 'c1', returnId: 'r1', qty: 3900 }, Date.UTC(2026, 10, 5));
    s = recordConsignmentShortfall(s, { consignmentId: 'c1', shortId: 'x1', qty: 100, unitCostQAR: 3.7 }, Date.UTC(2026, 10, 6));
    return s;
  };

  it('collects the loan lines, each consignment and the cash still owed', () => {
    const d = buildMerchantStatementData(build(), 'zack <b>&co</b>', { now: Date.UTC(2026, 10, 20) });
    expect(d.loanLines).toHaveLength(1);
    expect(d.loanNet).toBe(-2000);
    expect(d.consignments).toHaveLength(1);
    expect(d.consignments[0]).toMatchObject({ sent: 10000, sold: 6000, returned: 3900, short: 100, open: 0, status: 'closed' });
    expect(d.consignments[0].sales[0]).toMatchObject({ qty: 6000, price: 3.8, profitQAR: 300, dueQAR: 22500 });
    expect(d.cashDueQAR).toBe(22500);
  });

  it('is a safe, well-formed document: names escaped, tokens on .sheet, direction follows the language', () => {
    const d = buildMerchantStatementData(build(), 'zack <b>&co</b>', { lang: 'ar', now: Date.UTC(2026, 10, 20) });
    const html = buildMerchantStatementHtml(d);
    expect(html).not.toContain('<b>&co</b>');
    expect(html).toContain('&lt;b&gt;&amp;co&lt;/b&gt;');
    expect(html).toContain('dir="rtl"');
    expect(html).toMatch(/\.sheet\s*\{\s*--navy/); // variables live on .sheet …
    expect(html).not.toMatch(/:root\s*\{/); // … never :root
    expect(html.match(/class="sheet"/g)).toHaveLength(2); // loans and consignments, one page each
    expect(html).not.toMatch(/NaN|undefined/);
    expect(buildMerchantStatementHtml({ ...d, lang: 'en' })).toContain('dir="ltr"');
  });

  it('shows a merchant with nothing recorded as an empty, valid document', () => {
    const d = buildMerchantStatementData(base(), 'nobody', { now: 1 });
    const html = buildMerchantStatementHtml(d);
    expect(d.loanLines).toEqual([]);
    expect(html).toContain('Nothing to show');
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('names the file after the merchant and the day, safely', () => {
    const d = buildMerchantStatementData(base(), 'Mohamed / Abdelazim?', { now: Date.UTC(2026, 10, 20, 12) });
    expect(merchantStatementFileBase(d)).toBe('statement-Mohamed-Abdelazim-20261120');
  });
});
