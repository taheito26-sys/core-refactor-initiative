import { describe, expect, it } from 'vitest';
import { buildBankMoves, decodePayeeNote, summarizeMoves, type BankLedgerRow } from './bank-book';
import {
  IMPORT_FORMAT, importRowId, localTimeToMs, mergeBeneficiaries, parseBankImport, planImport, readBeneficiaries, writeBeneficiaries,
} from './bank-import';

const file = {
  format: IMPORT_FORMAT,
  bank: 'Banque Misr',
  currency: 'EGP',
  beneficiaries: [{ name: 'Supplier 1', bank: 'Banque Misr', account: '2490001000015451' }, { name: 'School', bank: 'CIB', account: '1' }],
  transfers: [
    { payee: 'Supplier 1', amount: 90590, at: '2026-11-01T15:41', status: 'completed', channel: 'inside_bm' },
    { payee: 'Supplier 1', amount: 90590, at: '2026-10-27T13:50', status: 'completed', channel: 'inside_bm' },
    { payee: 'School', amount: 102000, at: '2026-08-23T20:25', status: 'failed_refunded', channel: 'domestic' },
  ],
};

describe('parseBankImport', () => {
  it('reads a well-formed file', () => {
    const f = parseBankImport(file);
    expect(f.transfers).toHaveLength(3);
    expect(f.beneficiaries.map(b => b.name)).toEqual(['Supplier 1', 'School']);
  });
  it('rejects other files and bad rows', () => {
    expect(() => parseBankImport({})).toThrow();
    expect(() => parseBankImport({ ...file, transfers: [{ payee: 'x', amount: -1, at: '2026-01-01T10:00', status: 'completed' }] })).toThrow(/amount/);
    expect(() => parseBankImport({ ...file, transfers: [{ payee: 'x', amount: 5, at: '2026-02-30T10:00', status: 'completed' }] })).toThrow(/time/);
  });
});

describe('planImport', () => {
  const f = parseBankImport(file);

  it('writes completed transfers only and lists the failed one as skipped', () => {
    const plan = planImport(f, 'misr', 'EGP', new Set());
    expect(plan.rows).toHaveLength(2);
    expect(plan.total).toBe(181180);
    expect(plan.skipped.map(s => s.amount)).toEqual([102000]);
    expect(plan.rows.every(r => r.direction === 'out' && r.type === 'withdrawal')).toBe(true);
    expect(decodePayeeNote(plan.rows[0].note).payee).toBe('Supplier 1');
  });

  it('keeps the time exactly as the bank showed it', () => {
    const plan = planImport(f, 'misr', 'EGP', new Set());
    const d = new Date(plan.rows[0].ts);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 11, 1, 15, 41]);
  });

  it('adds nothing when the same file is imported again', () => {
    const first = planImport(f, 'misr', 'EGP', new Set());
    const again = planImport(f, 'misr', 'EGP', new Set(first.rows.map(r => r.id)));
    expect(again.rows).toHaveLength(0);
    expect(again.alreadyImported).toBe(2);
  });

  it('gives the same transfer a different id in another account', () => {
    const t = f.transfers[0];
    expect(importRowId('a', t)).not.toBe(importRowId('b', t));
    expect(importRowId('a', t)).toBe(importRowId('a', { ...t, payee: ' supplier 1 ' }));
  });

  it('refuses a currency mismatch and a duplicated line', () => {
    expect(() => planImport(f, 'misr', 'QAR', new Set())).toThrow(/currency|EGP/);
    const dup = parseBankImport({ ...file, transfers: [file.transfers[0], file.transfers[0]] });
    expect(() => planImport(dup, 'misr', 'EGP', new Set())).toThrow(/twice/);
  });

  it('feeds the analysis: money out and the top payee', () => {
    const plan = planImport(f, 'misr', 'EGP', new Set());
    const ledger: BankLedgerRow[] = plan.rows.map(r => ({ ...r }));
    const moves = buildBankMoves([{ id: 'misr', name: 'Bank Misr', type: 'bank', currency: 'EGP', status: 'active', created_at: 0 }], ledger, []);
    const s = summarizeMoves(moves, null);
    expect(s.moneyOut).toBe(181180);
    expect(s.payees[0]).toMatchObject({ name: 'Supplier 1', count: 2, total: 181180 });
  });
});

describe('beneficiaries on the account', () => {
  it('round-trips through notes and keeps existing text', () => {
    const notes = writeBeneficiaries('my note', [{ name: 'A', bank: null, account: '1' }]);
    expect(readBeneficiaries(notes)).toEqual([{ name: 'A', bank: null, account: '1' }]);
    expect(JSON.parse(notes).text).toBe('my note');
    expect(readBeneficiaries('plain text')).toEqual([]);
  });
  it('merges without duplicating a name', () => {
    const m = mergeBeneficiaries([{ name: 'A', bank: 'x', account: '1' }], [{ name: ' a ', bank: 'y', account: '2' }, { name: 'B', bank: null, account: null }]);
    expect(m.map(b => [b.name, b.bank])).toEqual([['A', 'x'], ['B', null]]);
  });
  it('rejects impossible local times', () => {
    expect(Number.isNaN(localTimeToMs('2026-13-01T10:00'))).toBe(true);
  });
});
