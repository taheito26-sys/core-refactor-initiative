import {
  computeFIFO, getAccountBalance, getLoanRepaid,
  type CashCurrency, type CustomerLoan, type TrackerState,
} from '../tracker-helpers';
import { personalLoanOutstanding, type PersonalLoan } from './personal-loans';
import { expenseCategoryOf, isExpenseCandidate, type ExpenseGroup } from './expense-categories';

// ─── Net position ───
//
// The position is five things and nothing else, in QAR:
//   - cash in hand (hand accounts),
//   - money in banks (bank accounts),
//   - USDT available on the exchanges (Binance + OKX): the live balance only,
//     never rebuilt from USDT coming in or going out,
//   - loaned orders (customer loans still owed),
//   - personal loans (money lent by hand to people who are not customers).
//
// Vault and custody accounts, USDT stock, USDT lent to or borrowed from merchants
// and any other figure are not part of it. Other currencies are brought to QAR
// by what they cost in USDT: USD is worth the average price USDT is being
// bought at (the stock's weighted average cost, only used as a price), and can
// be overridden; an EGP loan is worth the USDT it cost, at the EGP rate of the
// sale that created it. The position is rebuilt from dated records, so a later
// edit to an old record moves an old month; a frozen month-end snapshot is
// what keeps history stable.

/** QAR has been pegged to the US dollar at this rate since 2001; used only when there is no USDT price to go by. */
export const USD_QAR_PEG = 3.64;

export type NetPositionLineKey =
  | 'cash_hand'
  /** USDT sitting on Binance and OKX. */
  | 'exchange_usdt'
  | 'cash_bank'
  | 'cash_vault'
  | 'cash_custody'
  | 'usdt_in_accounts'
  | 'stock'
  | 'customer_loans'
  /** Money lent by hand to people who are not customers. */
  | 'personal_loans'
  | 'merchant_lent'
  | 'merchant_borrowed'
  /** No longer part of the position; kept so positions saved earlier still load. */
  | 'manual_other';

export interface NetPositionLine {
  key: NetPositionLineKey;
  side: 'asset' | 'liability';
  /** Always a positive amount; `side` says whether it adds to or takes from the net. */
  amountQAR: number;
}

/** One thing that makes up a line: an account, a merchant, a person. */
export interface NetPositionDetail {
  label: string;
  /** Always positive; the line's side says whether it is owned or owed. */
  amountQAR: number;
  /** The amount in its own unit, for display (a merchant's USDT, an account's currency). */
  original?: { amount: number; unit: string };
}

export interface NetPosition {
  /** The moment the position is measured at, inclusive. */
  asOf: number;
  lines: NetPositionLine[];
  /** What each line is made of, so a figure can be traced back to its accounts, merchants and people. */
  details?: Partial<Record<NetPositionLineKey, NetPositionDetail[]>>;
  assetsQAR: number;
  liabilitiesQAR: number;
  netQAR: number;
  /** USDT held in stock at that moment; used only to price USDT. */
  stockUSDT: number;
  /** QAR per USDT used to value USDT held outside stock layers. */
  usdtRateQAR: number;
  /** QAR per 1 USD used: the override, else the average USDT buying price. */
  usdToQar: number;
  /** EGP per 1 USDT used for EGP cash and for EGP loans with no sale rate of their own; 0 when unknown. */
  egpPerUsdt: number;
  warnings: Array<'usdt_unpriced' | 'egp_unpriced'>;
}

/**
 * USDT on the exchanges right now. This is the only USDT figure the position
 * uses: movements in or out are never counted, so an earlier moment has no
 * exchange figure unless the merchant typed one in or the month was frozen.
 */
export interface ExchangeUsdtInput {
  nowUSDT: number;
  byExchange?: { binance: number; okx: number };
}

