import { describe, it, expect } from 'vitest';
import { buildBuyerStatements } from './loanStatement';
import {
  buildReceivablesCsv, buildStatementCsv, buildStatementHtml, buildStatementText,
  csvCell, escapeHtml, formatMoney, statementFileBase,
} from './loanStatementExport';
import type { StatementDocLabels } from './loanStatementExport';
import type { CashAccount, Customer, CustomerLoan } from '@/lib/tracker-helpers';

const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();
const NOW = at(2026, 7, 17);

/** Identity labels — every field prints its own name, so assertions read plainly. */
const labels = new Proxy({} as StatementDocLabels, {
  get: (_t, key) => String(key),
});

const customers = [{ id: 'cust-a', name: 'Mohamed Al-Damrawy', phone: '+974 5000 1111' }] as Customer[];
const accounts = [{ id: 'acc-1', name: 'QNB Bank' }] as CashAccount[];

function loan(over: Partial<CustomerLoan> & { id: string }): CustomerLoan {
  return {
    ts: at(2026, 7, 1),
    customerId: 'cust-a',
    principal: 1000,
    currency: 'QAR',
    repayments: [],
    status: 'open',
    createdAt: at(2026, 7, 1),
    ...over,
  };
}

const statement = buildBuyerStatements({
  loans: [
    loan({
      id: 'loan-aaa111',
      principal: 56376,
      note: 'Loan from order — 14,836 USDT @ 3.8',
      repayments: [{ id: 'rep-1', ts: at(2026, 7, 12), amount: 50000, accountId: 'acc-1', note: 'bank transfer' }],
    }),
    loan({ id: 'loan-bbb222', ts: at(2026, 7, 8), principal: 37388 }),
  ],
  customers,
  accounts,
  now: NOW,
})[0];

describe('csvCell', () => {
  it('quotes and escapes embedded quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('defuses a cell a spreadsheet would run as a formula', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe('"\'=SUM(A1:A9)"');
    expect(csvCell('+1 974 5000')).toBe('"\'+1 974 5000"');
  });
});

describe('buildStatementCsv', () => {
  const csv = buildStatementCsv(statement, labels, { businessName: 'Qatar P2P', lang: 'en', now: NOW });
  const lines = csv.split('\r\n');

  it('opens with the buyer’s identity and the statement date', () => {
    expect(lines[0]).toBe('"documentTitle"');
    expect(csv).toContain('"billTo","Mohamed Al-Damrawy"');
    expect(csv).toContain('"issuedBy","Qatar P2P"');
    expect(csv).toContain('"currency","QAR"');
  });

  it('writes amounts as raw numbers so the columns can be summed', () => {
    expect(csv).toContain('"totalLoaned","93764.00"');
    expect(csv).toContain('"totalRepaid","50000.00"');
    expect(csv).toContain('"totalDue","43764.00"');
    expect(csv).not.toContain('93,764');
  });

  it('lists every loaned order and every payment', () => {
    expect(csv).toContain('"Loan from order — 14,836 USDT @ 3.8"');
    expect(csv).toContain('"56376.00"');
    expect(csv).toContain('"37388.00"');
    expect(csv).toContain('"QNB Bank"');
    expect(csv).toContain('"bank transfer"');
  });

  it('ends the ledger on the outstanding balance', () => {
    const ledgerStart = lines.findIndex(l => l === '"ledger"');
    const ledger = lines.slice(ledgerStart, lines.indexOf('', ledgerStart));
    expect(ledger[ledger.length - 1]).toContain('43764.00');
  });

  it('breaks the outstanding balance into aging buckets', () => {
    expect(csv).toContain('"agingCurrent","aging31","aging61","aging90"');
    expect(csv).toContain('"43764.00","0.00","0.00","0.00"');
  });

  it('says so plainly when nothing has been paid', () => {
    const unpaid = buildBuyerStatements({ loans: [loan({ id: 'l1' })], customers, now: NOW })[0];
    expect(buildStatementCsv(unpaid, labels, { now: NOW })).toContain('"noPayments"');
  });
});

describe('buildStatementHtml', () => {
  const html = buildStatementHtml(statement, labels, { businessName: 'Qatar P2P', lang: 'en', now: NOW });

  it('is a self-contained printable document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('@page { size: A4');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src="http/i);
  });

  it('carries the buyer, the issuer, and the balance due', () => {
    expect(html).toContain('Mohamed Al-Damrawy');
    expect(html).toContain('Qatar P2P');
    expect(html).toContain('43,764.00 QAR');
  });

  it('switches direction for Arabic', () => {
    const ar = buildStatementHtml(statement, labels, { lang: 'ar', now: NOW });
    expect(ar).toContain('dir="rtl"');
    expect(html).toContain('dir="ltr"');
  });

  it('escapes buyer-supplied text instead of injecting it as markup', () => {
    const nasty = buildBuyerStatements({
      loans: [loan({ id: 'l1', note: '<img src=x onerror="alert(1)">' })],
      customers: [{ id: 'cust-a', name: '<b>Ahmed</b>' }] as Customer[],
      now: NOW,
    })[0];
    const out = buildStatementHtml(nasty, labels, { now: NOW });
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img src=x');
    expect(out).toContain('&lt;b&gt;Ahmed&lt;/b&gt;');
  });
});

describe('buildStatementText', () => {
  it('summarises the open orders and the balance for a chat message', () => {
    const text = buildStatementText(statement, labels, { businessName: 'Qatar P2P', lang: 'en', now: NOW });
    expect(text).toContain('documentTitle — Mohamed Al-Damrawy');
    expect(text).toContain('totalDue: 43,764.00 QAR');
    // Both loans still carry a balance, so both are listed.
    expect(text.match(/^• /gm)).toHaveLength(2);
  });

  it('leaves out orders that are already settled', () => {
    const settled = buildBuyerStatements({
      loans: [loan({ id: 'l1', principal: 500, repayments: [{ id: 'r', ts: at(2026, 7, 2), amount: 500 }] })],
      customers,
      now: NOW,
    })[0];
    expect(buildStatementText(settled, labels, { now: NOW })).not.toContain('• ');
  });
});

describe('buildReceivablesCsv', () => {
  it('lists one row per buyer, then one row per loaned order', () => {
    const csv = buildReceivablesCsv([statement], labels, { lang: 'en', now: NOW });
    // The phone keeps its formula guard — a leading "+" would otherwise be a formula.
    expect(csv).toContain(`"Mohamed Al-Damrawy","'+974 5000 1111","QAR","2","93764.00","50000.00","43764.00","16"`);
    expect(csv.match(/Mohamed Al-Damrawy/g)).toHaveLength(3); // summary row + one per order
  });
});

describe('statementFileBase', () => {
  it('slugifies the buyer name and stamps the date', () => {
    expect(statementFileBase(statement, NOW)).toBe('statement-mohamed-al-damrawy-QAR-2026-08-17');
  });
});

describe('formatMoney / escapeHtml', () => {
  it('formats money with two decimals and thousands separators', () => {
    expect(formatMoney(56376)).toBe('56,376.00');
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(Number.NaN)).toBe('0.00');
  });

  it('escapes every html-significant character', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});
