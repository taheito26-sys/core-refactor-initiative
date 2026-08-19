import type { BuyerStatement } from './loanStatement';

/**
 * Turning a buyer statement into something that can be sent to the buyer.
 *
 * Two formats, one source of truth:
 *  - CSV, which Excel and Sheets open directly. Amounts stay raw numbers so the
 *    buyer (or an accountant) can sum the columns.
 *  - A printable HTML document, which the browser's print dialog saves as PDF.
 *    It is deliberately a light, paper-coloured layout rather than the app's
 *    dark theme — this is a document, not a screenshot.
 *
 * Both builders are pure string functions; the DOM-touching helpers at the
 * bottom are the only part that needs a browser.
 */

export interface StatementDocLabels {
  documentTitle: string;
  issuedBy: string;
  billTo: string;
  phone: string;
  statementDate: string;
  period: string;
  currency: string;
  summary: string;
  totalLoaned: string;
  totalRepaid: string;
  outstanding: string;
  loanedOrders: string;
  ref: string;
  date: string;
  description: string;
  amount: string;
  paid: string;
  remaining: string;
  status: string;
  age: string;
  days: string;
  statusOpen: string;
  statusSettled: string;
  paymentsReceived: string;
  account: string;
  note: string;
  ledger: string;
  charge: string;
  payment: string;
  debit: string;
  credit: string;
  balance: string;
  totalDue: string;
  aging: string;
  agingCurrent: string;
  aging31: string;
  aging61: string;
  aging90: string;
  noPayments: string;
  noEntries: string;
  generatedOn: string;
  footerNote: string;
  openingBalance: string;
  settlementSummary: string;
  settlementTotalLine: string;
  settlementPaidLine: string;
  settlementRemainingLine: string;
  percentPaidSuffix: string;
  against: string;
  paymentsLog: string;
  allPayments: string;
  electronicNote: string;
}

export interface StatementDocOptions {
  /** Business name printed at the top of the document. */
  businessName?: string;
  /** `en` or `ar` — drives text direction and date formatting. */
  lang?: string;
  /** Overrides "now" for the statement date. Tests pass a fixed value. */
  now?: number;
}

