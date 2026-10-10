import { computeFIFO, getAccountBalance, getLoanRepaid, type CashAccount, type CashLedgerEntry, type CustomerLoan, type TrackerState } from '@/lib/tracker-helpers';
import { personalLoanOutstanding, type PersonalLoan } from '@/lib/trading/personal-loans';

// ─── Net position ───
//
// What the merchant has right now, in QAR, in five lines and nothing else:
//   cash in hand      the hand accounts the merchant chose to count
//   money in banks    the bank accounts the merchant chose to count
//   USDT on exchanges the live balance on Binance and OKX
//   customer loans    what customers still owe on loans recorded in the system
//   personal loans    money lent by hand to people who are not customers
//
// Nothing is typed in as an opening figure and nothing is carried from an
// earlier month, so nothing can be counted twice. USDT coming in or going out
// is never used: only the balance on the exchanges now. Everything else that
// exists (vault and custody accounts, USDT stock, USDT lent to merchants) is
// outside the position.

/** QAR has been pegged to the US dollar at this rate since 2001; used only when there is no USDT price to go by. */
export const USD_QAR_PEG = 3.64;

export type LineKey = 'cash_hand' | 'cash_bank' | 'exchange_usdt' | 'customer_loans' | 'personal_loans';

export const LINE_ORDER: LineKey[] = ['cash_hand', 'cash_bank', 'exchange_usdt', 'customer_loans', 'personal_loans'];

/** One thing a line is made of: an account, an exchange, a customer, a person. */
export interface Detail {
  id: string;
  label: string;
  qar: number;
  /** The amount in its own unit, for display. */
  original?: { amount: number; unit: string };
}

export interface PositionLine {
  key: LineKey;
  qar: number;
  details: Detail[];
}

export interface Rates {
  usdToQar: number;
  /** EGP per 1 USDT; 0 when unknown. */
  egpPerUsdt: number;
  /** QAR per 1 USDT: what USDT is being bought at, used to price USDT and, through it, EGP and USD. */
  usdtRateQAR: number;
}

export interface Position {
  lines: PositionLine[];
  netQAR: number;
  rates: Rates;
  warnings: Array<'usdt_unpriced' | 'egp_unpriced'>;
}