export interface NetPositionOptions {
  /** USDT held on Binance and OKX, as of now. */
  exchangeUsdt?: ExchangeUsdtInput;
  /** The moment "now" is, for deciding whether the live exchange balance applies. Defaults to the clock. */
  now?: number;
  /** Loans to friends and other non-customers, entered by hand. */
  personalLoans?: PersonalLoan[];
  /** QAR per 1 USD. Defaults to the average USDT buying price (WACOP). */
  usdToQar?: number;
  /** EGP per 1 USDT. Overrides every EGP conversion; by default each EGP loan uses the rate of its own sale. */
  egpPerUsdt?: number;
  /** QAR per USDT for USDT held in cash accounts or lent / borrowed; defaults to the stock's average cost. */
  usdtRateQAR?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeNetPosition(
  state: Pick<TrackerState, 'cashAccounts' | 'cashLedger' | 'batches' | 'trades' | 'customerLoans' | 'deletedLoanIds' | 'usdtTransfers'>,
  asOf: number,
  options: NetPositionOptions = {},
): NetPosition {
  const warnings: NetPosition['warnings'] = [];
  const sums = new Map<string, { side: 'asset' | 'liability'; amount: number }>();
  const details: NonNullable<NetPosition['details']> = {};
  const add = (key: NetPositionLineKey, side: 'asset' | 'liability', amount: number, detail?: NetPositionDetail) => {
    const slot = sums.get(key) ?? { side, amount: 0 };
    slot.amount += amount;
    sums.set(key, slot);
    if (detail && detail.amountQAR > 0.004) (details[key] ??= []).push({ ...detail, amountQAR: round2(detail.amountQAR) });
  };

  // ── Stock, at FIFO cost, as the books stood at asOf ──
  const batches = (state.batches || []).filter(b => b.ts <= asOf);
  const trades = (state.trades || []).filter(t => t.ts <= asOf);
  const transfers = (state.usdtTransfers || []).filter(t => t.ts <= asOf);
  const derived = computeFIFO(batches, trades, transfers);
  let stockUSDT = 0;
  let stockCost = 0;
  for (const b of derived.batches) {
    const qty = Math.max(0, b.remainingUSDT);
    stockUSDT += qty;
    stockCost += qty * b.buyPriceQAR;
  }
  let usdtRateQAR = options.usdtRateQAR && options.usdtRateQAR > 0 ? options.usdtRateQAR : 0;
  if (!usdtRateQAR && stockUSDT > 0) usdtRateQAR = stockCost / stockUSDT;
  if (!usdtRateQAR) {
    const latest = [...batches].sort((a, b) => b.ts - a.ts)[0];
    usdtRateQAR = latest?.buyPriceQAR || 0;
  }
  const usdToQar = options.usdToQar && options.usdToQar > 0 ? options.usdToQar : usdtRateQAR || USD_QAR_PEG;

  // EGP per USDT: the override, else the most recent EGP sale before asOf.
  let egpPerUsdt = options.egpPerUsdt && options.egpPerUsdt > 0 ? options.egpPerUsdt : 0;
  if (!egpPerUsdt) {
    const lastEgpSale = [...trades]
      .filter(t => t.originalFiat === 'EGP' && (t.originalFiatPriceUSDT || 0) > 0)
      .sort((a, b) => b.ts - a.ts)[0];
    egpPerUsdt = lastEgpSale?.originalFiatPriceUSDT || 0;
  }
  /** What an amount of EGP cost, in QAR: the USDT it stands for, priced at the USDT buying price. */
  const egpToQar = (egp: number, ratePerUsdt: number) => (ratePerUsdt > 0 ? (egp / ratePerUsdt) * usdtRateQAR : 0);

  // ── Cash in hand, from the ledger up to asOf ──
  const ledger = (state.cashLedger || []).filter(e => e.ts <= asOf);
  for (const acc of state.cashAccounts || []) {
    // Closed accounts are not counted (same rule as the dashboard). Hand accounts are cash in hand, bank accounts are money in banks.
    if (acc.status !== 'active' || (acc.type !== 'hand' && acc.type !== 'bank') || acc.currency === 'USDT') continue;
    const cashKey: NetPositionLineKey = acc.type === 'bank' ? 'cash_bank' : 'cash_hand';
    const balance = getAccountBalance(acc.id, ledger);
    if (!balance) continue;
    if (acc.currency === 'EGP' && !egpPerUsdt && !warnings.includes('egp_unpriced')) warnings.push('egp_unpriced');
    const qar = acc.currency === 'USD' ? balance * usdToQar : acc.currency === 'EGP' ? egpToQar(balance, egpPerUsdt) : balance;
    // An overdrawn account takes away from the line rather than forming a line of its own.
    add(cashKey, 'asset', qar, {
      label: qar < 0 ? `${acc.name} (overdrawn)` : acc.name, amountQAR: Math.abs(qar), original: { amount: balance, unit: acc.currency },
    });
  }

  // ── USDT available on the exchanges ──
  const exchange = options.exchangeUsdt;
  if (exchange) {
    // Only the live balance counts. Earlier than now there is no exchange figure: USDT in and out is never
    // used to work one back, so a past moment shows what the merchant typed or what was frozen.
    const isNow = asOf >= (options.now ?? Date.now()) - 60_000;
    const usdt = isNow ? Math.max(0, exchange.nowUSDT) : 0;
    if (usdt > 0 && !usdtRateQAR && !warnings.includes('usdt_unpriced')) warnings.push('usdt_unpriced');
    if (usdt > 0) {
      add('exchange_usdt', 'asset', usdt * usdtRateQAR, {
        label: 'Binance + OKX', amountQAR: usdt * usdtRateQAR, original: { amount: usdt, unit: 'USDT' },
      });
    }
  }

  // ── Customer loans still owed at asOf ──
  const deleted = new Set(state.deletedLoanIds || []);
  for (const loan of (state.customerLoans || []) as CustomerLoan[]) {
    if (deleted.has(loan.id) || loan.ts > asOf) continue;
    const repaid = getLoanRepaid({ ...loan, repayments: (loan.repayments || []).filter(r => r.ts <= asOf) });
    const outstanding = Math.max(0, loan.principal - repaid);
    if (!outstanding) continue;
    let qar: number;
    if (loan.currency === 'EGP') {
      // The loan's own sale rate, unless the merchant overrode the EGP rate.
      const sale = loan.tradeId ? trades.find(t => t.id === loan.tradeId) : undefined;
      const ownRate = sale?.originalFiat === 'EGP' && (sale.originalFiatPriceUSDT || 0) > 0
        ? sale.originalFiatPriceUSDT as number
        : sale && sale.amountUSDT > 0 ? loan.principal / sale.amountUSDT : 0;
      const rate = options.egpPerUsdt && options.egpPerUsdt > 0 ? options.egpPerUsdt : ownRate || egpPerUsdt;
      if (!rate && !warnings.includes('egp_unpriced')) warnings.push('egp_unpriced');
      qar = egpToQar(outstanding, rate);
    } else {
      qar = loan.currency === 'USD' ? outstanding * usdToQar : loan.currency === 'USDT' ? outstanding * usdtRateQAR : outstanding;
    }
    add('customer_loans', 'asset', qar);
  }

  // ── Loans to friends and other non-customers ──
  for (const loan of options.personalLoans || []) {
    const outstanding = personalLoanOutstanding(loan, asOf);
    if (!outstanding) continue;
    if (loan.currency === 'EGP' && !egpPerUsdt && !warnings.includes('egp_unpriced')) warnings.push('egp_unpriced');
    const qar = loan.currency === 'USD' ? outstanding * usdToQar
      : loan.currency === 'USDT' ? outstanding * usdtRateQAR
      : loan.currency === 'EGP' ? egpToQar(outstanding, egpPerUsdt)
      : outstanding;
    add('personal_loans', 'asset', qar, { label: loan.person, amountQAR: qar, original: { amount: outstanding, unit: loan.currency } });
  }

  const lines: NetPositionLine[] = [...sums.entries()]
    .map(([key, v]) => {
      const amount = round2(v.amount);
      const side = amount >= 0 ? v.side : v.side === 'asset' ? 'liability' : 'asset';
      return { key: key as NetPositionLineKey, side: side as 'asset' | 'liability', amountQAR: Math.abs(amount) };
    })
    .filter(l => l.amountQAR !== 0);
  const assetsQAR = round2(lines.filter(l => l.side === 'asset').reduce((s, l) => s + l.amountQAR, 0));
  const liabilitiesQAR = round2(lines.filter(l => l.side === 'liability').reduce((s, l) => s + l.amountQAR, 0));
  return {
    asOf, lines, details, assetsQAR, liabilitiesQAR, netQAR: round2(assetsQAR - liabilitiesQAR),
    stockUSDT: Math.round(stockUSDT * 1e8) / 1e8, usdtRateQAR, usdToQar, egpPerUsdt, warnings,
  };
}

// ─── Months ───

export interface MonthPosition {
  /** YYYY-MM. */
  key: string;
  start: number;
  /** The last millisecond of the month, or now for the month still running. */
  end: number;
  open: boolean;
  opening: NetPosition;
  closing: NetPosition;
  /** Net revenue of the trades dated inside the month, from the FIFO books. */
  netRevenueQAR: number;
  changeQAR: number;
  /**
   * What the revenue does not explain: expenses, personal spending, revaluation,
   * adjustments. Zero means the month's change is all trading profit.
   */
  unexplainedQAR: number;
}

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthStart(year: number, month0: number): number {
  return new Date(year, month0, 1).getTime();
}

/** Opening and closing net position of one month, with the revenue it earned. */
export function computeMonthPosition(
  state: TrackerState,
  year: number,
  month0: number,
  options: NetPositionOptions = {},
  now = Date.now(),
): MonthPosition {
  options = { ...options, now };
  const start = monthStart(year, month0);
  const nextStart = monthStart(year, month0 + 1);
  const open = now < nextStart;
  const end = open ? now : nextStart - 1;
  const opening = computeNetPosition(state, start - 1, options);
  const closing = computeNetPosition(state, end, options);

  const derived = computeFIFO(state.batches || [], state.trades || [], state.usdtTransfers);
  let netRevenueQAR = 0;
  for (const t of state.trades || []) {
    if (t.voided || t.ts < start || t.ts >= nextStart) continue;
    const calc = derived.tradeCalc.get(t.id);
    if (calc?.ok) netRevenueQAR += calc.netQAR;
  }
  netRevenueQAR = round2(netRevenueQAR);
  const changeQAR = round2(closing.netQAR - opening.netQAR);
  return {
    key: `${year}-${String(month0 + 1).padStart(2, '0')}`, start, end, open, opening, closing,
    netRevenueQAR, changeQAR, unexplainedQAR: round2(changeQAR - netRevenueQAR),
  };
}

/** Every month from `from` (YYYY-MM) through the current one, oldest first. */
export function computeMonthlyPositions(
  state: TrackerState,
  from: string,
  options: NetPositionOptions = {},
  now = Date.now(),
): MonthPosition[] {
  const m = /^(\d{4})-(\d{2})$/.exec(from);
  if (!m) return [];
  const out: MonthPosition[] = [];
  let year = Number(m[1]);
  let month0 = Number(m[2]) - 1;
  const last = monthKey(now);
  for (let guard = 0; guard < 240; guard++) {
    const key = `${year}-${String(month0 + 1).padStart(2, '0')}`;
    if (key > last) break;
    out.push(computeMonthPosition(state, year, month0, options, now));
    month0++;
    if (month0 > 11) { month0 = 0; year++; }
  }
  return out;
}

// ─── What moved in the month ───
//
// The position is four lines, so how it changed is simply how each line
// moved. Spending recorded in the month is shown beside it for reference: it
// is not an equation, because most spending (and most revenue) never touches
// those four lines directly.

export interface BridgeCategoryTotal {
  key: string;
  amountQAR: number;
}

export interface MonthBridge {
  openingQAR: number;
  closingQAR: number;
  /** Net revenue of the month, for reference. */
  netRevenueQAR: number;
  /** Business expenses by category, largest first. */
  business: BridgeCategoryTotal[];
  businessTotalQAR: number;
  /** Owner draws and personal spending, kept apart from the business. */
  personal: BridgeCategoryTotal[];
  personalTotalQAR: number;
  /** Withdrawals nobody has categorised yet. */
  uncategorisedQAR: number;
  uncategorisedCount: number;
  /** Changes to earlier, already-closed months since they were frozen. Zero until a month is chained to a frozen one. */
  priorCorrectionsQAR?: number;
  /** Figures saved by earlier versions of the bridge; no longer shown. */
  depositsQAR?: number;
  adjustmentsInQAR?: number;
  usdtMovementQAR?: number;
  otherQAR?: number;
}

/** How each line of the position moved over the month (signed: an asset that grew is positive). */
export function lineChangesOf(month: Pick<MonthPosition, 'opening' | 'closing'>): Array<{ key: NetPositionLineKey; changeQAR: number }> {
  const keys = new Set<NetPositionLineKey>([...month.opening.lines.map(l => l.key), ...month.closing.lines.map(l => l.key)]);
  const value = (p: NetPosition, key: NetPositionLineKey) => {
    const line = p.lines.find(l => l.key === key);
    return line ? signedAmount(line) : 0;
  };
  return [...keys]
    .map(key => ({ key, changeQAR: round2(value(month.closing, key) - value(month.opening, key)) }))
    .filter(c => c.changeQAR !== 0);
}

/** A cash amount in QAR, using the conversion rates a position was valued with. */
export function amountToQar(
  rates: Pick<NetPosition, 'usdToQar' | 'egpPerUsdt' | 'usdtRateQAR'>,
  currency: CashCurrency,
  amount: number,
): number {
  if (currency === 'USD') return amount * rates.usdToQar;
  if (currency === 'USDT') return amount * rates.usdtRateQAR;
  if (currency === 'EGP') return rates.egpPerUsdt > 0 ? (amount / rates.egpPerUsdt) * rates.usdtRateQAR : 0;
  return amount;
}

/**
 * The spending recorded in a month, by category, with business spending and
 * the owner's personal money totalled separately, next to the month's revenue.
 */
export function computeMonthBridge(
  state: Pick<TrackerState, 'cashLedger'>,
  month: MonthPosition,
  /**
   * Ledger entries that belong to a loan (given out or repaid). The cloud
   * stores them as plain withdrawals and deposits, so without this a loan
   * would read as spending after a reload.
   */
  loanLedgerEntryIds: ReadonlySet<string> = new Set(),
): MonthBridge {
  const rates = month.closing;
  const business = new Map<string, number>();
  const personal = new Map<string, number>();
  let uncategorisedQAR = 0;
  let uncategorisedCount = 0;

  for (const e of state.cashLedger || []) {
    if (e.ts < month.start || e.ts > month.end || loanLedgerEntryIds.has(e.id) || !isExpenseCandidate(e)) continue;
    const qar = amountToQar(rates, e.currency, e.amount);
    const cat = expenseCategoryOf(e.expenseCategory);
    if (!cat) { uncategorisedQAR += qar; uncategorisedCount++; continue; }
    const bucket = cat.group === 'personal' ? personal : business;
    bucket.set(cat.key, (bucket.get(cat.key) ?? 0) + qar);
  }

  const toList = (m: Map<string, number>): BridgeCategoryTotal[] =>
    [...m.entries()].map(([key, v]) => ({ key, amountQAR: round2(v) })).sort((a, b) => b.amountQAR - a.amountQAR);
  const sum = (list: BridgeCategoryTotal[]) => round2(list.reduce((s, c) => s + c.amountQAR, 0));
  const businessList = toList(business);
  const personalList = toList(personal);
  return {
    openingQAR: month.opening.netQAR,
    closingQAR: month.closing.netQAR,
    netRevenueQAR: month.netRevenueQAR,
    business: businessList, businessTotalQAR: sum(businessList),
    personal: personalList, personalTotalQAR: sum(personalList),
    uncategorisedQAR: round2(uncategorisedQAR), uncategorisedCount,
  };
}

export type { ExpenseGroup };

// ─── Setting a position by hand ───

/** Lines that are no longer part of the position; offsets saved for them earlier are ignored. */
const NOT_COUNTED_LINES: ReadonlySet<NetPositionLineKey> = new Set<NetPositionLineKey>(['cash_vault', 'cash_custody', 'usdt_in_accounts', 'stock', 'merchant_lent', 'merchant_borrowed', 'manual_other']);

/** QAR to add to each line (negative takes away), in the signed form where an asset is positive and a liability negative. */
export type LineOffsets = Partial<Record<NetPositionLineKey, number>>;

const signedAmount = (line: NetPositionLine) => (line.side === 'asset' ? line.amountQAR : -line.amountQAR);

/** A position with each line moved by its offset; assets, liabilities and net are recomputed. */
export function applyLineOffsets(position: NetPosition, offsets: LineOffsets): NetPosition {
  const signed = new Map<NetPositionLineKey, number>(position.lines.map(l => [l.key, signedAmount(l)]));
  for (const [key, offset] of Object.entries(offsets) as Array<[NetPositionLineKey, number]>) {
    if (!offset || NOT_COUNTED_LINES.has(key)) continue;
    signed.set(key, (signed.get(key) ?? 0) + offset);
  }
  const lines: NetPositionLine[] = [...signed.entries()]
    .map(([key, value]) => ({ key, side: (value >= 0 ? 'asset' : 'liability') as 'asset' | 'liability', amountQAR: round2(Math.abs(value)) }))
    .filter(l => l.amountQAR !== 0);
  const assetsQAR = round2(lines.filter(l => l.side === 'asset').reduce((s, l) => s + l.amountQAR, 0));
  const liabilitiesQAR = round2(lines.filter(l => l.side === 'liability').reduce((s, l) => s + l.amountQAR, 0));
  return { ...position, lines, assetsQAR, liabilitiesQAR, netQAR: round2(assetsQAR - liabilitiesQAR) };
}

/**
 * A month whose starting position was set by hand. The offsets are what the
 * merchant's figures differ from the records by at the start of the month;
 * they are carried through the whole month, so the closing position moves by
 * the same amount and the change during the month is still what the records
 * say it was.
 */
export function applyOpeningOverride(
  month: MonthPosition,
  openingOffsets: LineOffsets,
  /** What moves the closing; the same as the opening's unless the figures were typed part-way through the month. */
  closingOffsets: LineOffsets = openingOffsets,
): MonthPosition {
  const opening = applyLineOffsets(month.opening, openingOffsets);
  // USDT on the exchanges is typed for the opening but the closing is always the live balance, never opening plus movement.
  const { exchange_usdt: _typedExchange, ...movementOffsets } = closingOffsets;
  const closing = applyLineOffsets(month.closing, movementOffsets);
  const changeQAR = round2(closing.netQAR - opening.netQAR);
  return { ...month, opening, closing, changeQAR, unexplainedQAR: round2(changeQAR - month.netRevenueQAR) };
}

/** Every ledger entry that is the cash side of a customer loan or a personal loan. */
export function loanLedgerEntryIds(
  customerLoans: TrackerState['customerLoans'],
  personalLoans: PersonalLoan[] = [],
): Set<string> {
  const ids = new Set<string>();
  for (const l of customerLoans || []) {
    if (l.disbursementLedgerEntryId) ids.add(l.disbursementLedgerEntryId);
    for (const r of l.repayments || []) if (r.ledgerEntryId) ids.add(r.ledgerEntryId);
  }
  for (const l of personalLoans) {
    if (l.ledgerEntryId) ids.add(l.ledgerEntryId);
    for (const r of l.repayments) if (r.ledgerEntryId) ids.add(r.ledgerEntryId);
  }
  return ids;
}
