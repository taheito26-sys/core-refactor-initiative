import { escapeHtml } from './loanStatementExport';
import { renderHtmlReportToPdf, triggerBlobDownload } from '@/lib/htmlReportToPdf';

/**
 * The monthly Taheito buyer statement — a pixel match of the branded
 * two-part document merchants have been hand-exporting and sending to
 * buyers: a "QAR ACCOUNT"-style statement page (cumulative totals, full
 * payment history) followed by that month's EGP sell ledger (this buyer's
 * own FX-sourcing trail — the same scope the tracker uses for their order
 * count). Buyers get this self-service from the customer portal instead of
 * waiting on the merchant to generate and send it by hand.
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
  /** Per-language spellings, when the merchant recorded them. */
  customerNameEn?: string | null;
  customerNameAr?: string | null;
  currency: string;
  totalLoaned: number;
  totalRepaid: number;
  outstanding: number;
  /** Unpaid balance carried forward from before this month started. */
  previousBalance: number;
  /** Lifetime totals (every order/payment ever recorded), used for the settlement percentage. */
  totalLoanedAllTime: number;
  totalRepaidAllTime: number;
  issueDate: string;
  /** 'YYYY-MM' — the month this statement covers. */
  month: string;
  payments: MonthlyStatementPayment[];
  binanceOrders: MonthlyStatementBinanceRow[];
}

export interface MonthlyStatementOptions {
  businessName?: string;
  businessTagline?: string;
  /** Reader's UI language — decides which spelling of the buyer's name is printed. */
  lang?: 'en' | 'ar';
}

/**
 * The buyer's name in the reader's language, falling back to the other
 * spelling and then to the single legacy name. The body of this statement is
 * Arabic by design, but the name is the one piece a reader matches against
 * their own records, so it follows the language they are working in.
 */
