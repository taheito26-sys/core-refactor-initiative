import type ExcelJS from 'exceljs';
import type { Trade, Customer, DerivedState } from '@/lib/tracker-helpers';
import { fmtDate } from '@/lib/tracker-helpers';
import { localCur } from '@/lib/currency-locale';

export interface OrdersReportLabels {
  documentTitle: string;
  issuedBy: string;
  reportDate: string;
  period: string;
  allPeriod: string;
  totalOrders: string;
  totalSoldUsdt: string;
  totalQar: string;
  totalCost: string;
  totalNetProfit: string;
  orderDetail: string;
  colDate: string;
  colBuyer: string;
  colQty: string;
  colSell: string;
  colTotalQar: string;
  colCost: string;
  colNet: string;
  footer: string;
  generatedOn: string;
}

interface OrderExportRow {
  date: string;
  buyer: string;
  qtyUsdt: number;
  sellPrice: number;
  totalQar: number;
  cost: number | null;
  net: number | null;
}

interface OrdersReportSummary {
  count: number;
  qtyUsdt: number;
  totalQar: number;
  totalCost: number;
  totalNet: number;
}

function buildRows(trades: Trade[], customers: Customer[], derived: DerivedState): OrderExportRow[] {
  const customerById = new Map(customers.map(c => [c.id, c.name]));
  return trades.map(tr => {
    const c = derived.tradeCalc.get(tr.id);
    const totalQar = tr.amountUSDT * tr.sellPriceQAR;
    const cost = c?.slices.reduce((s, x) => s + x.cost, 0) ?? null;
    let net = c?.ok && cost != null ? totalQar - cost - tr.feeQAR : null;
    const linked = !!(tr.agreementFamily || tr.linkedDealId || tr.linkedRelId);
    if (linked && tr.merchantPct && net != null) net = net * (tr.merchantPct / 100);
    return {
      date: fmtDate(tr.ts),
      buyer: customerById.get(tr.customerId) || '—',
      qtyUsdt: tr.amountUSDT,
      sellPrice: tr.sellPriceQAR,
      totalQar,
      cost,
      net,
    };
  });
}

function summarize(rows: OrderExportRow[]): OrdersReportSummary {
  return rows.reduce((acc, row) => ({
    count: acc.count + 1,
    qtyUsdt: acc.qtyUsdt + row.qtyUsdt,
    totalQar: acc.totalQar + row.totalQar,
    totalCost: acc.totalCost + (row.cost ?? 0),
    totalNet: acc.totalNet + (row.net ?? 0),
  }), { count: 0, qtyUsdt: 0, totalQar: 0, totalCost: 0, totalNet: 0 });
}

