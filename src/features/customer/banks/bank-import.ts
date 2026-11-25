// ─── Bank statement import ──────────────────────────────────────────
//
// Loads a bank's transfer history (and its saved beneficiaries) into one of
// the buyer's accounts. Only completed transfers become ledger rows; a
// failed or refunded transfer never left the account, so it is listed as
// skipped and never counted. Every row gets an id derived from its content,
// so importing the same file twice adds nothing the second time.

import { cleanPayeeName, encodePayeeNote, payeeKey } from './bank-book';

export const IMPORT_FORMAT = 'bank-transfers/1';

export interface ImportBeneficiary {
  name: string;
  bank: string | null;
  account: string | null;
}

export interface ImportTransfer {
  payee: string;
  amount: number;
  /** Local wall-clock time as the bank app shows it, YYYY-MM-DDTHH:mm. */
  at: string;
  status: string;
  channel: string | null;
}

export interface BankImportFile {
  bank: string | null;
  currency: string;
  beneficiaries: ImportBeneficiary[];
  transfers: ImportTransfer[];
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The bank's displayed time, read in the viewer's own timezone so it shows back exactly as the bank app showed it. */
export function localTimeToMs(at: string): number {
  const m = LOCAL_TIME.exec(at);
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : NaN;
}

/** Throws a readable error for anything that is not a well-formed import file. */
export function parseBankImport(raw: unknown): BankImportFile {
  const f = raw as Record<string, unknown>;
  if (!f || typeof f !== 'object' || f.format !== IMPORT_FORMAT) throw new Error('Not a bank transfer file');
  const currency = typeof f.currency === 'string' ? f.currency : '';
  if (!currency) throw new Error('The file has no currency');
  const list = (v: unknown) => (Array.isArray(v) ? v : []);

  const beneficiaries: ImportBeneficiary[] = list(f.beneficiaries).map((b: any, i) => {
    const name = cleanPayeeName(String(b?.name ?? ''));
    if (!name) throw new Error(`Beneficiary ${i + 1} has no name`);
    return { name, bank: b?.bank ? String(b.bank) : null, account: b?.account ? String(b.account) : null };
  });

  const transfers: ImportTransfer[] = list(f.transfers).map((t: any, i) => {
    const payee = cleanPayeeName(String(t?.payee ?? ''));
    const amount = Number(t?.amount);
    const at = String(t?.at ?? '');
    if (!payee) throw new Error(`Transfer ${i + 1} has no payee`);
    if (!(amount > 0) || !Number.isFinite(amount)) throw new Error(`Transfer ${i + 1} has an invalid amount`);
    if (Number.isNaN(localTimeToMs(at))) throw new Error(`Transfer ${i + 1} has an invalid time`);
    return { payee, amount, at, status: String(t?.status ?? '').toLowerCase(), channel: t?.channel ? String(t.channel) : null };
  });

  return { bank: typeof f.bank === 'string' ? f.bank : null, currency, beneficiaries, transfers };
}

/** FNV-1a, enough to give each transfer a stable, collision-resistant row id. */
function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function importRowId(accountId: string, t: Pick<ImportTransfer, 'at' | 'amount' | 'payee'>): string {
  return `imp-${hash(`${accountId}|${t.at}|${t.amount}|${payeeKey(t.payee)}`)}`;
}

export interface ImportRow {
  id: string;
  account_id: string;
  ts: number;
  type: 'withdrawal';
  direction: 'out';
  amount: number;
  currency: string;
  note: string | null;
  contra_account_id: null;
  linked_entity_id: null;
  linked_entity_type: null;
}

export interface ImportPlan {
  rows: ImportRow[];
  /** Completed transfers already in the account from an earlier import. */
  alreadyImported: number;
  /** Not completed (failed, refunded, pending): never written. */
  skipped: ImportTransfer[];
  total: number;
  first: string | null;
  last: string | null;
}

export function planImport(file: BankImportFile, accountId: string, accountCurrency: string, existingIds: Set<string>): ImportPlan {
  if (file.currency !== accountCurrency) throw new Error(`The file is in ${file.currency} but the account is in ${accountCurrency}`);
  const rows: ImportRow[] = [];
  const skipped: ImportTransfer[] = [];
  const seen = new Set<string>();
  let alreadyImported = 0;
  for (const t of file.transfers) {
    if (t.status !== 'completed') { skipped.push(t); continue; }
    const id = importRowId(accountId, t);
    if (seen.has(id)) throw new Error(`The file lists the same transfer twice (${t.payee}, ${t.amount}, ${t.at})`);
    seen.add(id);
    if (existingIds.has(id)) { alreadyImported += 1; continue; }
    rows.push({
      id, account_id: accountId, ts: localTimeToMs(t.at), type: 'withdrawal', direction: 'out', amount: t.amount,
      currency: accountCurrency, note: encodePayeeNote(t.payee, null),
      contra_account_id: null, linked_entity_id: null, linked_entity_type: null,
    });
  }
  const completed = file.transfers.filter(t => t.status === 'completed').map(t => t.at).sort();
  return {
    rows,
    alreadyImported,
    skipped,
    total: rows.reduce((s, r) => s + r.amount, 0),
    first: completed[0] ?? null,
    last: completed[completed.length - 1] ?? null,
  };
}

// ─── Beneficiaries, kept on the bank account they were saved in ─────

/*
 * cash_accounts has a free-text notes column and no table for beneficiaries,
 * so the saved list lives there as JSON: {"beneficiaries":[...]}. Anything
 * else already in notes is kept under "text".
 */
export function readBeneficiaries(notes: string | null | undefined): ImportBeneficiary[] {
  if (!notes) return [];
  try {
    const v = JSON.parse(notes);
    return Array.isArray(v?.beneficiaries)
      ? v.beneficiaries.filter((b: any) => b && typeof b.name === 'string' && b.name.trim()).map((b: any) => ({ name: cleanPayeeName(b.name), bank: b.bank ?? null, account: b.account ?? null }))
      : [];
  } catch {
    return [];
  }
}

export function writeBeneficiaries(notes: string | null | undefined, list: ImportBeneficiary[]): string {
  let text: string | undefined;
  if (notes) {
    try {
      const v = JSON.parse(notes);
      text = typeof v?.text === 'string' ? v.text : undefined;
    } catch {
      text = notes;
    }
  }
  return JSON.stringify(text ? { text, beneficiaries: list } : { beneficiaries: list });
}

/** Existing entries win on name; new names are appended in the file's order. */
export function mergeBeneficiaries(current: ImportBeneficiary[], incoming: ImportBeneficiary[]): ImportBeneficiary[] {
  const out = [...current];
  const keys = new Set(current.map(b => payeeKey(b.name)));
  for (const b of incoming) {
    const k = payeeKey(b.name);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(b);
  }
  return out;
}
