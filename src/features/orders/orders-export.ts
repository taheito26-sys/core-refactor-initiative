import type ExcelJS from 'exceljs';
import type { Trade, Customer, DerivedState } from '@/lib/tracker-helpers';
import { fmtDate, fmtPrice } from '@/lib/tracker-helpers';
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

/** Whole-number totals/amounts — the report's rule is "no decimals except on prices". */
function formatMoney(n: number): string {
  return Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US');
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
    cell.numFmt = '#,##0';
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
    r.getCell(3).numFmt = '#,##0';
    r.getCell(4).value = row.sellPrice;
    r.getCell(4).numFmt = '#,##0.###';
    r.getCell(5).value = row.totalQar;
    r.getCell(5).numFmt = '#,##0';
    r.getCell(6).value = row.cost ?? '';
    r.getCell(6).numFmt = '#,##0';
    r.getCell(7).value = row.net ?? '';
    r.getCell(7).numFmt = '#,##0';
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

// ── PDF report markup (vividly styled, rasterized directly to a downloadable PDF) ──

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CARD_META = [
  { key: 'orders', icon: '📊', from: '#4F46E5', to: '#7C3AED' },
  { key: 'qty', icon: '💱', from: '#2563EB', to: '#0EA5E9' },
  { key: 'qar', icon: '💰', from: '#0F766E', to: '#14B8A6' },
  { key: 'cost', icon: '🧾', from: '#B45309', to: '#F59E0B' },
  { key: 'net', icon: '📈', from: '#15803D', to: '#22C55E' },
] as const;

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
  const netIsGood = summary.totalNet >= 0;
  const netTone = netIsGood ? 'good' : 'bad';
  const [ordersMeta, qtyMeta, qarMeta, costMeta, netMeta] = CARD_META;

  const bodyRows = rows.length === 0
    ? `<tr><td colspan="7" class="empty">${escapeHtml(labels.totalOrders)} — 0</td></tr>`
    : rows.map((row, i) => `
      <tr class="${i % 2 === 1 ? 'alt' : ''}">
        <td>${escapeHtml(row.date)}</td>
        <td class="desc">${escapeHtml(row.buyer)}</td>
        <td class="num">${formatMoney(row.qtyUsdt)}</td>
        <td class="num">${fmtPrice(row.sellPrice)}</td>
        <td class="num strong">${formatMoney(row.totalQar)}</td>
        <td class="num">${row.cost != null ? formatMoney(row.cost) : '—'}</td>
        <td class="num"><span class="pill ${row.net != null && row.net >= 0 ? 'good' : row.net != null ? 'bad' : ''}">${row.net != null ? formatMoney(row.net) : '—'}</span></td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(labels.documentTitle)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  html, body, * { box-sizing: border-box; }
  body {
    margin: 0; background: #EEF1F8; color: #14161c;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px; line-height: 1.45;
  }
  .sheet { direction: ${dir}; max-width: 1080px; margin: 0 auto; background: #fff; padding: 0 0 26px; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(15,42,68,.18); }
  .banner {
    position: relative; overflow: hidden;
    background: linear-gradient(120deg, #0B1E36 0%, #123A63 45%, #1E5F91 100%);
    color: #fff; padding: 26px 32px 20px;
  }
  .banner::before {
    content: ''; position: absolute; inset: 0;
    background:
      radial-gradient(circle at 15% 20%, rgba(124,58,237,.45), transparent 40%),
      radial-gradient(circle at 85% 15%, rgba(34,197,94,.35), transparent 45%),
      radial-gradient(circle at 60% 100%, rgba(14,165,233,.35), transparent 45%);
  }
  .banner-inner { position: relative; }
  .banner .title { font-size: 23px; font-weight: 800; letter-spacing: .2px; }
  .banner .sub { margin-top: 6px; font-size: 11px; color: #D6E4F5; }
  .banner .sub b { color: #FBD98E; font-weight: 700; }
  .body { padding: 24px 32px 0; }
  .cards { display: flex; gap: 12px; margin-bottom: 22px; flex-wrap: wrap; }
  .card {
    flex: 1; min-width: 150px; border-radius: 12px; padding: 14px 15px 13px; color: #fff;
    box-shadow: 0 6px 14px rgba(15,23,42,.16);
  }
  .card .icon { font-size: 16px; line-height: 1; opacity: .95; }
  .card .k { margin-top: 6px; font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: rgba(255,255,255,.85); font-weight: 700; }
  .card .v { margin-top: 4px; font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  h2 { font-size: 12.5px; font-weight: 800; color: #0F2A44; margin: 4px 0 9px; padding-inline-start: 9px;
       border-inline-start: 4px solid #2563EB; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; border-radius: 8px; overflow: hidden; }
  th {
    font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: #fff;
    text-align: ${dir === 'rtl' ? 'right' : 'left'}; padding: 9px 8px;
    background: linear-gradient(120deg, #0F2A44, #1E5F91); font-weight: 700;
  }
  td { padding: 7px 8px; border-bottom: 1px solid #eef0f4; vertical-align: top; }
  tr.alt td { background: #F4F7FD; }
  th.num, td.num { text-align: ${dir === 'rtl' ? 'left' : 'right'}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.desc { color: #33405a; font-weight: 600; }
  td.strong { font-weight: 800; color: #0F2A44; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-weight: 800; font-size: 10.5px; }
  .pill.good { color: #0F5132; background: #D9F5E3; }
  .pill.bad { color: #7A1F1F; background: #FBDEDE; }
  td.empty { text-align: center; color: #8b91a0; padding: 16px; }
  tfoot td { border-top: 2px solid #0F2A44; font-weight: 800; background: #EAF0FB !important; color: #0F2A44; }
  footer { margin-top: 22px; padding: 12px 32px 0; border-top: 1px solid #e5e9f2; font-size: 9px; color: #6b7280;
           display: flex; justify-content: space-between; gap: 16px; }
  @media print {
    body { background: #fff; }
    .sheet { max-width: none; box-shadow: none; border-radius: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>
<div class="sheet" dir="${dir}">
  <div class="banner">
    <div class="banner-inner">
      <div class="title">✨ ${escapeHtml(labels.documentTitle)}</div>
      <div class="sub">
        ${businessName ? `<b>${escapeHtml(businessName)}</b> · ` : ''}${escapeHtml(labels.period)}: <b>${escapeHtml(periodLabel)}</b> ·
        ${escapeHtml(labels.reportDate)}: ${escapeHtml(fmtDate(Date.now()))}
      </div>
    </div>
  </div>

  <div class="body">
    <div class="cards">
      <div class="card" style="background:linear-gradient(135deg,${ordersMeta.from},${ordersMeta.to})">
        <div class="icon">${ordersMeta.icon}</div>
        <div class="k">${escapeHtml(labels.totalOrders)}</div>
        <div class="v">${summary.count}</div>
      </div>
      <div class="card" style="background:linear-gradient(135deg,${qtyMeta.from},${qtyMeta.to})">
        <div class="icon">${qtyMeta.icon}</div>
        <div class="k">${escapeHtml(labels.totalSoldUsdt)}</div>
        <div class="v">${formatMoney(summary.qtyUsdt)} ${usdt}</div>
      </div>
      <div class="card" style="background:linear-gradient(135deg,${qarMeta.from},${qarMeta.to})">
        <div class="icon">${qarMeta.icon}</div>
        <div class="k">${escapeHtml(labels.totalQar)}</div>
        <div class="v">${formatMoney(summary.totalQar)} ${cur}</div>
      </div>
      <div class="card" style="background:linear-gradient(135deg,${costMeta.from},${costMeta.to})">
        <div class="icon">${costMeta.icon}</div>
        <div class="k">${escapeHtml(labels.totalCost)}</div>
        <div class="v">${formatMoney(summary.totalCost)} ${cur}</div>
      </div>
      <div class="card" style="background:linear-gradient(135deg,${netIsGood ? netMeta.from : '#991B1B'},${netIsGood ? netMeta.to : '#DC2626'})">
        <div class="icon">${netMeta.icon}</div>
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
          <td class="num"><span class="pill ${netTone}">${formatMoney(summary.totalNet)}</span></td>
        </tr>
      </tfoot>` : ''}
    </table>
  </div>

  <footer>
    <span>${escapeHtml(labels.footer)}</span>
    <span>${escapeHtml(labels.generatedOn)} ${escapeHtml(fmtDate(Date.now()))}</span>
  </footer>
</div>
</body>
</html>`;
}

/** Pulls the `<style>` rules and the `.sheet` card back out of a full report document. */
function extractReportFragment(html: string): { styles: string; sheetHtml: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const styleEl = doc.querySelector('style');
  const sheetEl = doc.querySelector('.sheet');
  return {
    styles: styleEl?.textContent || '',
    sheetHtml: sheetEl?.outerHTML || '',
  };
}

/**
 * Rasterizes an HTML fragment to an `<img>` by wrapping it in an SVG
 * `<foreignObject>` and letting the browser decode that SVG as an image.
 *
 * This is deliberately NOT html2canvas: html2canvas re-implements text
 * layout itself (drawing glyph-by-glyph onto a canvas 2D context), and it
 * breaks Arabic letter joining/ordering — every Arabic label came out
 * garbled. A `<foreignObject>` is laid out and painted by the browser's own
 * text-shaping engine when the SVG is decoded as an image, so RTL/Arabic
 * comes out exactly as it renders on screen.
 */
async function svgImageFromHtml(html: string, width: number, height: number): Promise<HTMLImageElement> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${html}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

/**
 * Renders the report to an actual PDF file and downloads it directly — no
 * print dialog. Measures the report off-screen at full size, rasterizes it
 * via {@link svgImageFromHtml} (correct Arabic — see that function's doc),
 * then slices the resulting image across as many landscape A4 pages as it
 * needs and saves.
 */
export async function exportOrdersReportPdf(reportHtml: string, filename: string): Promise<void> {
  if (typeof document === 'undefined') return;
  const { styles, sheetHtml } = extractReportFragment(reportHtml);
  const renderWidth = 1080;

  // Measure real layout height first — the SVG needs explicit width/height
  // up front, and foreignObject content doesn't reflow after the fact.
  const measurer = document.createElement('div');
  measurer.style.cssText = `position:absolute;left:-9999px;top:0;width:${renderWidth}px;background:#fff;`;
  measurer.innerHTML = `<style>${styles}</style>${sheetHtml}`;
  document.body.appendChild(measurer);
  const renderHeight = measurer.scrollHeight;
  measurer.remove();

  const scale = 2;
  const img = await svgImageFromHtml(`<style>${styles}</style>${sheetHtml}`, renderWidth, renderHeight);
  const canvas = document.createElement('canvas');
  canvas.width = renderWidth * scale;
  canvas.height = renderHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, renderWidth, renderHeight);
  ctx.drawImage(img, 0, 0, renderWidth, renderHeight);

  const imgData = canvas.toDataURL('image/png');

  // Dynamically imported so jsPDF only loads into a device's bundle when a
  // PDF export is actually triggered.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;
  doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;
  while (heightLeft > 0) {
    position -= pageHeight;
    doc.addPage();
    doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  doc.save(filename);
}
