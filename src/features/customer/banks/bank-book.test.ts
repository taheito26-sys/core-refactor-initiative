import { describe, expect, it } from 'vitest';
import {
  accountBalances, buildBankMoves, decodePayeeNote, encodePayeeNote, knownPayees, merchantOrdersFromStatements,
  orderLinkId, primaryAccountId, runningBalances, summarizeMoves,
  type BankAccount, type BankLedgerRow, type MerchantOrder,
} from './bank-book';

const T0 = new Date(2026, 10, 1, 9).getTime();
const day = (n: number) => T0 + (n - 1) * 86400000;

const misr: BankAccount = { id: 'misr', name: 'Bank Misr', type: 'bank', currency: 'EGP', status: 'active', created_at: T0 };
const cib: BankAccount = { id: 'cib', name: 'CIB', type: 'bank', currency: 'EGP', status: 'active', created_at: T0 + 1000 };
const wallet: BankAccount = { id: 'w', name: 'Wallet', type: 'mobile_wallet', currency: 'EGP', status: 'active', created_at: T0 - 5000 };

function row(p: Partial<BankLedgerRow> & Pick<BankLedgerRow, 'id' | 'account_id' | 'type' | 'direction' | 'amount'>): BankLedgerRow {
  return { contra_account_id: null, ts: day(2), currency: 'EGP', note: null, linked_entity_id: null, linked_entity_type: null, ...p };
}

describe('payee note encoding', () => {
  it('round-trips the payee and the note', () => {
    const raw = encodePayeeNote('Supplier 1', 'invoice 44');
    expect(decodePayeeNote(raw)).toEqual({ payee: 'Supplier 1', note: 'invoice 44' });
  });
  it('keeps a plain note as a note', () => {
    expect(decodePayeeNote('just a note')).toEqual({ payee: null, note: 'just a note' });
    expect(encodePayeeNote(null, ' x ')).toBe('x');
  });
  it('drops the separator from a payee name', () => {
    expect(decodePayeeNote(encodePayeeNote('A|B', null))).toEqual({ payee: 'A B', note: null });
  });
});

describe('primary account', () => {
  it('prefers the oldest bank account over an older wallet', () => {
    expect(primaryAccountId('EGP', [cib, wallet, misr])).toBe('misr');
  });
  it('has none for a currency with no account', () => {
    expect(primaryAccountId('QAR', [misr])).toBeNull();
  });
});

describe('buildBankMoves', () => {
  const orders: MerchantOrder[] = [
    { key: 'o1', date: day(1), currency: 'EGP', amount: 500000 },
    { key: 'o2', date: day(3), currency: 'EGP', amount: 300000 },
    { key: 'old', date: T0 - 86400000, currency: 'EGP', amount: 999 },
  ];

  it('deposits orders into the primary account from its start date only', () => {
    const moves = buildBankMoves([misr, cib], [], orders);
    expect(moves.map(m => m.orderKey)).toEqual(['o2', 'o1']);
    expect(moves.every(m => m.accountId === 'misr')).toBe(true);
  });

  it('moves a routed order to its chosen account without counting it twice', () => {
    const ledger = [row({ id: 'r', account_id: 'cib', type: 'order_receipt', direction: 'in', amount: 300000, linked_entity_id: orderLinkId('o2'), linked_entity_type: 'customer_order' })];
    const moves = buildBankMoves([misr, cib], ledger, orders);
    const o2 = moves.filter(m => m.orderKey === 'o2');
    expect(o2).toHaveLength(1);
    expect(o2[0].accountId).toBe('cib');
    expect(o2[0].ledgerId).toBe('r');
  });

  it('balances in and out, and keeps a running balance', () => {
    const ledger = [
      row({ id: 'p1', account_id: 'misr', type: 'withdrawal', direction: 'out', amount: 200000, ts: day(2), note: encodePayeeNote('Supplier 1', null) }),
      row({ id: 'p2', account_id: 'misr', type: 'withdrawal', direction: 'out', amount: 100000, ts: day(4), note: encodePayeeNote('Supplier 2', null) }),
    ];
    const moves = buildBankMoves([misr], ledger, orders);
    expect(accountBalances(moves).get('misr')).toBe(500000);
    const run = runningBalances(moves);
    expect(run.get('order:o1')).toBe(500000);
    expect(run.get('p1')).toBe(300000);
    expect(run.get('p2')).toBe(500000);
  });

  it('ignores rows of a removed account', () => {
    const gone = { ...cib, status: 'inactive' };
    const ledger = [row({ id: 'x', account_id: 'cib', type: 'deposit', direction: 'in', amount: 5 })];
    expect(buildBankMoves([misr, gone], ledger, [])).toHaveLength(0);
  });
});

