import { escapeHtml } from './loanStatementExport';

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
 * equivalent — a buyer only ever sees the EGP amount and the EGP/USDT price).
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

export function buildMonthlyStatementHtml(data: MonthlyStatementData, options: MonthlyStatementOptions = {}): string {
  const { businessName = 'TAHEITO', businessTagline = 'P2P TRADING & CAPITAL MANAGEMENT' } = options;
  const cur = currencySuffix(data.currency);
  const repaidPct = data.totalLoaned > 0 ? Math.min(100, Math.round((data.totalRepaid / data.totalLoaned) * 100)) : 0;
  const label = monthLabel(data.month);
  const paymentsTotal = data.payments.reduce((sum, p) => sum + p.amount, 0);
  const binanceTotal = data.binanceOrders.reduce((sum, o) => sum + o.fiatAmount, 0);
  const binanceFiat = data.binanceOrders[0]?.fiat || 'EGP';

  const paymentRows = data.payments.length === 0
    ? `<tr><td colspan="5" class="empty">لا توجد دفعات مسجلة هذا الشهر</td></tr>`
    : data.payments.map((p, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(fmtDate(p.date))}</td>
        <td class="num strong">${fmtAmount(p.amount)}</td>
        <td>${p.note ? escapeHtml(p.note) : '—'}</td>
        <td class="ref">${p.ref ? escapeHtml(p.ref) : '—'}</td>
      </tr>`).join('');

  const binanceRows = data.binanceOrders.length === 0
    ? `<tr><td colspan="6" class="empty">لا توجد معاملات بيع هذا الشهر</td></tr>`
    : data.binanceOrders.map((o, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${o.counterparty ? escapeHtml(o.counterparty) : '—'}</td>
        <td class="num strong">${fmtAmount(o.fiatAmount)}</td>
        <td class="num">${o.fiatPrice.toFixed(2)}</td>
        <td>${escapeHtml(fmtDate(o.date ?? ''))}</td>
        <td class="ref">${escapeHtml(o.orderNumber || '—')}</td>
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
    margin: 0; background: #f4f5f7; color: #14161c;
    font-family: 'Tahoma', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
    font-size: 11px; line-height: 1.5;
  }
  .sheet { max-width: 820px; margin: 0 auto 24px; background: #fff; padding: 28px 30px 22px; }
  .sheet + .sheet { page-break-before: always; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 18px; }
  .brand-en { text-align: left; direction: ltr; }
  .brand-en .name { font-size: 16px; font-weight: 800; letter-spacing: .3px; }
  .brand-en .tagline { font-size: 9px; color: #6b7280; font-weight: 700; letter-spacing: .3px; margin-top: 2px; }
  .head-title { font-size: 13px; font-weight: 800; color: #14161c; }
  .hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
          padding-bottom: 14px; margin-bottom: 16px; border-bottom: 2px solid #14161c; }
  .hero .account-label { font-size: 9px; font-weight: 800; color: #6b7280; letter-spacing: .6px; direction: ltr; text-align: left; }
  .hero .name { font-size: 20px; font-weight: 800; margin-top: 6px; }
  .hero .note { font-size: 10.5px; color: #6b7280; margin-top: 6px; max-width: 480px; }
  .cards { display: flex; gap: 10px; margin-bottom: 20px; }
  .card { flex: 1; border: 1px solid #dfe3ea; border-radius: 10px; padding: 12px 14px; background: #fbfcfd; text-align: center; }
  .card .k { font-size: 9px; font-weight: 700; color: #6b7280; letter-spacing: .3px; }
  .card .v { font-size: 20px; font-weight: 800; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .card .u { font-size: 10px; font-weight: 600; color: #6b7280; margin-inline-start: 4px; }
  .card.paid .v { color: #157347; }
  .card.due .v { color: #A6332A; }
  .settlement { display: flex; align-items: center; gap: 18px; margin-bottom: 24px; padding: 14px 16px;
                border: 1px solid #dfe3ea; border-radius: 10px; background: #fbfcfd; }
  .settlement .pct { font-size: 28px; font-weight: 800; color: #157347; min-width: 64px; }
  .settlement .body { flex: 1; }
  .settlement .title { font-size: 10px; font-weight: 800; color: #6b7280; letter-spacing: .3px; margin-bottom: 6px; }
  .settlement .bar { height: 8px; border-radius: 4px; background: #eceef2; overflow: hidden; }
  .settlement .bar > span { display: block; height: 100%; background: #157347; border-radius: 4px; }
  .settlement .desc { font-size: 10.5px; color: #6b7280; margin-top: 6px; }
  h2 { font-size: 12px; font-weight: 800; margin: 0 0 8px; }
  h2 .count { font-weight: 600; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th { font-size: 8.5px; letter-spacing: .5px; text-transform: uppercase; color: #6b7280;
       text-align: right; padding: 6px 8px; background: #f2f4f7; border-bottom: 1px solid #d6dbe3; font-weight: 700; }
  td { padding: 7px 8px; border-bottom: 1px solid #eceef2; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  th.num, td.num { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.ref { font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 9.5px; color: #6b7280; white-space: nowrap; }
  td.strong { font-weight: 700; }
  td.empty { text-align: center; color: #8b91a0; padding: 16px; }
  tfoot td { border-top: 1.5px solid #14161c; border-bottom: none; font-weight: 800; background: #fff !important; }
  .fx-note { font-size: 9.5px; color: #8b91a0; margin-top: 14px; text-align: center; }
  .legal { font-size: 9.5px; color: #aaa; margin-top: 18px; text-align: center; }
  .page-footer { display: flex; justify-content: space-between; margin-top: 16px; padding-top: 10px;
                 border-top: 1px solid #dfe3ea; font-size: 9px; color: #6b7280; }
  @media print {
    body { background: #fff; }
    .sheet { max-width: none; margin: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>

<div class="sheet">
  <div class="head">
    <div class="brand-en">
      <div class="name">${escapeHtml(businessName)}</div>
      <div class="tagline">${escapeHtml(businessTagline)}</div>
    </div>
    <div class="head-title">${escapeHtml(label)}</div>
  </div>

  <div class="hero">
    <div>
      <div class="account-label">${escapeHtml(data.currency)} ACCOUNT</div>
      <div class="name">${escapeHtml(data.customerName)}</div>
      <div class="note">بيان شهر ${escapeHtml(label)} فقط — جميع الطلبات والدفعات حتى تاريخ الإصدار ${escapeHtml(fmtDate(data.issueDate))}</div>
    </div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="k">إجمالي المستحقات</div>
      <div class="v">${fmtAmount(data.totalLoaned)}</div>
      <div class="k">${cur}</div>
    </div>
    <div class="card paid">
      <div class="k">إجمالي الدفعات المستلمة</div>
      <div class="v">${fmtAmount(data.totalRepaid)}</div>
      <div class="k">${cur}</div>
    </div>
    <div class="card due">
      <div class="k">الرصيد المتبقي</div>
      <div class="v">${fmtAmount(data.outstanding)}</div>
      <div class="k">${cur}</div>
    </div>
  </div>

  <div class="settlement">
    <div class="pct">${repaidPct}%</div>
    <div class="body">
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
        <th>المرجع</th>
      </tr>
    </thead>
    <tbody>${paymentRows}</tbody>
    ${data.payments.length > 0 ? `<tfoot>
      <tr>
        <td colspan="2">الإجمالي</td>
        <td class="num">${cur} ${fmtAmount(paymentsTotal)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>` : ''}
  </table>

  <div class="legal">هذا البيان صادر إلكترونياً ويعكس آخر تسوية معتمدة على النظام بتاريخ الإصدار أعلاه.</div>

  <div class="page-footer">
    <span>الصفحة 1</span>
    <span>Taheito — Statement of Account</span>
  </div>
</div>

<div class="sheet">
  <div class="head">
    <div class="brand-en">
      <div class="name">${escapeHtml(businessName)}</div>
      <div class="tagline">${escapeHtml(businessTagline)}</div>
    </div>
    <div style="text-align: left;">
      <div class="head-title">سجل معاملات البيع مقابل الجنيه المصري</div>
      <div class="account-label" style="margin-top: 4px;">${data.binanceOrders.length} معاملة · إجمالي ${escapeHtml(binanceFiat)} ${fmtAmount(binanceTotal)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>الطرف الآخر</th>
        <th class="num">المبلغ (${escapeHtml(binanceFiat)})</th>
        <th class="num">السعر</th>
        <th>التاريخ</th>
        <th>رقم الطلب</th>
      </tr>
    </thead>
    <tbody>${binanceRows}</tbody>
    ${data.binanceOrders.length > 0 ? `<tfoot>
      <tr>
        <td colspan="2">الإجمالي</td>
        <td class="num">${fmtAmount(binanceTotal)}</td>
        <td colspan="3"></td>
      </tr>
    </tfoot>` : ''}
  </table>

  <div class="page-footer">
    <span>الصفحة 2</span>
    <span>Taheito — Statement of Account</span>
  </div>
</div>

</body>
</html>`;
}
