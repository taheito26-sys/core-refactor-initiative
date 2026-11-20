// ─── A statement to send to one merchant ───
//
// Everything between me and one merchant on one page: the loan movements with
// the running balance, and every consignment with what was sold, returned and
// is still out, the profit split, and the cash still owed. Pure data and HTML
// builders, plus a PDF export on the shared pipeline (see htmlReportToPdf for
// why the document is built the way it is: the stylesheet variables live on
// .sheet, never :root, and rows/cards/headings are what page breaks respect).

import type { TrackerState } from '@/lib/tracker-helpers';
import { buildMerchantStatements } from '../loan-ledger';
import { consignmentAgeDays, consignmentSaleNetDue, listConsignments } from '../consignment';
import { transferCounterpartyKey } from '@/lib/usdt-transfers';
import { escapeHtml } from './loanStatementExport';
import { renderHtmlReportToPdf } from '@/lib/htmlReportToPdf';

export type StatementLang = 'en' | 'ar';

export interface MerchantStatementData {
  merchant: string;
  lang: StatementLang;
  issuedAt: number;
  businessName: string;
  loanLines: { ts: number; kind: string; amount: number; source: string; balanceAfter: number }[];
  /** > 0 I owe them, < 0 they owe me; 0 when settled or when there are no loans. */
  loanNet: number;
  consignments: {
    id: string;
    ts: number;
    sent: number;
    sold: number;
    returned: number;
    short: number;
    open: number;
    myShareSharePct: number;
    ageDays: number;
    status: 'open' | 'closed';
    sales: { ts: number; qty: number; price: number; buyout: boolean; profitQAR: number; dueQAR: number }[];
  }[];
  /** Cash the merchant still owes me from consignment sales. */
  cashDueQAR: number;
}

const LABELS: Record<StatementLang, Record<string, string>> = {
  en: {
    title: 'Statement', issued: 'Issued', loans: 'USDT loans', consignments: 'USDT consignments', date: 'Date', movement: 'Movement', amount: 'USDT',
    source: 'Source', balance: 'Balance after', settled: 'Settled', youOwe: 'You owe', owesYou: 'Owes you', none: 'Nothing to show',
    sent: 'Sent', sold: 'Sold', returned: 'Returned', unaccounted: 'Unaccounted', stillOut: 'Still out', share: 'My share of profit', open: 'Open', closed: 'Closed',
    days: 'days', qty: 'USDT', price: 'Price (QAR)', profit: 'Profit (QAR)', due: 'Cash due (QAR)', buyout: 'bought outright', cashDue: 'Cash still owed to me',
    lent: 'Lent', returnedToYou: 'Returned to you', borrowed: 'Borrowed', repaid: 'Repaid', manual: 'Manual', exchange: 'Exchange record', batch: 'Stock batch', order: 'Order',
  },
  ar: {
    title: 'كشف حساب', issued: 'تاريخ الإصدار', loans: 'قروض USDT', consignments: 'إرساليات USDT', date: 'التاريخ', movement: 'الحركة', amount: 'USDT',
    source: 'المصدر', balance: 'الرصيد بعد الحركة', settled: 'مسوّى', youOwe: 'عليك', owesYou: 'لك', none: 'لا يوجد ما يُعرض',
    sent: 'المرسل', sold: 'المباع', returned: 'المرتجع', unaccounted: 'غير محسوب', stillOut: 'لا يزال لدى التاجر', share: 'حصتي من الربح', open: 'مفتوحة', closed: 'مغلقة',
    days: 'يوم', qty: 'USDT', price: 'السعر (ر.ق)', profit: 'الربح (ر.ق)', due: 'النقد المستحق (ر.ق)', buyout: 'شراء نهائي', cashDue: 'النقد المستحق لي',
    lent: 'إقراض', returnedToYou: 'إرجاع إليك', borrowed: 'اقتراض', repaid: 'سداد', manual: 'يدوي', exchange: 'سجل منصة', batch: 'دفعة مخزون', order: 'طلب',
  },
};

