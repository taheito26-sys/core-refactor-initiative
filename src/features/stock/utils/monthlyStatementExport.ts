import { escapeHtml } from './loanStatementExport';
import { renderHtmlReportToPdf, triggerBlobDownload } from '@/lib/htmlReportToPdf';

/**
 * The monthly Taheito buyer statement — a pixel match of the branded
 * two-part document merchants have been hand-exporting and sending to
 * buyers: a "QAR ACCOUNT"-style statement page (cumulative totals, full
 * payment history) followed by that month's EGP sell ledger (the merchant's
 * FX-sourcing trail across ALL their buyers, not just this one). Buyers get
 * this self-service from the customer portal instead of waiting on the
 * merchant to generate and send it by hand.
 *
 * This intentionally does not reuse {@link buildStatementHtml} or
 * {@link PublicStatementReport} — neither matches this specific letterhead,
 * hero card, or the narrower EGP-ledger column set (no USDT quantity, no QAR
 * equivalent, no counterparty — a buyer only ever sees the EGP amount and
 * the EGP/USDT price).
 */

export interface MonthlyStatementPayment {
  date: number;
  amount: number;
  note: string | null;
  ref: string | null;
}

export interface MonthlyStatementBinanceRow {
  orderNumber: string;
  date: string | number | null;
  counterparty: string | null;
  fiat: string;
  fiatAmount: number;
  fiatPrice: number;
}

export interface MonthlyStatementData {
  customerName: string;
  currency: string;
  totalLoaned: number;
  totalRepaid: number;
  outstanding: number;
  issueDate: string;
  /** 'YYYY-MM' — the month this statement covers. */
  month: string;
  payments: MonthlyStatementPayment[];
  binanceOrders: MonthlyStatementBinanceRow[];
}

export interface MonthlyStatementOptions {
  businessName?: string;
  businessTagline?: string;
}

const CURRENCY_SUFFIX: Record<string, string> = {
  QAR: 'ر.ق',
  EGP: 'ج.م',
  AED: 'د.إ',
  SAR: 'ر.س',
};

function currencySuffix(code: string): string {
  return CURRENCY_SUFFIX[code] || code;
}

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** 'YYYY-MM' → 'أغسطس 2026'. */
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(n => parseInt(n, 10));
  return `${ARABIC_MONTHS[(m - 1 + 12) % 12]} ${y}`;
}

