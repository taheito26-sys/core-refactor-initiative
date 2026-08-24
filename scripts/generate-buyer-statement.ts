/**
 * Generate a buyer's loan statement as a real PDF and a real XLSX, straight
 * from the same tracker data and the same rendering code the app itself
 * uses for the on-screen statement (Cash Management → loans → statement,
 * and the "Open statement" modal). Nothing here re-types numbers or
 * re-implements the layout — it calls buildBuyerStatements() for the data
 * and buildStatementHtml() for the document, exactly as the app does, then
 * pipes that HTML through headless Chromium for the PDF, and separately
 * mirrors the same statement object into an XLSX with live SUM formulas.
 *
 * Input: a tracker state JSON export — Settings → Vault → "Export JSON"
 * in the app produces exactly this file (a raw TrackerState object), so
 * this always runs against real data the merchant already has, never a
 * hand-typed or screenshotted approximation.
 *
 * Usage:
 *   npx vite-node scripts/generate-buyer-statement.ts \
 *     --snapshot ./p2p-tracker-2026-08-20.json \
 *     --customer "Mohamed Al-Damrawy" \
 *     [--lang en|ar] [--business "Your Business Name"] [--out-dir ./out]
 *
 * Run `--list` instead of --customer to print every buyer name found in
 * the snapshot (useful when the exact spelling on file is unknown).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import {
  normalizeImportedTrackerState,
} from '@/lib/tracker-backup';
import { buildBuyerStatements, type BuyerStatement } from '@/features/stock/utils/loanStatement';
import { buildStatementHtml, formatMoney } from '@/features/stock/utils/loanStatementExport';
import { statementLabels } from '@/features/stock/utils/statementLabels';
import { getT, type Lang } from '@/lib/i18n';
import type { TrackerState } from '@/lib/tracker-helpers';

interface Args {
  snapshot?: string;
  customer?: string;
  lang: Lang;
  business?: string;
  outDir: string;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { lang: 'en', outDir: './statement-output', list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--snapshot') args.snapshot = argv[++i];
    else if (a === '--customer') args.customer = argv[++i];
    else if (a === '--lang') args.lang = argv[++i] === 'ar' ? 'ar' : 'en';
    else if (a === '--business') args.business = argv[++i];
    else if (a === '--out-dir') args.outDir = argv[++i];
    else if (a === '--list') args.list = true;
  }
  return args;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'buyer';
}

async function buildXlsx(statement: BuyerStatement, lang: Lang, outPath: string) {
  const t = getT(lang);
  const labels = statementLabels(t);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'core-refactor-initiative';
  wb.created = new Date();

  // ── Summary ──────────────────────────────────────────────────────
  const summary = wb.addWorksheet(labels.summary || 'Summary');
  summary.columns = [{ width: 34 }, { width: 22 }];
  const addSummaryRow = (label: string, value: string | number, numFmt?: string) => {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (numFmt) row.getCell(2).numFmt = numFmt;
  };
  summary.addRow([labels.documentTitle || 'Statement of Account']).font = { bold: true, size: 14 };
  summary.addRow([]);
  addSummaryRow(labels.billTo || 'Buyer', statement.customerName);
  if (statement.phone) addSummaryRow(labels.phone || 'Phone', statement.phone);
  addSummaryRow(labels.currency || 'Currency', statement.currency);
  addSummaryRow(labels.loanedOrders || 'Orders', statement.loans.length);
  addSummaryRow('Open orders', statement.openCount);
  addSummaryRow('Closed orders', statement.settledCount);
  // Formula-driven so the totals recompute if the Loaned Orders / Payments
  // Received sheets are edited later — never a hand-typed number.
  const loanedRowCount = statement.loans.length;
  const paymentRowCount = statement.entries.filter(e => e.kind === 'payment').length;
  const loanedSumRow = 4; // header(1) + data rows start at row 2, sum row after them
  addSummaryRow(
    labels.totalLoaned || 'Total loaned',
    { formula: `SUM('${labels.loanedOrders || 'Loaned Orders'}'!D2:D${1 + Math.max(loanedRowCount, 1)})` },
    '#,##0.00',
  );
  addSummaryRow(
    labels.totalRepaid || 'Total repaid',
    { formula: `SUM('${labels.paymentsReceived || 'Payments Received'}'!C2:C${1 + Math.max(paymentRowCount, 1)})` },
    '#,##0.00',
  );
  const totalLoanedCell = `B${summary.rowCount - 1}`;
  const totalRepaidCell = `B${summary.rowCount}`;
  addSummaryRow(labels.outstanding || 'Outstanding', { formula: `${totalLoanedCell}-${totalRepaidCell}` }, '#,##0.00');
  const outstandingCell = `B${summary.rowCount}`;
  addSummaryRow(
    'Repayment %',
    { formula: `IF(${totalLoanedCell}=0,0,${totalRepaidCell}/${totalLoanedCell})` },
    '0.0%',
  );
  addSummaryRow('Last payment', statement.lastPaymentTs ? new Date(statement.lastPaymentTs).toISOString().slice(0, 10) : '—');
  void loanedSumRow;
  void outstandingCell;

  // ── Loaned Orders ────────────────────────────────────────────────
  const loanSheet = wb.addWorksheet(labels.loanedOrders || 'Loaned Orders');
  loanSheet.columns = [
    { header: labels.ref || 'Ref', key: 'ref', width: 14 },
    { header: labels.date || 'Date', key: 'date', width: 14 },
    { header: labels.description || 'Description', key: 'description', width: 34 },
    { header: labels.amount || 'Amount', key: 'amount', width: 14 },
    { header: labels.paid || 'Paid', key: 'paid', width: 14 },
    { header: labels.remaining || 'Remaining', key: 'remaining', width: 14 },
    { header: labels.status || 'Status', key: 'status', width: 14 },
    { header: labels.age || 'Age (days)', key: 'age', width: 12 },
  ];
  loanSheet.getRow(1).font = { bold: true };
  for (const row of statement.loans) {
    loanSheet.addRow({
      ref: row.ref,
      date: new Date(row.loan.ts).toISOString().slice(0, 10),
      description: row.loan.note || '—',
      amount: row.principal,
      paid: row.repaid,
      remaining: row.remaining,
      status: row.settled ? (labels.statusSettled || 'Closed') : `${labels.statusOpen || 'Open'} · ${row.ageDays}d`,
      age: row.settled ? '' : row.ageDays,
    });
  }
  for (const col of ['D', 'E', 'F']) loanSheet.getColumn(col).numFmt = '#,##0.00';
  const loanLastDataRow = Math.max(1 + loanedRowCount, 2);
  const loanTotalsRow = loanSheet.addRow({
    ref: '', date: '', description: labels.summary || 'Totals',
    amount: { formula: `SUM(D2:D${loanLastDataRow})` },
    paid: { formula: `SUM(E2:E${loanLastDataRow})` },
    remaining: { formula: `SUM(F2:F${loanLastDataRow})` },
  });
  loanTotalsRow.font = { bold: true };
  for (const col of ['D', 'E', 'F']) loanTotalsRow.getCell(col).numFmt = '#,##0.00';

  // ── Payments Received ────────────────────────────────────────────
  const payments = statement.entries.filter(e => e.kind === 'payment');
  const paySheet = wb.addWorksheet(labels.paymentsReceived || 'Payments Received');
  paySheet.columns = [
    { header: labels.date || 'Date', key: 'date', width: 18 },
    { header: labels.ref || 'Ref', key: 'ref', width: 24 },
    { header: labels.amount || 'Amount', key: 'amount', width: 14 },
    { header: labels.account || 'Account', key: 'account', width: 18 },
    { header: labels.note || 'Note', key: 'note', width: 30 },
  ];
  paySheet.getRow(1).font = { bold: true };
  for (const p of payments) {
    paySheet.addRow({
      date: new Date(p.ts).toISOString().slice(0, 16).replace('T', ' '),
      ref: p.ref,
      amount: p.credit,
      account: p.accountName || '—',
      note: p.description || '—',
    });
  }
  paySheet.getColumn('C').numFmt = '#,##0.00';
  const payLastDataRow = Math.max(1 + paymentRowCount, 2);
  const payTotalsRow = paySheet.addRow({
    date: '', ref: labels.summary || 'Total',
    amount: { formula: `SUM(C2:C${payLastDataRow})` },
  });
  payTotalsRow.font = { bold: true };
  payTotalsRow.getCell('C').numFmt = '#,##0.00';

  await wb.xlsx.writeFile(outPath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.snapshot) {
    console.error('Missing --snapshot <path-to-tracker-export.json>.\n'
      + 'Export it from the app: Settings → Vault → "Export JSON" — that file is a raw TrackerState and is exactly what this script reads.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(path.resolve(args.snapshot), 'utf8'));
  const state = normalizeImportedTrackerState(raw) as TrackerState;
  const customers = state.customers || [];
  const loans = state.customerLoans || [];
  const accounts = state.cashAccounts || [];
  const trades = state.trades || [];

  const statements = buildBuyerStatements({ loans, customers, trades, accounts });

  if (args.list || !args.customer) {
    console.log('Buyers found in this snapshot:');
    for (const s of statements) console.log(`  - ${s.customerName} (${s.currency})`);
    if (!args.customer) process.exit(args.list ? 0 : 1);
  }

  const needle = args.customer!.trim().toLowerCase();
  const matches = statements.filter(s => s.customerName.trim().toLowerCase().includes(needle));
  if (matches.length === 0) {
    console.error(`No buyer matching "${args.customer}" found. Run with --list to see available names.`);
    process.exit(1);
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  try {
    for (const statement of matches) {
      const t = getT(args.lang);
      const labels = statementLabels(t);
      const html = buildStatementHtml(statement, labels, { businessName: args.business, lang: args.lang });

      const base = `${slugify(statement.customerName)}-${statement.currency}`;
      const pdfPath = path.join(args.outDir, `${base}.pdf`);
      const xlsxPath = path.join(args.outDir, `${base}.xlsx`);

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
      await page.close();

      await buildXlsx(statement, args.lang, xlsxPath);

      console.log(`\n${statement.customerName} — ${statement.currency}`);
      console.log(`  Orders: ${statement.loans.length} (${statement.openCount} open, ${statement.settledCount} closed)`);
      console.log(`  Total loaned:  ${formatMoney(statement.totalLoaned)}`);
      console.log(`  Total repaid:  ${formatMoney(statement.totalRepaid)}`);
      console.log(`  Outstanding:   ${formatMoney(statement.outstanding)}`);
      console.log(`  Repayment %:   ${statement.totalLoaned > 0 ? ((statement.totalRepaid / statement.totalLoaned) * 100).toFixed(1) : '0.0'}%`);
      console.log(`  Last payment:  ${statement.lastPaymentTs ? new Date(statement.lastPaymentTs).toISOString().slice(0, 10) : '—'}`);
      console.log(`  PDF:  ${pdfPath}`);
      console.log(`  XLSX: ${xlsxPath}`);
      console.log('  Compare these totals against the buyer\'s live statement in Cash Management before sending.');
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