function triggerDownload(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function formatMoney(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── XLSX ──────────────────────────────────────────────────────────

export async function exportOrdersToXlsx(
  trades: Trade[],
  customers: Customer[],
  derived: DerivedState,
  baseFiat: string,
  lang: 'en' | 'ar',
  labels: OrdersReportLabels,
  periodLabel: string,
): Promise<void> {
  const lc = (c: string) => localCur(c, lang);
  const rows = buildRows(trades, customers, derived);
  const summary = summarize(rows);

  // Dynamically imported so exceljs (large) only loads into a device's
  // bundle when an export is actually triggered, instead of bloating the
  // main precached PWA bundle for every user.
  const { default: ExcelJSLib } = await import('exceljs');
  const workbook = new ExcelJSLib.Workbook();
  const sheet = workbook.addWorksheet(labels.documentTitle.slice(0, 31) || 'Orders');
  sheet.views = [{ rightToLeft: lang === 'ar' }];

  const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A44' } };
  const summaryFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F4' } };
  const netFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5EC' } };

  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = labels.documentTitle;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF0F2A44' } };

  sheet.mergeCells('A2:G2');
  const periodCell = sheet.getCell('A2');
  periodCell.value = `${labels.period}: ${periodLabel}`;
  periodCell.font = { italic: true, color: { argb: 'FF6B7280' } };

  // ── Summary block ──
  const summaryStartRow = 4;
  const summaryHeaders = [labels.totalOrders, labels.totalSoldUsdt, `${labels.totalQar} (${lc(baseFiat)})`, `${labels.totalCost} (${lc(baseFiat)})`, `${labels.totalNetProfit} (${lc(baseFiat)})`];
  const summaryValues = [summary.count, summary.qtyUsdt, summary.totalQar, summary.totalCost, summary.totalNet];
  const headerRow = sheet.getRow(summaryStartRow);
  summaryHeaders.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = headerFill;
    cell.alignment = { horizontal: 'center' };
  });
  headerRow.commit();

  const valueRow = sheet.getRow(summaryStartRow + 1);
  summaryValues.forEach((v, i) => {
    const cell = valueRow.getCell(i + 1);
    cell.value = v;
    cell.font = { bold: true, size: 13 };
    cell.fill = i === summaryValues.length - 1 ? netFill : summaryFill;
    cell.alignment = { horizontal: 'center' };
    cell.numFmt = i === 0 ? '0' : '#,##0.00';
  });
  valueRow.commit();

  for (let col = 1; col <= 5; col++) sheet.getColumn(col).width = 18;

  // ── Order detail table ──
  const tableStartRow = summaryStartRow + 3;
  sheet.mergeCells(`A${tableStartRow}:G${tableStartRow}`);
  const detailTitleCell = sheet.getCell(`A${tableStartRow}`);
  detailTitleCell.value = labels.orderDetail;
  detailTitleCell.font = { bold: true, size: 12, color: { argb: 'FF0F2A44' } };

  const columnHeaders = [
    labels.colDate, labels.colBuyer, `${labels.colQty} ${lc('USDT')}`, `${labels.colSell} ${lc(baseFiat)}`,
    `${labels.colTotalQar} ${lc(baseFiat)}`, `${labels.colCost} ${lc(baseFiat)}`, `${labels.colNet} ${lc(baseFiat)}`,
  ];
  const colHeaderRow = sheet.getRow(tableStartRow + 1);
  columnHeaders.forEach((h, i) => {
    const cell = colHeaderRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = headerFill;
  });
  colHeaderRow.commit();

  sheet.columns = [
    { key: 'date', width: 20 },
    { key: 'buyer', width: 24 },
    { key: 'qtyUsdt', width: 14 },
    { key: 'sellPrice', width: 14 },
    { key: 'totalQar', width: 16 },
    { key: 'cost', width: 16 },
    { key: 'net', width: 16 },
  ];

  rows.forEach((row, i) => {
    const r = sheet.getRow(tableStartRow + 2 + i);
    r.getCell(1).value = row.date;
    r.getCell(2).value = row.buyer;
    r.getCell(3).value = row.qtyUsdt;
    r.getCell(4).value = row.sellPrice;
    r.getCell(5).value = row.totalQar;
    r.getCell(6).value = row.cost ?? '';
    r.getCell(7).value = row.net ?? '';
    if (i % 2 === 1) {
      for (let col = 1; col <= 7; col++) {
        r.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } };
      }
    }
    r.commit();
  });

  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `orders-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

// ── PDF (print-to-PDF, matching the buyer-statement house style) ──

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildOrdersReportHtml(
  trades: Trade[],
  customers: Customer[],
  derived: DerivedState,
  baseFiat: string,
  lang: 'en' | 'ar',
  labels: OrdersReportLabels,
  periodLabel: string,
  businessName = '',
): string {
  const lc = (c: string) => localCur(c, lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const cur = escapeHtml(lc(baseFiat));
  const usdt = escapeHtml(lc('USDT'));
  const rows = buildRows(trades, customers, derived);
  const summary = summarize(rows);
  const netTone = summary.totalNet >= 0 ? 'good' : 'bad';

  const bodyRows = rows.length === 0
    ? `<tr><td colspan="7" class="empty">${escapeHtml(labels.totalOrders)} — 0</td></tr>`
    : rows.map(row => `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td class="desc">${escapeHtml(row.buyer)}</td>
        <td class="num">${formatMoney(row.qtyUsdt)}</td>
        <td class="num">${formatMoney(row.sellPrice)}</td>
        <td class="num strong">${formatMoney(row.totalQar)}</td>
        <td class="num">${row.cost != null ? formatMoney(row.cost) : '—'}</td>
        <td class="num ${row.net != null && row.net >= 0 ? 'good' : row.net != null ? 'bad' : ''}">${row.net != null ? formatMoney(row.net) : '—'}</td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(labels.documentTitle)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  html, body, * { box-sizing: border-box; }
  body {
    margin: 0; background: #f4f5f7; color: #14161c;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px; line-height: 1.45;
  }
  .sheet { max-width: 1050px; margin: 0 auto; background: #fff; padding: 0 0 30px; }
  .banner { background: #0F2A44; color: #fff; padding: 22px 30px 16px; }
  .banner .title { font-size: 20px; font-weight: 700; }
  .banner .sub { margin-top: 4px; font-size: 10.5px; color: #E8D9A0; }
  .body { padding: 22px 30px 0; }
  .cards { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
  .card { flex: 1; min-width: 140px; background: #F7F8FA; border-radius: 8px; padding: 12px 14px; border: 1px solid #E5E8ED; }
  .card .k { font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: #6B7280; font-weight: 700; }
  .card .v { margin-top: 5px; font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; color: #0F2A44; }
  .card.qty .v { color: #2563EB; }
  .card.qar .v { color: #0F2A44; }
  .card.cost .v { color: #B45309; }
  .card.net.good .v { color: #157347; }
  .card.net.bad .v { color: #A6332A; }
  h2 { font-size: 12px; font-weight: 700; color: #0F2A44; margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: #fff;
       text-align: ${dir === 'rtl' ? 'right' : 'left'}; padding: 7px; background: #0F2A44; font-weight: 700; }
  td { padding: 6px 7px; border-bottom: 1px solid #eceef2; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #F7F8FA; }
  th.num, td.num { text-align: ${dir === 'rtl' ? 'left' : 'right'}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.desc { color: #454b57; }
  td.strong { font-weight: 700; }
  td.good { color: #157347; font-weight: 700; }
  td.bad { color: #A6332A; font-weight: 700; }
  td.empty { text-align: center; color: #8b91a0; padding: 14px; }
  tfoot td { border-top: 1.5px solid #0F2A44; font-weight: 700; background: #EFF1F4 !important; }
  footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #dfe3ea; font-size: 9px; color: #6b7280;
           display: flex; justify-content: space-between; gap: 16px; }
  @media print {
    body { background: #fff; }
    .sheet { max-width: none; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>
<div class="sheet">
  <div class="banner">
    <div class="title">${escapeHtml(labels.documentTitle)}</div>
    <div class="sub">
      ${businessName ? `${escapeHtml(businessName)} &nbsp;·&nbsp; ` : ''}${escapeHtml(labels.period)}: ${escapeHtml(periodLabel)} &nbsp;·&nbsp;
      ${escapeHtml(labels.reportDate)}: ${escapeHtml(fmtDate(Date.now()))}
    </div>
  </div>

  <div class="body">
    <div class="cards">
      <div class="card">
        <div class="k">${escapeHtml(labels.totalOrders)}</div>
        <div class="v">${summary.count}</div>
      </div>
      <div class="card qty">
        <div class="k">${escapeHtml(labels.totalSoldUsdt)}</div>
        <div class="v">${formatMoney(summary.qtyUsdt)} ${usdt}</div>
      </div>
      <div class="card qar">
        <div class="k">${escapeHtml(labels.totalQar)}</div>
        <div class="v">${formatMoney(summary.totalQar)} ${cur}</div>
      </div>
      <div class="card cost">
        <div class="k">${escapeHtml(labels.totalCost)}</div>
        <div class="v">${formatMoney(summary.totalCost)} ${cur}</div>
      </div>
      <div class="card net ${netTone}">
        <div class="k">${escapeHtml(labels.totalNetProfit)}</div>
        <div class="v">${formatMoney(summary.totalNet)} ${cur}</div>
      </div>
    </div>

    <h2>${escapeHtml(labels.orderDetail)}</h2>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(labels.colDate)}</th>
          <th>${escapeHtml(labels.colBuyer)}</th>
          <th class="num">${escapeHtml(labels.colQty)} (${usdt})</th>
          <th class="num">${escapeHtml(labels.colSell)} (${cur})</th>
          <th class="num">${escapeHtml(labels.colTotalQar)} (${cur})</th>
          <th class="num">${escapeHtml(labels.colCost)} (${cur})</th>
          <th class="num">${escapeHtml(labels.colNet)} (${cur})</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
      ${rows.length > 0 ? `<tfoot>
        <tr>
          <td colspan="2">${escapeHtml(labels.totalOrders)}: ${summary.count}</td>
          <td class="num">${formatMoney(summary.qtyUsdt)}</td>
          <td></td>
          <td class="num">${formatMoney(summary.totalQar)}</td>
          <td class="num">${formatMoney(summary.totalCost)}</td>
          <td class="num ${netTone}">${formatMoney(summary.totalNet)}</td>
        </tr>
      </tfoot>` : ''}
    </table>

    <footer>
      <span>${escapeHtml(labels.footer)}</span>
      <span>${escapeHtml(labels.generatedOn)} ${escapeHtml(fmtDate(Date.now()))}</span>
    </footer>
  </div>
</div>
</body>
</html>`;
}

/**
 * Opens the print dialog on the report so the user can "Save as PDF". A hidden
 * iframe is used (matching the buyer-statement export) because pop-up
 * blockers kill `window.open` on some browsers. Returns false when printing
 * isn't available (in-app webviews), so the caller can fall back to XLSX.
 */
export function printOrdersReport(html: string): boolean {
  if (typeof document === 'undefined') return false;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);

  const cleanup = () => { setTimeout(() => frame.remove(), 1000); };
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win || typeof win.print !== 'function') { frame.remove(); return false; }
    doc.open();
    doc.write(html);
    doc.close();
    win.setTimeout(() => {
      try { win.focus(); win.print(); } catch { /* dialog unavailable */ }
      cleanup();
    }, 120);
    return true;
  } catch {
    frame.remove();
    return false;
  }
}