function fmtAmount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** `2026/8/30` — Western digits, no zero-padding, matching the exported document exactly. */
function fmtDate(value: number | string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function monthlyStatementFileBase(data: MonthlyStatementData): string {
  const name = data.customerName
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'buyer';
  return `${name}-statement-${data.month}`;
}

// ── Printable / rasterized document ─────────────────────────────────

export function buildMonthlyStatementHtml(data: MonthlyStatementData, options: MonthlyStatementOptions = {}): string {
  const { businessName = 'TAHEITO', businessTagline = 'P2P TRADING & CAPITAL MANAGEMENT' } = options;
  const cur = currencySuffix(data.currency);
  const repaidPct = data.totalLoaned > 0 ? Math.min(100, Math.round((data.totalRepaid / data.totalLoaned) * 100)) : 0;
  const label = monthLabel(data.month);
  const paymentsTotal = data.payments.reduce((sum, p) => sum + p.amount, 0);
  const binanceTotal = data.binanceOrders.reduce((sum, o) => sum + o.fiatAmount, 0);
  const binanceFiat = data.binanceOrders[0]?.fiat || 'EGP';

  // No "المرجع" column — a buyer only needs to know when and how much,
  // never the internal order reference a payment was filed against.
  const paymentRows = data.payments.length === 0
    ? `<tr><td colspan="4" class="empty">لا توجد دفعات مسجلة هذا الشهر</td></tr>`
    : data.payments.map((p, i) => `
      <tr class="${i % 2 === 1 ? 'alt' : ''}">
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(fmtDate(p.date))}</td>
        <td class="num"><span class="pill good">${fmtAmount(p.amount)}</span></td>
        <td class="desc">${p.note ? escapeHtml(p.note) : '—'}</td>
      </tr>`).join('');

  // No "الطرف الآخر" (counterparty) column — the buyer sees only what
  // funded the settlement (amount, price, order), never who else the
  // merchant traded with.
  const binanceRows = data.binanceOrders.length === 0
    ? `<tr><td colspan="4" class="empty">لا توجد معاملات بيع هذا الشهر</td></tr>`
    : data.binanceOrders.map((o, i) => `
      <tr class="${i % 2 === 1 ? 'alt' : ''}">
        <td class="num">${i + 1}</td>
        <td class="num strong">${fmtAmount(o.fiatAmount)}</td>
        <td class="num">${o.fiatPrice.toFixed(2)}</td>
        <td>${escapeHtml(fmtDate(o.date ?? ''))}</td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>بيان حساب ${escapeHtml(data.customerName)} — ${escapeHtml(label)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #F3F1EE; color: #24211D;
    font-family: 'Tahoma', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
    font-size: 11px; line-height: 1.5;
  }
  /* Palette lifted from the reference swatch: deep navy, warm brown, taupe,
     pale ice-blue, and a coral red — used consistently instead of the
     generic blue/green/amber report colors elsewhere in the app. Scoped to
     .sheet (not :root) since this stylesheet also runs inside an SVG
     foreignObject during PDF rasterization, where :root resolves to the
     <svg> element rather than the rendered subtree. */
  .sheet {
    --navy: #1C3D5A;
    --brown: #7A5240;
    --taupe: #A89684;
    --ice: #E9F2F5;
    --red: #E1503C;
    direction: rtl; max-width: 800px; margin: 0 auto 24px; background: #fff; padding: 0 0 22px;
    border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(28,61,90,.14);
  }
  .sheet + .sheet { page-break-before: always; }
  .banner {
    background: var(--navy);
    color: #fff; padding: 22px 28px 18px;
    border-bottom: 3px solid var(--red);
  }
  .banner-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
  .brand-en { text-align: left; direction: ltr; }
  .brand-en .name { font-size: 17px; font-weight: 800; letter-spacing: .3px; }
  .brand-en .tagline { font-size: 9px; color: #C9D6DF; font-weight: 700; letter-spacing: .3px; margin-top: 2px; }
  .banner .month { font-size: 13px; font-weight: 800; color: #F0A898; }
  .hero { margin-top: 16px; }
  .hero .account-label { font-size: 9px; font-weight: 800; color: #C9D6DF; letter-spacing: .6px; direction: ltr; text-align: left; }
  .hero .name { font-size: 21px; font-weight: 800; margin-top: 6px; color: #fff; }
  .hero .note { font-size: 10.5px; color: #C9D6DF; margin-top: 6px; max-width: 500px; }
  .body { padding: 22px 28px 0; }
  .cards { display: flex; gap: 10px; margin-bottom: 20px; }
  .card { flex: 1; border-radius: 10px; padding: 13px 14px; text-align: center;
          border: 1px solid #E3DDD5; border-inline-start: 4px solid var(--accent); background: var(--tint); }
  .card .k { font-size: 9px; font-weight: 700; letter-spacing: .3px; color: #8A7F73; }
  .card .v { font-size: 19px; font-weight: 800; margin-top: 6px; font-variant-numeric: tabular-nums; color: var(--accent); }
  .card .u { font-size: 9.5px; font-weight: 600; color: #8A7F73; margin-top: 2px; }
  .settlement { display: flex; align-items: center; gap: 18px; margin-bottom: 22px; padding: 14px 16px;
                border-radius: 10px; background: var(--ice); border: 1px solid #CFE0E6; }
  .settlement .pct { font-size: 28px; font-weight: 800; color: var(--navy); min-width: 64px; }
  .settlement .body2 { flex: 1; }
  .settlement .title { font-size: 10px; font-weight: 800; color: var(--navy); letter-spacing: .3px; margin-bottom: 6px; }
  .settlement .bar { height: 8px; border-radius: 4px; background: #D3E3E9; overflow: hidden; }
  .settlement .bar > span { display: block; height: 100%; background: var(--navy); border-radius: 4px; }
  .settlement .desc { font-size: 10.5px; color: #4A6273; margin-top: 6px; }
  h2 { font-size: 12.5px; font-weight: 800; color: var(--navy); margin: 4px 0 9px; padding-inline-start: 9px;
       border-inline-start: 4px solid var(--red); }
  h2 .count { font-weight: 600; color: #8A7F73; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; border-radius: 8px; overflow: hidden; }
  th { font-size: 8.5px; letter-spacing: .5px; text-transform: uppercase; color: #fff;
       text-align: right; padding: 8px; background: var(--navy); font-weight: 700; }
  td { padding: 7px 8px; border-bottom: 1px solid #EFECE8; vertical-align: top; }
  tr.alt td { background: #F7F4F1; }
  th.num, td.num { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.desc { color: #5C554D; }
  td.strong { font-weight: 800; color: var(--navy); }
  td.empty { text-align: center; color: #A89684; padding: 16px; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-weight: 800; font-size: 10.5px; }
  .pill.good { color: #4A3327; background: #EFE7E0; }
  tfoot td { border-top: 2px solid var(--navy); border-bottom: none; font-weight: 800; background: #EEF4F6 !important; color: var(--navy); }
  .legal { font-size: 9.5px; color: #A89684; margin-top: 16px; text-align: center; }
  .page-footer { display: flex; justify-content: space-between; margin-top: 14px; padding: 10px 28px 0;
                 border-top: 1px solid #E3DDD5; font-size: 9px; color: #8A7F73; }
  @media print {
    body { background: #fff; }
    .sheet { max-width: none; margin: 0; box-shadow: none; border-radius: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>

<div class="sheet">
  <div class="banner">
    <div class="banner-row">
      <div class="brand-en">
        <div class="name">${escapeHtml(businessName)}</div>
        <div class="tagline">${escapeHtml(businessTagline)}</div>
      </div>
      <div class="month">${escapeHtml(label)}</div>
    </div>
    <div class="hero">
      <div class="account-label">${escapeHtml(data.currency)} ACCOUNT</div>
      <div class="name">${escapeHtml(data.customerName)}</div>
      <div class="note">بيان شهر ${escapeHtml(label)} فقط — جميع الطلبات والدفعات حتى تاريخ الإصدار ${escapeHtml(fmtDate(data.issueDate))}</div>
    </div>
  </div>

  <div class="body">
    <div class="cards">
      <div class="card" style="--accent:#1C3D5A;--tint:#E9F2F5;">
        <div class="k">إجمالي المستحقات</div>
        <div class="v">${fmtAmount(data.totalLoaned)}</div>
        <div class="u">${cur}</div>
      </div>
      <div class="card" style="--accent:#7A5240;--tint:#F3EDE8;">
        <div class="k">إجمالي الدفعات المستلمة</div>
        <div class="v">${fmtAmount(data.totalRepaid)}</div>
        <div class="u">${cur}</div>
      </div>
      <div class="card" style="--accent:${data.outstanding > 0 ? '#E1503C' : '#7A5240'};--tint:${data.outstanding > 0 ? '#FBEAE7' : '#F3EDE8'};">
        <div class="k">الرصيد المتبقي</div>
        <div class="v">${fmtAmount(data.outstanding)}</div>
        <div class="u">${cur}</div>
      </div>
    </div>

    <div class="settlement">
      <div class="pct">${repaidPct}%</div>
      <div class="body2">
        <div class="title">ملخص التسوية</div>
        <div class="bar"><span style="width: ${repaidPct}%;"></span></div>
        <div class="desc">${repaidPct}% من إجمالي المستحقات تم سدادها</div>
      </div>
    </div>

    <h2>سجل الدفعات المستلمة <span class="count">(${data.payments.length} دفعة)</span></h2>
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>التاريخ</th>
          <th class="num">المبلغ (${cur})</th>
          <th>مقابل</th>
        </tr>
      </thead>
      <tbody>${paymentRows}</tbody>
      ${data.payments.length > 0 ? `<tfoot>
        <tr>
          <td colspan="2">الإجمالي</td>
          <td class="num">${cur} ${fmtAmount(paymentsTotal)}</td>
          <td></td>
        </tr>
      </tfoot>` : ''}
    </table>

    <div class="legal">هذا البيان صادر إلكترونياً ويعكس آخر تسوية معتمدة على النظام بتاريخ الإصدار أعلاه.</div>
  </div>

  <div class="page-footer">
    <span>الصفحة 1</span>
    <span>Taheito — Statement of Account</span>
  </div>
</div>

<div class="sheet">
  <div class="banner">
    <div class="banner-row">
      <div class="brand-en">
        <div class="name">${escapeHtml(businessName)}</div>
        <div class="tagline">${escapeHtml(businessTagline)}</div>
      </div>
      <div style="text-align: left;">
        <div class="month">سجل معاملات البيع مقابل الجنيه المصري</div>
        <div class="account-label" style="margin-top: 4px;">${data.binanceOrders.length} معاملة · إجمالي ${escapeHtml(binanceFiat)} ${fmtAmount(binanceTotal)}</div>
      </div>
    </div>
  </div>

  <div class="body">
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th class="num">المبلغ (${escapeHtml(binanceFiat)})</th>
          <th class="num">السعر</th>
          <th>التاريخ</th>
        </tr>
      </thead>
      <tbody>${binanceRows}</tbody>
      ${data.binanceOrders.length > 0 ? `<tfoot>
        <tr>
          <td>الإجمالي</td>
          <td class="num">${fmtAmount(binanceTotal)}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>` : ''}
    </table>
  </div>

  <div class="page-footer">
    <span>الصفحة 2</span>
    <span>Taheito — Statement of Account</span>
  </div>
</div>

</body>
</html>`;
}

/** Saves the statement as an actual PDF file, downloaded directly — no print dialog. */
export async function exportMonthlyStatementPdf(data: MonthlyStatementData, options: MonthlyStatementOptions = {}): Promise<void> {
  const html = buildMonthlyStatementHtml(data, options);
  await renderHtmlReportToPdf(html, `${monthlyStatementFileBase(data)}.pdf`, { orientation: 'portrait', renderWidth: 800 });
}

// ── XLSX ───────────────────────────────────────────────────────────

/** Saves the statement as a colored, formula-free XLSX workbook — a summary sheet, a payments sheet, and an EGP-ledger sheet. */
export async function exportMonthlyStatementXlsx(data: MonthlyStatementData, options: MonthlyStatementOptions = {}): Promise<void> {
  const { businessName = 'TAHEITO' } = options;
  const cur = currencySuffix(data.currency);
  const label = monthLabel(data.month);

  // Dynamically imported so exceljs (large) only loads into a device's
  // bundle when an export is actually triggered.
  const { default: ExcelJSLib } = await import('exceljs');
  const workbook = new ExcelJSLib.Workbook();
  workbook.creator = businessName;
  workbook.created = new Date();

  const headerFill: import('exceljs').Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C3D5A' } };
  const goodFill: import('exceljs').Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EDE8' } };
  const dueFill: import('exceljs').Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBEAE7' } };
  const altFill: import('exceljs').Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F4F1' } };

  // ── Summary ──
  const summary = workbook.addWorksheet('Summary');
  summary.views = [{ rightToLeft: true }];
  summary.columns = [{ width: 30 }, { width: 22 }];
  summary.mergeCells('A1:B1');
  summary.getCell('A1').value = `${businessName} — ${label}`;
  summary.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FF1C3D5A' } };
  summary.mergeCells('A2:B2');
  summary.getCell('A2').value = data.customerName;
  summary.getCell('A2').font = { bold: true, size: 12 };
  summary.addRow([]);

  const addRow = (label2: string, value: number | string, fill?: import('exceljs').Fill) => {
    const row = summary.addRow([label2, value]);
    row.getCell(1).font = { bold: true };
    if (typeof value === 'number') row.getCell(2).numFmt = '#,##0';
    if (fill) { row.getCell(1).fill = fill; row.getCell(2).fill = fill; }
  };
  addRow(`إجمالي المستحقات (${cur})`, data.totalLoaned);
  addRow(`إجمالي الدفعات المستلمة (${cur})`, data.totalRepaid, goodFill);
  addRow(`الرصيد المتبقي (${cur})`, data.outstanding, data.outstanding > 0 ? dueFill : goodFill);
  addRow('عدد الدفعات', data.payments.length);
  addRow('تاريخ الإصدار', data.issueDate);

  // ── Payments Received (no reference column) ──
  const paySheet = workbook.addWorksheet('Payments');
  paySheet.views = [{ rightToLeft: true }];
  paySheet.columns = [
    { header: '#', key: 'seq', width: 6 },
    { header: 'التاريخ', key: 'date', width: 16 },
    { header: `المبلغ (${cur})`, key: 'amount', width: 16 },
    { header: 'مقابل', key: 'note', width: 30 },
  ];
  paySheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = headerFill; });
  data.payments.forEach((p, i) => {
    const row = paySheet.addRow({
      seq: i + 1,
      date: fmtDate(p.date),
      amount: Math.round(p.amount),
      note: p.note || '—',
    });
    row.getCell('amount').numFmt = '#,##0';
    if (i % 2 === 1) row.eachCell(cell => { cell.fill = altFill; });
  });
  if (data.payments.length > 0) {
    const total = paySheet.addRow({ seq: '', date: 'الإجمالي', amount: Math.round(data.payments.reduce((s, p) => s + p.amount, 0)), note: '' });
    total.font = { bold: true };
    total.getCell('amount').numFmt = '#,##0';
  }

  // ── EGP Sell Ledger (no counterparty column) ──
  const fxSheet = workbook.addWorksheet('EGP Ledger');
  fxSheet.views = [{ rightToLeft: true }];
  const binanceFiat = data.binanceOrders[0]?.fiat || 'EGP';
  fxSheet.columns = [
    { header: '#', key: 'seq', width: 6 },
    { header: `المبلغ (${binanceFiat})`, key: 'amount', width: 16 },
    { header: 'السعر', key: 'price', width: 12 },
    { header: 'التاريخ', key: 'date', width: 16 },
  ];
  fxSheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = headerFill; });
  data.binanceOrders.forEach((o, i) => {
    const row = fxSheet.addRow({
      seq: i + 1,
      amount: o.fiatAmount,
      price: o.fiatPrice,
      date: fmtDate(o.date ?? ''),
    });
    row.getCell('amount').numFmt = '#,##0';
    row.getCell('price').numFmt = '0.00';
    if (i % 2 === 1) row.eachCell(cell => { cell.fill = altFill; });
  });
  if (data.binanceOrders.length > 0) {
    const total = fxSheet.addRow({ seq: '', amount: Math.round(data.binanceOrders.reduce((s, o) => s + o.fiatAmount, 0)), price: '', date: 'الإجمالي' });
    total.font = { bold: true };
    total.getCell('amount').numFmt = '#,##0';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  triggerBlobDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${monthlyStatementFileBase(data)}.xlsx`,
  );
}