/** Money with two decimals and thousands separators — document formatting. */
export function formatMoney(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Raw two-decimal number for spreadsheet cells — no separators, so Excel sums it. */
function rawAmount(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function formatDate(ts: number, lang = 'en'): string {
  return new Date(ts).toLocaleDateString(lang === 'ar' ? 'ar' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatDateTime(ts: number, lang = 'en'): string {
  const d = new Date(ts);
  return `${formatDate(ts, lang)} ${d.toLocaleTimeString(lang === 'ar' ? 'ar' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** ISO date, used in file names so statements sort chronologically on disk. */
function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ── CSV ────────────────────────────────────────────────────────────

/** Quote a CSV cell, and defuse anything a spreadsheet would run as a formula. */
export function csvCell(value: string | number): string {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',');
}

/**
 * The statement as a spreadsheet: a summary block, the loaned orders, the
 * payments, and the running ledger — each with its own header row.
 */
export function buildStatementCsv(
  statement: BuyerStatement,
  labels: StatementDocLabels,
  options: StatementDocOptions = {},
): string {
  const { businessName = '', lang = 'en', now = Date.now() } = options;
  const rows: string[] = [];

  rows.push(csvRow([labels.documentTitle]));
  if (businessName) rows.push(csvRow([labels.issuedBy, businessName]));
  rows.push(csvRow([labels.billTo, statement.customerName]));
  if (statement.phone) rows.push(csvRow([labels.phone, statement.phone]));
  rows.push(csvRow([labels.statementDate, formatDate(now, lang)]));
  rows.push(csvRow([labels.period, `${formatDate(statement.firstActivityTs, lang)} — ${formatDate(statement.lastActivityTs, lang)}`]));
  rows.push(csvRow([labels.currency, statement.currency]));
  rows.push('');

  rows.push(csvRow([labels.summary]));
  rows.push(csvRow([labels.totalLoaned, rawAmount(statement.totalLoaned)]));
  rows.push(csvRow([labels.totalRepaid, rawAmount(statement.totalRepaid)]));
  rows.push(csvRow([labels.totalDue, rawAmount(statement.outstanding)]));
  rows.push('');

  rows.push(csvRow([labels.loanedOrders]));
  rows.push(csvRow([labels.ref, labels.date, labels.description, labels.amount, labels.paid, labels.remaining, labels.status, labels.age]));
  for (const row of statement.loans) {
    rows.push(csvRow([
      row.ref,
      formatDate(row.loan.ts, lang),
      row.loan.note || '',
      rawAmount(row.principal),
      rawAmount(row.repaid),
      rawAmount(row.remaining),
      row.settled ? labels.statusSettled : labels.statusOpen,
      row.settled ? '' : row.ageDays,
    ]));
  }
  rows.push(csvRow(['', '', labels.totalDue, rawAmount(statement.totalLoaned), rawAmount(statement.totalRepaid), rawAmount(statement.outstanding), '', '']));
  rows.push('');

  const payments = statement.entries.filter(e => e.kind === 'payment');
  rows.push(csvRow([labels.paymentsReceived]));
  if (payments.length === 0) {
    rows.push(csvRow([labels.noPayments]));
  } else {
    rows.push(csvRow([labels.date, labels.ref, labels.amount, labels.account, labels.note]));
    for (const p of payments) {
      rows.push(csvRow([formatDateTime(p.ts, lang), p.ref, rawAmount(p.credit), p.accountName || '', p.description]));
    }
    rows.push(csvRow(['', labels.totalRepaid, rawAmount(statement.totalRepaid), '', '']));
  }
  rows.push('');

  rows.push(csvRow([labels.ledger]));
  rows.push(csvRow([labels.date, labels.ref, labels.description, labels.debit, labels.credit, labels.balance]));
  for (const e of statement.entries) {
    rows.push(csvRow([
      formatDate(e.ts, lang),
      e.ref,
      e.description || (e.kind === 'charge' ? labels.charge : labels.payment),
      e.debit ? rawAmount(e.debit) : '',
      e.credit ? rawAmount(e.credit) : '',
      rawAmount(e.balance),
    ]));
  }
  rows.push(csvRow(['', '', labels.totalDue, '', '', rawAmount(statement.outstanding)]));
  rows.push('');

  rows.push(csvRow([labels.aging]));
  rows.push(csvRow([labels.agingCurrent, labels.aging31, labels.aging61, labels.aging90]));
  rows.push(csvRow([
    rawAmount(statement.aging.current),
    rawAmount(statement.aging.d31),
    rawAmount(statement.aging.d61),
    rawAmount(statement.aging.d90plus),
  ]));
  rows.push('');
  rows.push(csvRow([`${labels.generatedOn} ${formatDateTime(now, lang)}`]));

  return rows.join('\r\n');
}

/**
 * The whole receivables book as one sheet: a row per buyer with their totals,
 * then a row per loaned order underneath. This is the internal report — a
 * single buyer's statement is what gets sent out.
 */
export function buildReceivablesCsv(
  statements: BuyerStatement[],
  labels: StatementDocLabels,
  options: StatementDocOptions = {},
): string {
  const { businessName = '', lang = 'en', now = Date.now() } = options;
  const rows: string[] = [];

  rows.push(csvRow([`${labels.documentTitle} — ${labels.outstanding}`]));
  if (businessName) rows.push(csvRow([labels.issuedBy, businessName]));
  rows.push(csvRow([labels.statementDate, formatDate(now, lang)]));
  rows.push('');

  rows.push(csvRow([
    labels.billTo, labels.phone, labels.currency, labels.loanedOrders,
    labels.totalLoaned, labels.totalRepaid, labels.outstanding, labels.age,
  ]));
  for (const s of statements) {
    rows.push(csvRow([
      s.customerName, s.phone || '', s.currency, s.loans.length,
      rawAmount(s.totalLoaned), rawAmount(s.totalRepaid), rawAmount(s.outstanding), s.oldestOpenDays,
    ]));
  }
  rows.push('');

  rows.push(csvRow([labels.loanedOrders]));
  rows.push(csvRow([
    labels.billTo, labels.ref, labels.date, labels.description, labels.currency,
    labels.amount, labels.paid, labels.remaining, labels.status, labels.age,
  ]));
  for (const s of statements) {
    for (const row of s.loans) {
      rows.push(csvRow([
        s.customerName, row.ref, formatDate(row.loan.ts, lang), row.loan.note || '', s.currency,
        rawAmount(row.principal), rawAmount(row.repaid), rawAmount(row.remaining),
        row.settled ? labels.statusSettled : labels.statusOpen, row.ageDays,
      ]));
    }
  }
  rows.push('');
  rows.push(csvRow([`${labels.generatedOn} ${formatDateTime(now, lang)}`]));

  return rows.join('\r\n');
}

// ── Printable document (→ PDF) ─────────────────────────────────────

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A one-page-per-buyer statement of account, styled for paper: white ground,
 * hairline rules, right-aligned tabular figures, totals in a boxed footer.
 */
export function buildStatementHtml(
  statement: BuyerStatement,
  labels: StatementDocLabels,
  options: StatementDocOptions = {},
): string {
  const { businessName = '', lang = 'en', now = Date.now() } = options;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const cur = escapeHtml(statement.currency);
  const payments = statement.entries.filter(e => e.kind === 'payment');

  const loanRows = statement.loans.map(row => `
      <tr>
        <td class="ref">${escapeHtml(row.ref)}</td>
        <td>${escapeHtml(formatDate(row.loan.ts, lang))}</td>
        <td class="desc">${escapeHtml(row.loan.note || '—')}</td>
        <td class="num">${formatMoney(row.principal)}</td>
        <td class="num paid">${formatMoney(row.repaid)}</td>
        <td class="num due">${formatMoney(row.remaining)}</td>
        <td><span class="tag ${row.settled ? 'ok' : 'open'}">${escapeHtml(row.settled ? labels.statusSettled : labels.statusOpen)}</span></td>
        <td class="num">${row.settled ? '—' : row.ageDays}</td>
      </tr>`).join('');

  const paymentRows = payments.length === 0
    ? `<tr><td colspan="5" class="empty">${escapeHtml(labels.noPayments)}</td></tr>`
    : payments.map(p => `
      <tr>
        <td>${escapeHtml(formatDate(p.ts, lang))}</td>
        <td class="ref">${escapeHtml(p.ref)}</td>
        <td class="num paid">${formatMoney(p.credit)}</td>
        <td>${escapeHtml(p.accountName || '—')}</td>
        <td class="desc">${escapeHtml(p.description || '—')}</td>
      </tr>`).join('');

  const ledgerRows = statement.entries.length === 0
    ? `<tr><td colspan="6" class="empty">${escapeHtml(labels.noEntries)}</td></tr>`
    : statement.entries.map(e => `
      <tr>
        <td>${escapeHtml(formatDate(e.ts, lang))}</td>
        <td class="ref">${escapeHtml(e.ref)}</td>
        <td class="desc">${escapeHtml(e.description || (e.kind === 'charge' ? labels.charge : labels.payment))}</td>
        <td class="num">${e.debit ? formatMoney(e.debit) : ''}</td>
        <td class="num paid">${e.credit ? formatMoney(e.credit) : ''}</td>
        <td class="num strong">${formatMoney(e.balance)}</td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(labels.documentTitle)} — ${escapeHtml(statement.customerName)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #f4f5f7; color: #14161c;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px; line-height: 1.45;
  }
  .sheet { max-width: 820px; margin: 0 auto; background: #fff; padding: 28px 30px 34px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
          border-bottom: 2px solid #14161c; padding-bottom: 14px; }
  .brand { font-size: 15px; font-weight: 700; letter-spacing: .2px; }
  .doc-title { font-size: 19px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; text-align: ${dir === 'rtl' ? 'left' : 'right'}; }
  .doc-meta { margin-top: 4px; font-size: 10px; color: #5b6270; text-align: ${dir === 'rtl' ? 'left' : 'right'}; }
  .parties { display: flex; gap: 24px; margin: 16px 0 18px; }
  .party { flex: 1; }
  .label { font-size: 8.5px; letter-spacing: .8px; text-transform: uppercase; color: #6b7280; font-weight: 700; }
  .party .name { font-size: 13px; font-weight: 700; margin-top: 3px; }
  .party .sub { font-size: 10px; color: #5b6270; }
  .summary { display: flex; gap: 10px; margin-bottom: 20px; }
  .card { flex: 1; border: 1px solid #dfe3ea; border-radius: 6px; padding: 9px 11px; background: #fbfcfd; }
  .card.due { border-color: #b91c1c; background: #fef4f4; }
  .card .v { font-size: 15px; font-weight: 700; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .card.due .v { color: #b91c1c; }
  .card .u { font-size: 9px; font-weight: 600; color: #6b7280; margin-inline-start: 3px; }
  h2 { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #14161c;
       margin: 20px 0 7px; padding-bottom: 4px; border-bottom: 1px solid #dfe3ea; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: #5b6270;
       text-align: ${dir === 'rtl' ? 'right' : 'left'}; padding: 5px 7px; background: #f2f4f7; border-bottom: 1px solid #d6dbe3; font-weight: 700; }
  td { padding: 6px 7px; border-bottom: 1px solid #eceef2; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  th.num, td.num { text-align: ${dir === 'rtl' ? 'left' : 'right'}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.ref { font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 10px; white-space: nowrap; }
  td.desc { color: #454b57; }
  td.paid { color: #15803d; }
  td.due { color: #b91c1c; font-weight: 600; }
  td.strong { font-weight: 700; }
  td.empty { text-align: center; color: #8b91a0; padding: 12px; }
  tfoot td { border-top: 1.5px solid #14161c; border-bottom: none; font-weight: 700; background: #fff !important; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 8.5px; font-weight: 700;
         border: 1px solid currentColor; }
  .tag.open { color: #b45309; }
  .tag.ok { color: #15803d; }
  .total-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px;
               margin-top: 18px; padding: 12px 14px; border: 1.5px solid #14161c; border-radius: 6px; background: #fbfcfd; }
  .total-bar .k { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; font-weight: 700; }
  .total-bar .v { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .aging { display: flex; gap: 8px; margin-top: 14px; }
  .aging div { flex: 1; border: 1px solid #dfe3ea; border-radius: 5px; padding: 7px 9px; }
  .aging .v { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
  footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #dfe3ea; font-size: 9px; color: #6b7280;
           display: flex; justify-content: space-between; gap: 16px; }
  @media print {
    body { background: #fff; }
    .sheet { max-width: none; padding: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div>
      <div class="brand">${escapeHtml(businessName || labels.issuedBy)}</div>
      <div class="doc-meta">${escapeHtml(labels.currency)}: ${cur}</div>
    </div>
    <div>
      <div class="doc-title">${escapeHtml(labels.documentTitle)}</div>
      <div class="doc-meta">
        ${escapeHtml(labels.statementDate)}: ${escapeHtml(formatDate(now, lang))}<br />
        ${escapeHtml(labels.period)}: ${escapeHtml(formatDate(statement.firstActivityTs, lang))} — ${escapeHtml(formatDate(statement.lastActivityTs, lang))}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="label">${escapeHtml(labels.billTo)}</div>
      <div class="name">${escapeHtml(statement.customerName)}</div>
      ${statement.phone ? `<div class="sub">${escapeHtml(labels.phone)}: ${escapeHtml(statement.phone)}</div>` : ''}
    </div>
    <div class="party">
      <div class="label">${escapeHtml(labels.loanedOrders)}</div>
      <div class="name">${statement.loans.length}</div>
      <div class="sub">${statement.openCount} ${escapeHtml(labels.statusOpen)} · ${statement.settledCount} ${escapeHtml(labels.statusSettled)}</div>
    </div>
  </div>

  <div class="summary">
    <div class="card">
      <div class="label">${escapeHtml(labels.totalLoaned)}</div>
      <div class="v">${formatMoney(statement.totalLoaned)}<span class="u">${cur}</span></div>
    </div>
    <div class="card">
      <div class="label">${escapeHtml(labels.totalRepaid)}</div>
      <div class="v">${formatMoney(statement.totalRepaid)}<span class="u">${cur}</span></div>
    </div>
    <div class="card due">
      <div class="label">${escapeHtml(labels.outstanding)}</div>
      <div class="v">${formatMoney(statement.outstanding)}<span class="u">${cur}</span></div>
    </div>
  </div>

  <h2>${escapeHtml(labels.loanedOrders)}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(labels.ref)}</th>
        <th>${escapeHtml(labels.date)}</th>
        <th>${escapeHtml(labels.description)}</th>
        <th class="num">${escapeHtml(labels.amount)}</th>
        <th class="num">${escapeHtml(labels.paid)}</th>
        <th class="num">${escapeHtml(labels.remaining)}</th>
        <th>${escapeHtml(labels.status)}</th>
        <th class="num">${escapeHtml(labels.age)}</th>
      </tr>
    </thead>
    <tbody>${loanRows || `<tr><td colspan="8" class="empty">${escapeHtml(labels.noEntries)}</td></tr>`}</tbody>
    <tfoot>
      <tr>
        <td colspan="3">${escapeHtml(labels.summary)}</td>
        <td class="num">${formatMoney(statement.totalLoaned)}</td>
        <td class="num">${formatMoney(statement.totalRepaid)}</td>
        <td class="num">${formatMoney(statement.outstanding)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>

  <h2>${escapeHtml(labels.paymentsReceived)}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(labels.date)}</th>
        <th>${escapeHtml(labels.ref)}</th>
        <th class="num">${escapeHtml(labels.amount)}</th>
        <th>${escapeHtml(labels.account)}</th>
        <th>${escapeHtml(labels.note)}</th>
      </tr>
    </thead>
    <tbody>${paymentRows}</tbody>
    ${payments.length > 0 ? `<tfoot>
      <tr>
        <td colspan="2">${escapeHtml(labels.totalRepaid)}</td>
        <td class="num paid">${formatMoney(statement.totalRepaid)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>` : ''}
  </table>

  <h2>${escapeHtml(labels.ledger)}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(labels.date)}</th>
        <th>${escapeHtml(labels.ref)}</th>
        <th>${escapeHtml(labels.description)}</th>
        <th class="num">${escapeHtml(labels.debit)}</th>
        <th class="num">${escapeHtml(labels.credit)}</th>
        <th class="num">${escapeHtml(labels.balance)}</th>
      </tr>
    </thead>
    <tbody>${ledgerRows}</tbody>
  </table>

  <div class="total-bar">
    <span class="k">${escapeHtml(labels.totalDue)}</span>
    <span class="v">${formatMoney(statement.outstanding)} ${cur}</span>
  </div>

  <div class="aging">
    <div><div class="label">${escapeHtml(labels.agingCurrent)}</div><div class="v">${formatMoney(statement.aging.current)}</div></div>
    <div><div class="label">${escapeHtml(labels.aging31)}</div><div class="v">${formatMoney(statement.aging.d31)}</div></div>
    <div><div class="label">${escapeHtml(labels.aging61)}</div><div class="v">${formatMoney(statement.aging.d61)}</div></div>
    <div><div class="label">${escapeHtml(labels.aging90)}</div><div class="v">${formatMoney(statement.aging.d90plus)}</div></div>
  </div>

  <footer>
    <span>${escapeHtml(labels.footerNote)}</span>
    <span>${escapeHtml(labels.generatedOn)} ${escapeHtml(formatDateTime(now, lang))}</span>
  </footer>
</div>
</body>
</html>`;
}

/**
 * The compact "statement" layout — a navy header banner, three summary cards
 * (total due / paid / remaining), a percent-paid line, a settlement summary,
 * and the payments log. This mirrors the buyer-facing statement format some
 * buyers already expect (dark banner with a gold subtitle, boxed totals),
 * as an alternative to the fuller ledger-style {@link buildStatementHtml}.
 */
export function buildStatementHtmlCompact(
  statement: BuyerStatement,
  labels: StatementDocLabels,
  options: StatementDocOptions = {},
): string {
  const { businessName = '', lang = 'en', now = Date.now() } = options;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const cur = escapeHtml(statement.currency);
  const payments = statement.entries.filter(e => e.kind === 'payment');
  const percentPaid = statement.totalLoaned > 0
    ? Math.round((statement.totalRepaid / statement.totalLoaned) * 100)
    : 0;
  const percentLine = lang === 'ar'
    ? `٪${percentPaid}  ${labels.percentPaidSuffix}`
    : `${percentPaid}% ${labels.percentPaidSuffix}`;

  const paymentRows = payments.length === 0
    ? `<tr><td colspan="5" class="empty">${escapeHtml(labels.noPayments)}</td></tr>`
    : payments.map((p, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(formatDate(p.ts, lang))}</td>
        <td class="num paid">${formatMoney(p.credit)}</td>
        <td class="desc">${escapeHtml(p.description || labels.payment)}</td>
        <td class="ref">${escapeHtml(p.ref || '—')}</td>
      </tr>`).join('');

  const line = (text: string, name: string, currency: string) => (
    text.replace('{name}', name).replace('{currency}', currency)
  );

  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(labels.documentTitle)} — ${escapeHtml(statement.customerName)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #f4f5f7; color: #14161c;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px; line-height: 1.45;
  }
  .sheet { max-width: 820px; margin: 0 auto; background: #fff; padding: 0 0 30px; }
  .banner { background: #0F2A44; color: #fff; padding: 22px 30px 16px; }
  .banner .title { font-size: 19px; font-weight: 700; }
  .banner .sub { margin-top: 4px; font-size: 10.5px; color: #E8D9A0; }
  .body { padding: 22px 30px 0; }
  .cards { display: flex; gap: 10px; margin-bottom: 10px; }
  .card { flex: 1; background: #F7F8FA; border-radius: 6px; padding: 10px 12px; }
  .card .k { font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: #6B7280; font-weight: 700; }
  .card .v { margin-top: 4px; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; color: #0F2A44; }
  .card.paid .v { color: #157347; }
  .card.due .v { color: #A6332A; }
  .pct { font-size: 10px; color: #6B7280; margin: 4px 0 18px; }
  h2 { font-size: 12px; font-weight: 700; color: #0F2A44; margin: 18px 0 8px; }
  .settlement { background: #fff; border: 1px solid #dfe3ea; border-radius: 6px; overflow: hidden; }
  .settlement .row { display: flex; justify-content: space-between; gap: 16px; padding: 9px 12px; font-size: 10.5px; color: #2B2B2B; }
  .settlement .row + .row { border-top: 1px solid #eceef2; }
  .settlement .row.total { background: #EFF1F4; font-weight: 700; }
  .settlement .row.total .v { color: #A6332A; }
  .settlement .v { font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: #fff;
       text-align: ${dir === 'rtl' ? 'right' : 'left'}; padding: 7px; background: #0F2A44; font-weight: 700; }
  td { padding: 6px 7px; border-bottom: 1px solid #eceef2; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #F1F3F6; }
  th.num, td.num { text-align: ${dir === 'rtl' ? 'left' : 'right'}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.ref { font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 10px; white-space: nowrap; }
  td.desc { color: #454b57; }
  td.paid { color: #157347; font-weight: 700; }
  td.empty { text-align: center; color: #8b91a0; padding: 12px; }
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
      ${escapeHtml(statement.customerName)} &nbsp;·&nbsp; ${escapeHtml(labels.currency)}: ${cur} &nbsp;·&nbsp;
      ${escapeHtml(labels.statementDate)}: ${escapeHtml(formatDate(now, lang))}
    </div>
  </div>

  <div class="body">
    <div class="cards">
      <div class="card">
        <div class="k">${escapeHtml(labels.totalLoaned)}</div>
        <div class="v">${formatMoney(statement.totalLoaned)} ${cur}</div>
      </div>
      <div class="card paid">
        <div class="k">${escapeHtml(labels.totalRepaid)}</div>
        <div class="v">${formatMoney(statement.totalRepaid)} ${cur}</div>
      </div>
      <div class="card due">
        <div class="k">${escapeHtml(labels.outstanding)}</div>
        <div class="v">${formatMoney(statement.outstanding)} ${cur}</div>
      </div>
    </div>
    <div class="pct">${escapeHtml(percentLine)}</div>

    <h2>${escapeHtml(labels.settlementSummary)}</h2>
    <div class="settlement">
      <div class="row">
        <span>${escapeHtml(line(labels.settlementTotalLine, statement.customerName, cur))}</span>
        <span class="v">${formatMoney(statement.totalLoaned)}</span>
      </div>
      <div class="row">
        <span>${escapeHtml(line(labels.settlementPaidLine, statement.customerName, cur))}</span>
        <span class="v">${formatMoney(statement.totalRepaid)}</span>
      </div>
      <div class="row total">
        <span>${escapeHtml(line(labels.settlementRemainingLine, statement.customerName, cur))}</span>
        <span class="v">${formatMoney(statement.outstanding)}</span>
      </div>
    </div>

    <h2>${escapeHtml(labels.paymentsLog)}</h2>
    <div style="font-size: 10px; color: #6B7280; margin-bottom: 4px;">
      ${escapeHtml(statement.customerName)} &nbsp;·&nbsp; ${payments.length} ${escapeHtml(labels.allPayments)}
    </div>
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>${escapeHtml(labels.date)}</th>
          <th class="num">${escapeHtml(labels.amount)} (${cur})</th>
          <th>${escapeHtml(labels.against)}</th>
          <th>${escapeHtml(labels.ref)}</th>
        </tr>
      </thead>
      <tbody>${paymentRows}</tbody>
      ${payments.length > 0 ? `<tfoot>
        <tr>
          <td colspan="2">${escapeHtml(labels.totalRepaid)}</td>
          <td class="num paid">${formatMoney(statement.totalRepaid)}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>` : ''}
    </table>

    <footer>
      <span>${escapeHtml(labels.electronicNote)}</span>
      <span>${escapeHtml(labels.generatedOn)} ${escapeHtml(formatDateTime(now, lang))}</span>
    </footer>
  </div>
</div>
</body>
</html>`;
}

/**
 * A short plain-text version of the statement, for pasting into a chat.
 *
 * Only what the buyer needs to act: what is still open, what has been paid, and
 * the balance. The full history stays in the PDF/spreadsheet.
 */
export function buildStatementText(
  statement: BuyerStatement,
  labels: StatementDocLabels,
  options: StatementDocOptions = {},
): string {
  const { businessName = '', lang = 'en', now = Date.now() } = options;
  const cur = statement.currency;
  const lines: string[] = [];

  lines.push(`${labels.documentTitle} — ${statement.customerName}`);
  if (businessName) lines.push(`${labels.issuedBy}: ${businessName}`);
  lines.push(`${labels.statementDate}: ${formatDate(now, lang)}`);
  lines.push('');

  const open = statement.loans.filter(r => r.remaining > 0);
  if (open.length > 0) {
    lines.push(`${labels.loanedOrders}:`);
    for (const row of open) {
      lines.push(`• ${formatDate(row.loan.ts, lang)} · ${row.ref} — ${formatMoney(row.principal)} ${cur}, ${labels.paid} ${formatMoney(row.repaid)}, ${labels.remaining} ${formatMoney(row.remaining)}`);
    }
    lines.push('');
  }

  lines.push(`${labels.totalLoaned}: ${formatMoney(statement.totalLoaned)} ${cur}`);
  lines.push(`${labels.totalRepaid}: ${formatMoney(statement.totalRepaid)} ${cur}`);
  lines.push(`${labels.totalDue}: ${formatMoney(statement.outstanding)} ${cur}`);
  if (statement.lastPaymentTs != null) {
    lines.push(`${labels.paymentsReceived}: ${statement.entries.filter(e => e.kind === 'payment').length} — ${formatDate(statement.lastPaymentTs, lang)}`);
  }
  return lines.join('\n');
}

/** `statement-mohamed-al-damrawy-QAR-2026-08-17` — safe on every filesystem. */
export function statementFileBase(statement: BuyerStatement, now = Date.now()): string {
  const name = statement.customerName
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'buyer';
  return `statement-${name}-${statement.currency}-${isoDate(now)}`;
}

// ── Browser plumbing ───────────────────────────────────────────────

/** Save text as a file. The BOM is what makes Excel read UTF-8 CSV correctly. */
export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const bom = mime.startsWith('text/csv') ? '\uFEFF' : '';
  const blob = new Blob([bom, text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late — Safari cancels the download if the URL dies too soon.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Open the print dialog on a generated document, so the user can "Save as PDF".
 *
 * A hidden iframe is used rather than `window.open` because pop-up blockers kill
 * the new window on some browsers. Returns false when printing isn't available
 * (in-app webviews), so the caller can fall back to the CSV.
 */
export function printHtmlDocument(html: string): boolean {
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
    // Give the document a tick to lay out before the dialog snapshots it.
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