const KIND_LABEL: Record<string, string> = { lend_out: 'lent', lend_return: 'returnedToYou', borrow_in: 'borrowed', borrow_repay: 'repaid' };
const SOURCE_LABEL: Record<string, string> = { exchange: 'exchange', exchange_order: 'exchange', batch: 'batch', trade: 'order' };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The data for one merchant, from my tracker. Matches the merchant by name, the same key the Loans page uses. */
export function buildMerchantStatementData(
  state: TrackerState,
  merchant: string,
  options: { lang?: StatementLang; now?: number; businessName?: string } = {},
): MerchantStatementData {
  const { lang = 'en', now = Date.now(), businessName = 'TAHEITO' } = options;
  const key = transferCounterpartyKey({ counterpartyName: merchant });
  // Consignment sends and returns are shown with their consignment, not twice as loans.
  const plainLoans = (state.usdtTransfers || []).filter(t => !t.consignment && !t.consignmentId);
  const loan = buildMerchantStatements(plainLoans).find(s => s.key === key);
  const loanLines = (loan?.lines || []).map(l => ({
    ts: l.ts,
    kind: KIND_LABEL[l.kind] || l.kind,
    amount: l.amount,
    source: l.transfer.source ? (SOURCE_LABEL[l.transfer.source.type] || 'manual') : 'manual',
    balanceAfter: l.balanceAfter,
  }));

  const wanted = merchant.trim().toLowerCase();
  const consignments = listConsignments(state)
    .filter(c => c.counterpartyName.trim().toLowerCase() === wanted)
    .map(c => ({
      id: c.id,
      ts: c.ts,
      sent: c.sent,
      sold: c.sold,
      returned: c.returned,
      short: c.short,
      open: c.open,
      myShareSharePct: c.profitSharePct,
      ageDays: consignmentAgeDays(c, now),
      status: c.status,
      sales: (state.trades || [])
        .filter(t => !t.voided && t.consignment && t.consignment.role !== 'receiver' && !t.consignment.shortfall && t.consignment.id === c.id)
        .sort((a, b) => a.ts - b.ts)
        .map(t => ({
          ts: t.ts,
          qty: t.amountUSDT,
          price: t.sellPriceQAR,
          buyout: !!t.consignment!.buyout,
          // What the sale earned me, after the merchant's share.
          profitQAR: round2(t.amountUSDT * t.sellPriceQAR - t.amountUSDT * (t.manualBuyPrice || 0) - t.feeQAR),
          dueQAR: consignmentSaleNetDue(t),
        })),
    }));
  const cashDueQAR = round2(consignments.reduce((s, c) => s + c.sales.reduce((x, y) => x + y.dueQAR, 0), 0));

  return { merchant, lang, issuedAt: now, businessName, loanLines, loanNet: loan?.net ?? 0, consignments, cashDueQAR };
}

const fmtN = (n: number, dp = 2) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: 0 }) : '—');
/** Western digits, `2026/11/20`, so a document reads the same in either language. */
const fmtD = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };

export function merchantStatementFileBase(data: MerchantStatementData): string {
  const safe = data.merchant.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'merchant';
  const d = new Date(data.issuedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `statement-${safe}-${stamp}`;
}

export function buildMerchantStatementHtml(data: MerchantStatementData): string {
  const L = LABELS[data.lang];
  const dir = data.lang === 'ar' ? 'rtl' : 'ltr';
  const balanceText = (n: number) => (Math.abs(n) <= 1e-6 ? L.settled : `${n > 0 ? L.youOwe : L.owesYou} ${fmtN(Math.abs(n))}`);

  const loanRows = data.loanLines.length === 0
    ? `<tr><td colspan="5" class="empty">${escapeHtml(L.none)}</td></tr>`
    : data.loanLines.map((l, i) => `
      <tr class="${i % 2 === 1 ? 'alt' : ''}">
        <td>${escapeHtml(fmtD(l.ts))}</td>
        <td>${escapeHtml(L[l.kind] || l.kind)}</td>
        <td class="num strong">${fmtN(l.amount)}</td>
        <td>${escapeHtml(L[l.source] || l.source)}</td>
        <td class="num">${escapeHtml(balanceText(l.balanceAfter))}</td>
      </tr>`).join('');

  const consignmentCards: string[] = data.consignments.length === 0
    ? [`<div class="card"><span class="empty">${escapeHtml(L.none)}</span></div>`]
    : data.consignments.map(c => {
      const saleRows = c.sales.map((s, i) => `
        <tr class="${i % 2 === 1 ? 'alt' : ''}">
          <td>${escapeHtml(fmtD(s.ts))}${s.buyout ? ` · ${escapeHtml(L.buyout)}` : ''}</td>
          <td class="num">${fmtN(s.qty)}</td>
          <td class="num">${fmtN(s.price, 4)}</td>
          <td class="num">${fmtN(s.profitQAR)}</td>
          <td class="num strong">${fmtN(s.dueQAR)}</td>
        </tr>`).join('');
      return `
      <div class="card">
        <div class="row"><strong>${escapeHtml(fmtD(c.ts))}</strong><span class="pill ${c.status === 'open' ? 'warn' : 'good'}">${escapeHtml(c.status === 'open' ? `${L.open} · ${c.ageDays} ${L.days}` : L.closed)}</span></div>
        <div class="grid">
          <div><small>${escapeHtml(L.sent)}</small><b>${fmtN(c.sent)}</b></div>
          <div><small>${escapeHtml(L.sold)}</small><b>${fmtN(c.sold)}</b></div>
          <div><small>${escapeHtml(L.returned)}</small><b>${fmtN(c.returned)}</b></div>
          <div><small>${escapeHtml(L.unaccounted)}</small><b>${fmtN(c.short)}</b></div>
          <div><small>${escapeHtml(L.stillOut)}</small><b>${fmtN(c.open)}</b></div>
          <div><small>${escapeHtml(L.share)}</small><b>${fmtN(c.myShareSharePct, 1)}%</b></div>
        </div>
        ${c.sales.length === 0 ? '' : `<table><thead><tr><th>${escapeHtml(L.date)}</th><th class="num">${escapeHtml(L.qty)}</th><th class="num">${escapeHtml(L.price)}</th><th class="num">${escapeHtml(L.profit)}</th><th class="num">${escapeHtml(L.due)}</th></tr></thead><tbody>${saleRows}</tbody></table>`}
      </div>`;
    });

  return `<!doctype html>
<html lang="${data.lang}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(L.title)} — ${escapeHtml(data.merchant)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f7f9fa; color: #243746; font-family: 'Tahoma', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif; font-size: 11px; line-height: 1.4; }
  /* Tokens are scoped to .sheet, not :root: inside the foreignObject used to rasterize the PDF, :root is the <svg> element and never reaches the sheet. */
  .sheet { --navy: #214562; --muted: #6b7f8f; --line: #d5e0e6; --soft: #eaf3f6; --good: #2f9e6b; --warn: #c27a12; width: 800px; margin: 0 auto; padding: 24px 28px; background: #fff; color: #243746; font-family: 'Tahoma', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif; font-size: 11px; line-height: 1.4; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid var(--navy); padding-bottom: 10px; margin-bottom: 14px; }
  .head h1 { margin: 0; font-size: 20px; color: var(--navy); }
  .head small { color: var(--muted); }
  h2 { margin: 18px 0 8px; font-size: 14px; color: var(--navy); }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: var(--navy); color: #fff; padding: 6px 8px; text-align: start; font-size: 10.5px; }
  th.num { text-align: end; }
  .card table { table-layout: fixed; }
  td { padding: 6px 8px; border-bottom: 1px solid var(--line); }
  tr.alt td { background: #f4f8fa; }
  .num { text-align: end; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; }
  .empty { color: var(--muted); text-align: center; padding: 10px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-top: 10px; background: #fff; }
  .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .grid small { display: block; color: var(--muted); font-size: 9.5px; }
  .pill { padding: 2px 8px; border-radius: 999px; font-size: 10px; background: var(--soft); }
  .pill.good { color: var(--good); } .pill.warn { color: var(--warn); }
  .total { margin-top: 14px; padding: 10px 12px; background: var(--soft); border-radius: 8px; display: flex; justify-content: space-between; font-weight: 700; color: var(--navy); }
</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div><h1>${escapeHtml(L.title)} — ${escapeHtml(data.merchant)}</h1><small>${escapeHtml(data.businessName)}</small></div>
    <small>${escapeHtml(L.issued)}: ${escapeHtml(fmtD(data.issuedAt))}</small>
  </div>

  <h2>${escapeHtml(L.loans)}</h2>
  <table>
    <thead><tr><th>${escapeHtml(L.date)}</th><th>${escapeHtml(L.movement)}</th><th class="num">${escapeHtml(L.amount)}</th><th>${escapeHtml(L.source)}</th><th class="num">${escapeHtml(L.balance)}</th></tr></thead>
    <tbody>${loanRows}</tbody>
  </table>
  <div class="total"><span>${escapeHtml(L.loans)}</span><span>${escapeHtml(balanceText(data.loanNet))}</span></div>
</div>
<!-- Consignments get their own sheet, so they start at the top of their own page and a long loan table never splits across sections. -->
<div class="sheet">
  <div class="head">
    <div><h1>${escapeHtml(L.title)} — ${escapeHtml(data.merchant)}</h1><small>${escapeHtml(data.businessName)}</small></div>
    <small>${escapeHtml(L.issued)}: ${escapeHtml(fmtD(data.issuedAt))}</small>
  </div>

  <h2>${escapeHtml(L.consignments)}</h2>
  ${consignmentCards.join('')}
  <div class="total"><span>${escapeHtml(L.cashDue)}</span><span>${fmtN(data.cashDueQAR)} QAR</span></div>
</div>
</body>
</html>`;
}

/** Saves the statement as a PDF file, downloaded directly. */
export async function exportMerchantStatementPdf(data: MerchantStatementData): Promise<void> {
  await renderHtmlReportToPdf(buildMerchantStatementHtml(data), `${merchantStatementFileBase(data)}.pdf`, { orientation: 'portrait', renderWidth: 800 });
}