describe('summarizeMoves', () => {
  const ledger = [
    row({ id: 'open', account_id: 'misr', type: 'opening', direction: 'in', amount: 1000000, ts: day(1) }),
    row({ id: 'a', account_id: 'misr', type: 'withdrawal', direction: 'out', amount: 200000, ts: day(2), note: encodePayeeNote('Supplier 1', null) }),
    row({ id: 'b', account_id: 'misr', type: 'withdrawal', direction: 'out', amount: 100000, ts: day(2), note: encodePayeeNote('supplier 1 ', null) }),
    row({ id: 'c', account_id: 'misr', type: 'withdrawal', direction: 'out', amount: 150000, ts: day(5), note: encodePayeeNote('Supplier 2', null) }),
    row({ id: 'mv', account_id: 'misr', type: 'transfer_out', direction: 'out', amount: 50000, ts: day(6), contra_account_id: 'cib' }),
    row({ id: 'mv2', account_id: 'cib', type: 'transfer_in', direction: 'in', amount: 50000, ts: day(6), contra_account_id: 'misr' }),
  ];
  const orders: MerchantOrder[] = [{ key: 'o1', date: day(3), currency: 'EGP', amount: 400000 }];
  const moves = buildBankMoves([misr, cib], ledger, orders);
  const s = summarizeMoves(moves, '2026-11');

  it('counts orders and deposits as income, never the opening balance or own moves', () => {
    expect(s.moneyIn).toBe(400000);
    expect(s.orderCount).toBe(1);
    expect(s.moneyOut).toBe(450000);
    expect(s.net).toBe(-50000);
    expect(s.transferCount).toBe(3);
  });

  it('ranks payees by total and merges spellings of one name', () => {
    expect(s.payees.map(p => [p.name, p.total, p.count])).toEqual([
      ['Supplier 1', 300000, 2],
      ['Supplier 2', 150000, 1],
    ]);
    expect(s.payees[0].share).toBeCloseTo(300000 / 450000);
  });

  it('finds the largest transfer and the busiest day', () => {
    expect(s.largest?.id).toBe('a');
    expect(s.busiestDay?.total).toBe(300000);
  });

  it('lists known payees most used first', () => {
    expect(knownPayees(moves)[0].toLowerCase().trim()).toBe('supplier 1');
  });

  it('is empty for another month', () => {
    expect(summarizeMoves(moves, '2026-10').moneyOut).toBe(0);
  });
});

describe('merchantOrdersFromStatements', () => {
  it('lists each trade once and skips plain sales already shown as loans', () => {
    const st: any = {
      customerName: 'x', currency: 'QAR', totalLoaned: 0, totalRepaid: 0, outstanding: 0, issueDate: '',
      orders: [{ ref: 'L1', tradeId: 't1', date: day(1), amount: 100, paid: 0, remaining: 100, settled: false, note: null }, { ref: 'L2', date: day(2), amount: 50, paid: 0, remaining: 50, settled: false, note: null }],
      payments: [],
      binanceOrders: [{ tradeId: 't1', orderNumber: 'N1', date: day(1), counterparty: null, exchange: 'b', fiat: 'EGP', fiatAmount: 1300, fiatPrice: 13, qarAmount: 100 }],
      saleOrders: [{ tradeId: 't1', orderNumber: 'N1', date: day(1), fiat: 'EGP', fiatAmount: 1300 }, { tradeId: 't9', orderNumber: 'N9', date: day(3), fiat: 'EGP', fiatAmount: 700 }],
    };
    const out = merchantOrdersFromStatements([st, st]);
    expect(out.map(o => [o.key, o.currency, o.amount])).toEqual([['N1', 'EGP', 1300], ['L2', 'QAR', 50], ['N9', 'EGP', 700]]);
  });
});