export function resolveStatementName(data: MonthlyStatementData, lang: 'en' | 'ar'): string {
  const primary = lang === 'ar' ? data.customerNameAr : data.customerNameEn;
  const secondary = lang === 'ar' ? data.customerNameEn : data.customerNameAr;
  return primary || secondary || data.customerName;
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

/** 'YYYY-MM' → the label for the calendar month right before it. */
function previousMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(n => parseInt(n, 10));
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${ARABIC_MONTHS[(prevMonth - 1 + 12) % 12]} ${prevYear}`;
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

/** `HHMMSS` in the exporting device's local time — down to the second, so a
 * file downloaded moments apart (e.g. while debugging a rendering issue)
 * never silently overwrites the previous one and can be told apart at a
 * glance. */
function nowTimeStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function monthlyStatementFileBase(data: MonthlyStatementData, lang: 'en' | 'ar' = 'ar'): string {
  const name = resolveStatementName(data, lang)
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'buyer';
  return `${name}-statement-${data.month}-${nowTimeStamp()}`;
}

// ── Printable / rasterized document ─────────────────────────────────

export function buildMonthlyStatementHtml(data: MonthlyStatementData, options: MonthlyStatementOptions = {}): string {
  const displayName = resolveStatementName(data, options.lang ?? 'ar');
  const cur = currencySuffix(data.currency);
  // Coalesced defensively: a not-yet-redeployed edge function won't send
  // this field at all, and undefined + totalLoaned is NaN, not a missing
  // carryover — that must never leak into the customer-facing total.
  const previousBalance = data.previousBalance || 0;
  const grandTotalDue = previousBalance + data.totalLoaned;
  // Against lifetime totals, matching the tracker's own "المسدد إجمالي" — not
  // this month's totalRepaid over grandTotalDue, which covers only a few
  // weeks of activity and produces a very different, misleading ratio.
  const totalLoanedAllTime = data.totalLoanedAllTime || 0;
  const totalRepaidAllTime = data.totalRepaidAllTime || 0;
  const repaidPct = totalLoanedAllTime > 0 ? Math.min(100, Math.round((totalRepaidAllTime / totalLoanedAllTime) * 100)) : 0;
  const label = monthLabel(data.month);
  const prevLabel = previousMonthLabel(data.month);
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
    ? `<tr><td colspan="5" class="empty">لا توجد معاملات بيع هذا الشهر</td></tr>`
    : data.binanceOrders.map((o, i) => `
      <tr class="${i % 2 === 1 ? 'alt' : ''}">
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(fmtDate(o.date ?? ''))}</td>
        <td class="num strong">${fmtAmount(o.fiatAmount)}</td>
        <td class="num">${o.fiatPrice.toFixed(2)}</td>
        <td class="num">${escapeHtml(o.orderNumber)}</td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>بيان حساب ${escapeHtml(displayName)} — ${escapeHtml(label)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #F7F9FA; color: #243746;
    font-family: 'Tahoma', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
    font-size: 10.5px; line-height: 1.4;
  }
  /* Tokens from the statement design spec: deep navy, restrained coral,
     ice-blue and warm-sand tints. Scoped to .sheet (not :root) since this
     stylesheet also runs inside an SVG foreignObject during PDF
     rasterization, where :root resolves to the <svg> element rather than
     the rendered subtree. Sizing throughout is deliberately compact — one
     buyer's month of activity must fit a single physical page; anything
     taller silently spills a near-blank second page onto the export. */
  .sheet {
    --navy: #214562;
    --navy-dark: #17384f;
    --coral: #ef5a48;
    --coral-soft: #fff0ed;
    --blue-soft: #eaf3f6;
    --blue-border: #c8dce4;
    --sand-soft: #f5f1ed;
    --green: #2f9e6b;
    --green-soft: #eaf6f0;
    --amber: #c97a1f;
    --amber-soft: #fdf3e3;
    --teal: #1f7a8c;
    --teal-soft: #e8f4f6;
    --ink: #243746;
    --muted: #71808b;
    --border: #dbe3e7;
    --border-soft: #eceff1;
    direction: rtl; max-width: 820px; margin: 0 auto 16px; background: #fff; padding: 18px 22px 16px;
    border-radius: 14px; overflow: hidden; box-shadow: 0 6px 18px rgba(33,69,98,.08);
  }
  .sheet + .sheet { page-break-before: always; }

  .banner {
    background: var(--navy);
    color: #fff; padding: 12px 28px 10px; border-radius: 12px;
    position: relative; overflow: hidden; margin-bottom: 14px;
  }
  .banner::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: var(--coral);
  }
  .banner-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .banner .month { font-size: 18px; font-weight: 800; color: #FCD9D2; }
  .hero { display: flex; align-items: baseline; gap: 12px; margin-top: 3px; }
  .hero .name { font-size: 24px; font-weight: 800; color: #fff; }
  .hero .note { font-size: 12px; color: #C9D6DF; line-height: 1.3; flex: 1; }

  .cards { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .card {
    flex: 1 1 calc(33.333% - 4px); min-width: 0; border-radius: 8px; padding: 7px 6px; text-align: center;
    border: 1px solid var(--border); background: var(--tint, var(--blue-soft));
    position: relative; overflow: hidden;
  }
  .card::after { content: ""; position: absolute; inset-block: 0; inset-inline-end: 0; width: 3px; background: var(--accent, var(--navy)); }
  .card .k { font-size: 10.5px; font-weight: 700; letter-spacing: 0; color: var(--muted); line-height: 1.25; }
  .card .v { font-size: 19.5px; font-weight: 800; margin-top: 3px; font-variant-numeric: tabular-nums; color: var(--accent, var(--navy)); white-space: nowrap; }
  .card .u { font-size: 10.5px; font-weight: 600; color: var(--muted); margin-top: 1px; }

  .settlement {
    display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding: 9px 12px;
    border-radius: 10px; background: var(--blue-soft); border: 1px solid var(--blue-border);
  }
  .settlement .pct { font-size: 17px; font-weight: 800; color: var(--navy); min-width: 42px; font-variant-numeric: tabular-nums; }
  .settlement .body2 { flex: 1; }
  .settlement .title { font-size: 8.5px; font-weight: 800; color: var(--navy); letter-spacing: .2px; margin-bottom: 4px; }
  .settlement .bar { height: 6px; border-radius: 3px; background: var(--blue-border); overflow: hidden; }
  .settlement .bar > span { display: block; height: 100%; background: var(--navy); border-radius: 3px; }
  .settlement .desc { font-size: 8px; color: var(--muted); margin-top: 4px; }

  h2 {
    display: flex; align-items: center; gap: 7px;
    font-size: 11px; font-weight: 800; color: var(--navy); margin: 4px 0 6px;
  }
  h2::before { content: ""; width: 4px; height: 15px; border-radius: 4px; background: var(--coral); flex-shrink: 0; }
  h2 .count { font-weight: 600; color: var(--muted); }

  table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 4px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
  th {
    font-size: 7.5px; letter-spacing: .3px; text-transform: uppercase; color: #fff;
    text-align: right; padding: 6px 9px; background: var(--navy); font-weight: 700;
  }
  td { padding: 6px 9px; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
  tr.alt td { background: var(--sand-soft); }
  th.num, td.num { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; direction: ltr; unicode-bidi: isolate; }
  td.desc { color: var(--muted); }
  td.strong { font-weight: 800; color: var(--navy); }
  td.empty { text-align: center; color: var(--muted); padding: 12px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 800; font-size: 9px; background: var(--sand-soft); color: var(--ink); }

  tfoot td { border-top: 2px solid var(--navy); border-bottom: none; font-weight: 800; background: var(--blue-soft) !important; color: var(--navy); }
  .legal {
    font-size: 8px; color: var(--muted); margin-top: 10px; text-align: center;
    background: #f8fafb; border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px;
  }
  .page-footer {
    display: flex; justify-content: center; margin-top: 10px; padding-top: 7px;
    border-top: 1px solid var(--border-soft); font-size: 7.5px; color: var(--muted);
  }
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
      <div class="month">${escapeHtml(label)}</div>
      <div class="hero">
        <div class="name">${escapeHtml(displayName)}</div>
        <div class="note">${previousBalance > 0
          ? `يبدأ برصيد شهر ${escapeHtml(prevLabel)} المرحّل، ويضيف طلبات ودفعات ${escapeHtml(label)} فقط`
          : `بيان شهر ${escapeHtml(label)} فقط — حتى تاريخ الإصدار ${escapeHtml(fmtDate(data.issueDate))}`}</div>
      </div>
    </div>
  </div>

  <div class="cards">
    <div class="card" style="--accent:var(--coral);--tint:var(--coral-soft);">
      <div class="k">مديونية مرحّلة من شهر ${escapeHtml(prevLabel)}</div>
      <div class="v">${fmtAmount(previousBalance)}</div>
      <div class="u">${cur}</div>
    </div>
    <div class="card" style="--accent:var(--navy);--tint:var(--blue-soft);">
      <div class="k">مديونية ${escapeHtml(label)} (جديدة)</div>
      <div class="v">${fmtAmount(data.totalLoaned)}</div>
      <div class="u">${cur}</div>
    </div>
    <div class="card" style="--accent:var(--green);--tint:var(--green-soft);">
      <div class="k">مدفوعات ${escapeHtml(label)}</div>
      <div class="v">${fmtAmount(data.totalRepaid)}</div>
      <div class="u">${cur}</div>
    </div>
    <div class="card" style="--accent:var(--amber);--tint:var(--amber-soft);">
      <div class="k">الرصيد المتبقي</div>
      <div class="v">${fmtAmount(data.outstanding)}</div>
      <div class="u">${cur}</div>
    </div>
    <div class="card" style="--accent:#8a5a3e;--tint:var(--sand-soft);">
      <div class="k">إجمالي المستحقات</div>
      <div class="v">${fmtAmount(grandTotalDue)}</div>
      <div class="u">${cur}</div>
    </div>
    <div class="card" style="--accent:var(--teal);--tint:var(--teal-soft);">
      <div class="k">حجم البيع (${escapeHtml(binanceFiat)})</div>
      <div class="v">${fmtAmount(binanceTotal)}</div>
      <div class="u">${escapeHtml(binanceFiat)}</div>
    </div>
  </div>

  <div class="settlement">
    <div class="pct">${repaidPct}%</div>
    <div class="body2">
      <div class="title">ملخص التسوية الإجمالي</div>
      <div class="bar"><span style="width: ${repaidPct}%;"></span></div>
      <div class="desc">${repaidPct}% من إجمالي المديونية منذ بداية التعامل تم سدادها</div>
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

  <div class="page-footer">
    <span>الصفحة 1</span>
  </div>
</div>

<div class="sheet">
  <div class="banner">
    <div class="banner-row">
      <div class="month">سجل معاملات البيع مقابل الجنيه المصري</div>
      <div class="hero">
        <div class="note">${data.binanceOrders.length} معاملة · إجمالي ${escapeHtml(binanceFiat)} ${fmtAmount(binanceTotal)}</div>
      </div>
    </div>
  </div>

  <div class="cards">
    <div class="card" style="--accent:var(--navy);--tint:var(--blue-soft);">
      <div class="k">إجمالي مبلغ ${escapeHtml(binanceFiat)} المباع</div>
      <div class="v">${fmtAmount(binanceTotal)}</div>
      <div class="u">${escapeHtml(binanceFiat)} · ${data.binanceOrders.length} معاملة</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>التاريخ</th>
        <th class="num">المبلغ (${escapeHtml(binanceFiat)})</th>
        <th class="num">سعر البيع</th>
        <th class="num">رقم الطلب (Binance)</th>
      </tr>
    </thead>
    <tbody>${binanceRows}</tbody>
    ${data.binanceOrders.length > 0 ? `<tfoot>
      <tr>
        <td colspan="2">الإجمالي</td>
        <td class="num">${fmtAmount(binanceTotal)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>` : ''}
  </table>

  <div class="legal">إجمالي مبلغ ${escapeHtml(binanceFiat)} المباع خلال ${escapeHtml(label)}: <strong>${escapeHtml(binanceFiat)} ${fmtAmount(binanceTotal)}</strong></div>

  <div class="page-footer">
    <span>الصفحة 2</span>
  </div>
</div>

</body>
</html>`;
}

/** Saves the statement as an actual PDF file, downloaded directly — no print dialog. */
export async function exportMonthlyStatementPdf(data: MonthlyStatementData, options: MonthlyStatementOptions = {}): Promise<void> {
  const html = buildMonthlyStatementHtml(data, options);
  const fileBase = monthlyStatementFileBase(data, options.lang ?? 'ar');
  await renderHtmlReportToPdf(html, `${fileBase}.pdf`, { orientation: 'portrait', renderWidth: 800 });
}

// ── XLSX ───────────────────────────────────────────────────────────

/** Saves the statement as a colored, formula-free XLSX workbook — a summary sheet, a payments sheet, and an EGP-ledger sheet. */
export async function exportMonthlyStatementXlsx(data: MonthlyStatementData, options: MonthlyStatementOptions = {}): Promise<void> {
  const { businessName = 'TAHEITO' } = options;
  const displayName = resolveStatementName(data, options.lang ?? 'ar');
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
  summary.getCell('A2').value = displayName;
  summary.getCell('A2').font = { bold: true, size: 12 };
  summary.addRow([]);

  const addRow = (label2: string, value: number | string, fill?: import('exceljs').Fill) => {
    const row = summary.addRow([label2, value]);
    row.getCell(1).font = { bold: true };
    if (typeof value === 'number') row.getCell(2).numFmt = '#,##0';
    if (fill) { row.getCell(1).fill = fill; row.getCell(2).fill = fill; }
  };
  const previousBalance = data.previousBalance || 0;
  const totalLoanedAllTime = data.totalLoanedAllTime || 0;
  const totalRepaidAllTime = data.totalRepaidAllTime || 0;
  const binanceFiatXlsx = data.binanceOrders[0]?.fiat || 'EGP';
  const binanceTotalXlsx = data.binanceOrders.reduce((sum, o) => sum + o.fiatAmount, 0);
  addRow(`مديونية مرحّلة من شهر ${previousMonthLabel(data.month)} (${cur})`, previousBalance, dueFill);
  addRow(`مديونية ${label} (جديدة) (${cur})`, data.totalLoaned);
  addRow(`مدفوعات ${label} (${cur})`, data.totalRepaid, goodFill);
  addRow(`الرصيد المتبقي (${cur})`, data.outstanding, data.outstanding > 0 ? dueFill : goodFill);
  addRow(`إجمالي المستحقات (${cur})`, previousBalance + data.totalLoaned);
  addRow(`نسبة التسوية الإجمالية %`, totalLoanedAllTime > 0 ? Math.round((totalRepaidAllTime / totalLoanedAllTime) * 100) : 0);
  addRow(`إجمالي حجم البيع (${binanceFiatXlsx})`, binanceTotalXlsx);
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
    { header: 'التاريخ', key: 'date', width: 16 },
    { header: `المبلغ (${binanceFiat})`, key: 'amount', width: 16 },
    { header: 'سعر البيع', key: 'price', width: 12 },
    { header: 'رقم الطلب (Binance)', key: 'orderNumber', width: 22 },
  ];
  fxSheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = headerFill; });
  data.binanceOrders.forEach((o, i) => {
    const row = fxSheet.addRow({
      seq: i + 1,
      date: fmtDate(o.date ?? ''),
      amount: o.fiatAmount,
      price: o.fiatPrice,
      orderNumber: o.orderNumber,
    });
    row.getCell('amount').numFmt = '#,##0';
    row.getCell('price').numFmt = '0.00';
    if (i % 2 === 1) row.eachCell(cell => { cell.fill = altFill; });
  });
  if (data.binanceOrders.length > 0) {
    const total = fxSheet.addRow({ seq: '', date: 'الإجمالي', amount: Math.round(data.binanceOrders.reduce((s, o) => s + o.fiatAmount, 0)), price: '', orderNumber: '' });
    total.font = { bold: true };
    total.getCell('amount').numFmt = '#,##0';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  triggerBlobDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${monthlyStatementFileBase(data, options.lang ?? 'ar')}.xlsx`,
  );
}