export interface PositionInput {
  accounts: CashAccount[];
  ledger: CashLedgerEntry[];
  /** Ids of the cash and bank accounts the merchant counts. */
  includedAccountIds: ReadonlySet<string>;
  customerLoans: CustomerLoan[];
  deletedLoanIds?: string[];
  customerName: (customerId: string) => string;
  personalLoans: PersonalLoan[];
  /** USDT on Binance and OKX now; null while it is not known. */
  exchange: { binance: number; okx: number } | null;
  batches: TrackerState['batches'];
  trades: TrackerState['trades'];
  usdtTransfers?: TrackerState['usdtTransfers'];
  /** Rates typed by the merchant; the automatic ones are used when empty. */
  usdRateOverride?: number | null;
  egpRateOverride?: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The accounts that can be counted: active hand and bank accounts, in any currency but USDT. */
export function countableAccounts(accounts: CashAccount[]): CashAccount[] {
  return (accounts || []).filter(a => a.status === 'active' && (a.type === 'hand' || a.type === 'bank') && a.currency !== 'USDT');
}

export function computePosition(input: PositionInput): Position {
  const warnings: Position['warnings'] = [];
  const warn = (w: Position['warnings'][number]) => { if (!warnings.includes(w)) warnings.push(w); };

  // ── Rates ──
  const derived = computeFIFO(input.batches || [], input.trades || [], input.usdtTransfers);
  let stockUSDT = 0;
  let stockCost = 0;
  for (const b of derived.batches) {
    const qty = Math.max(0, b.remainingUSDT);
    stockUSDT += qty;
    stockCost += qty * b.buyPriceQAR;
  }
  let usdtRateQAR = stockUSDT > 0 ? stockCost / stockUSDT : 0;
  if (!usdtRateQAR) {
    const latest = [...(input.batches || [])].sort((a, b) => b.ts - a.ts)[0];
    usdtRateQAR = latest?.buyPriceQAR || 0;
  }
  const usdToQar = input.usdRateOverride && input.usdRateOverride > 0 ? input.usdRateOverride : usdtRateQAR || USD_QAR_PEG;
  let egpPerUsdt = input.egpRateOverride && input.egpRateOverride > 0 ? input.egpRateOverride : 0;
  if (!egpPerUsdt) {
    const lastEgpSale = [...(input.trades || [])]
      .filter(t => !t.voided && t.originalFiat === 'EGP' && (t.originalFiatPriceUSDT || 0) > 0)
      .sort((a, b) => b.ts - a.ts)[0];
    egpPerUsdt = lastEgpSale?.originalFiatPriceUSDT || 0;
  }
  /** What an amount of EGP cost, in QAR: the USDT it stands for, priced at the USDT buying price. */
  const egpToQar = (egp: number, ratePerUsdt: number) => (ratePerUsdt > 0 && usdtRateQAR > 0 ? (egp / ratePerUsdt) * usdtRateQAR : 0);
  const toQar = (amount: number, currency: string) => {
    if (currency === 'USD') return amount * usdToQar;
    if (currency === 'EGP') { if (!egpPerUsdt || !usdtRateQAR) warn('egp_unpriced'); return egpToQar(amount, egpPerUsdt); }
    if (currency === 'USDT') { if (!usdtRateQAR) warn('usdt_unpriced'); return amount * usdtRateQAR; }
    return amount;
  };

  const lines: PositionLine[] = LINE_ORDER.map(key => ({ key, qar: 0, details: [] }));
  const line = (key: LineKey) => lines.find(l => l.key === key) as PositionLine;
  const push = (key: LineKey, d: Detail) => { const l = line(key); l.details.push({ ...d, qar: round2(d.qar) }); l.qar = round2(l.qar + d.qar); };

  // ── Cash in hand and money in banks: the accounts the merchant counts ──
  for (const acc of countableAccounts(input.accounts)) {
    if (!input.includedAccountIds.has(acc.id)) continue;
    const balance = round2(getAccountBalance(acc.id, input.ledger || []));
    push(acc.type === 'bank' ? 'cash_bank' : 'cash_hand', {
      id: acc.id, label: acc.name, qar: toQar(balance, acc.currency), original: { amount: balance, unit: acc.currency },
    });
  }

  // ── USDT on the exchanges: the live balance only ──
  if (input.exchange) {
    const entries: Array<[string, string, number]> = [['binance', 'Binance', input.exchange.binance], ['okx', 'OKX', input.exchange.okx]];
    for (const [id, label, usdt] of entries) {
      if (!(usdt > 0)) continue;
      if (!usdtRateQAR) warn('usdt_unpriced');
      push('exchange_usdt', { id, label, qar: usdt * usdtRateQAR, original: { amount: round2(usdt), unit: 'USDT' } });
    }
  }

  // ── Customer loans recorded in the system, still owed now ──
  const deleted = new Set(input.deletedLoanIds || []);
  const tradeById = new Map((input.trades || []).map(t => [t.id, t]));
  const byCustomer = new Map<string, { qar: number; owed: Map<string, number> }>();
  for (const loan of input.customerLoans || []) {
    if (deleted.has(loan.id)) continue;
    const outstanding = Math.max(0, round2(loan.principal - getLoanRepaid(loan)));
    if (!outstanding) continue;
    let qar: number;
    if (loan.currency === 'EGP') {
      // The loan's own sale rate, unless the merchant typed an EGP rate.
      const sale = loan.tradeId ? tradeById.get(loan.tradeId) : undefined;
      const ownRate = sale?.originalFiat === 'EGP' && (sale.originalFiatPriceUSDT || 0) > 0
        ? sale.originalFiatPriceUSDT as number
        : sale && sale.amountUSDT > 0 ? loan.principal / sale.amountUSDT : 0;
      const rate = input.egpRateOverride && input.egpRateOverride > 0 ? input.egpRateOverride : ownRate || egpPerUsdt;
      if (!rate || !usdtRateQAR) warn('egp_unpriced');
      qar = egpToQar(outstanding, rate);
    } else {
      qar = toQar(outstanding, loan.currency);
    }
    const slot = byCustomer.get(loan.customerId) ?? { qar: 0, owed: new Map<string, number>() };
    slot.qar += qar;
    slot.owed.set(loan.currency, round2((slot.owed.get(loan.currency) ?? 0) + outstanding));
    byCustomer.set(loan.customerId, slot);
  }
  for (const [customerId, slot] of byCustomer) {
    const currencies = [...slot.owed.entries()];
    push('customer_loans', {
      id: customerId, label: input.customerName(customerId), qar: slot.qar,
      original: currencies.length === 1 ? { amount: currencies[0][1], unit: currencies[0][0] } : undefined,
    });
  }
  line('customer_loans').details.sort((a, b) => b.qar - a.qar);

  // ── Personal loans still owed now ──
  for (const loan of input.personalLoans || []) {
    const outstanding = personalLoanOutstanding(loan);
    if (!outstanding) continue;
    push('personal_loans', { id: loan.id, label: loan.person, qar: toQar(outstanding, loan.currency), original: { amount: outstanding, unit: loan.currency } });
  }

  const netQAR = round2(lines.reduce((s, l) => s + l.qar, 0));
  return { lines, netQAR, rates: { usdToQar, egpPerUsdt, usdtRateQAR }, warnings };
}

// ─── Days and months ───

/** The Qatar calendar day (UTC+3, no daylight saving) a moment falls on, as YYYY-MM-DD. */
export function qatarDay(ts: number): string {
  return new Date(ts + 3 * 3600_000).toISOString().slice(0, 10);
}

/** One saved day: the position as last saved that day. */
export interface DayRow {
  day: string;
  lines: Partial<Record<LineKey, number>>;
  net: number;
}

/** A position as the row that is saved for it. */
export function toDayRow(position: Pick<Position, 'lines' | 'netQAR'>, day: string): DayRow {
  return { day, lines: Object.fromEntries(position.lines.map(l => [l.key, l.qar])) as DayRow['lines'], net: position.netQAR };
}

/** Whether today's saved row already says what the position says now (to the nearest riyal). */
export function sameDayRow(a: DayRow | undefined, b: DayRow): boolean {
  if (!a) return false;
  if (Math.abs(a.net - b.net) >= 0.5) return false;
  return LINE_ORDER.every(k => Math.abs((a.lines[k] ?? 0) - (b.lines[k] ?? 0)) < 0.5);
}

export interface MonthSummary {
  month: string;
  /** The last saved day before the month, or the first saved day of it when nothing came before. */
  opening: DayRow | null;
  openingIsFirstDay: boolean;
  /** The last saved day of the month (today's live position, for the running month). */
  closing: DayRow | null;
  change: number;
  perLine: Array<{ key: LineKey; opening: number; closing: number; change: number }>;
  /** Saved days inside the month, oldest first, each with its change from the day before. */
  days: Array<DayRow & { change: number | null }>;
}

export const monthOf = (day: string) => day.slice(0, 7);

/**
 * A month's opening and closing from the days that were saved. Nothing is
 * typed or carried over: if no earlier day was saved, the month opens at its
 * first saved day and says so.
 */
export function summariseMonth(rows: DayRow[], month: string): MonthSummary {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const first = `${month}-01`;
  const before = sorted.filter(r => r.day < first).at(-1) ?? null;
  const inMonth = sorted.filter(r => monthOf(r.day) === month);
  const opening = before ?? inMonth[0] ?? null;
  const closing = inMonth.at(-1) ?? null;
  const change = opening && closing ? round2(closing.net - opening.net) : 0;
  const perLine = LINE_ORDER.map(key => {
    const o = opening?.lines[key] ?? 0;
    const c = closing?.lines[key] ?? 0;
    return { key, opening: o, closing: c, change: round2(c - o) };
  });
  let previous: DayRow | null = before;
  const days = inMonth.map(r => {
    const row = { ...r, change: previous ? round2(r.net - previous.net) : null };
    previous = r;
    return row;
  });
  return { month, opening, openingIsFirstDay: !before && !!opening, closing, change, perLine, days };
}

/** Every month from the first saved day through the current one, newest first. */
export function monthsAvailable(rows: DayRow[], today: string): string[] {
  const first = [...rows].map(r => r.day).sort()[0] ?? today;
  const out: string[] = [];
  let [y, m] = [Number(first.slice(0, 4)), Number(first.slice(5, 7))];
  const last = monthOf(today);
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > last) break;
    out.push(key);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out.reverse();
}
