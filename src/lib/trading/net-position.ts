import {
  computeFIFO, getAccountBalance, getLoanRepaid,
  type CashAccount, type CustomerLoan, type TrackerState,
} from '../tracker-helpers';
import { isTransferActive, transferCounterpartyKey, type UsdtTransfer } from '../usdt-transfers';

// ─── Net position: everything owned minus everything owed ───
//
// Net revenue says what a month earned; it cannot say what the merchant
// owns, or why that changed. This sums every asset and liability the
// tracker knows about into one QAR figure as of any moment, so a month's
// opening and closing positions can be compared against its revenue.
//
// Every currency is brought to QAR by what it costs in USDT. A USD amount is
// worth the average price USDT is being bought at (the stock's weighted
// average cost, the app's WACOP), and can be overridden. An EGP loan is
// worth the USDT it cost, at the EGP rate of the sale that created it, and
// that USDT is then priced the same way; EGP cash uses one EGP rate, also
// overridable. Stock is valued at FIFO cost. The position is rebuilt from dated records,
// so a later edit to an old record moves an old month; a frozen month-end
// snapshot is what keeps history stable.

/** QAR has been pegged to the US dollar at this rate since 2001; used only when there is no USDT price to go by. */
export const USD_QAR_PEG = 3.64;

export type NetPositionLineKey =
  | 'cash_hand'
  | 'cash_bank'
  | 'cash_vault'
  | 'cash_custody'
  | 'usdt_in_accounts'
  | 'stock'
  | 'customer_loans'
  | 'merchant_lent'
  | 'merchant_borrowed';

export interface NetPositionLine {
  key: NetPositionLineKey;
  side: 'asset' | 'liability';
  /** Always a positive amount; `side` says whether it adds to or takes from the net. */
  amountQAR: number;
}

export interface NetPosition {
  /** The moment the position is measured at, inclusive. */
  asOf: number;
  lines: NetPositionLine[];
  assetsQAR: number;
  liabilitiesQAR: number;
  netQAR: number;
  /** USDT held in stock at that moment. */
  stockUSDT: number;
  /** QAR per USDT used to value USDT held outside stock layers. */
  usdtRateQAR: number;
  /** QAR per 1 USD used: the override, else the average USDT buying price. */
  usdToQar: number;
  /** EGP per 1 USDT used for EGP cash and for EGP loans with no sale rate of their own; 0 when unknown. */
  egpPerUsdt: number;
  warnings: Array<'usdt_unpriced' | 'egp_unpriced'>;
}

export interface NetPositionOptions {
  /** QAR per 1 USD. Defaults to the average USDT buying price (WACOP). */
  usdToQar?: number;
  /** EGP per 1 USDT. Overrides every EGP conversion; by default each EGP loan uses the rate of its own sale. */
  egpPerUsdt?: number;
  /** QAR per USDT for USDT held in cash accounts or lent / borrowed; defaults to the stock's average cost. */
  usdtRateQAR?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const ACCOUNT_LINE: Record<CashAccount['type'], NetPositionLineKey> = {
  hand: 'cash_hand',
  bank: 'cash_bank',
  vault: 'cash_vault',
  merchant_custody: 'cash_custody',
};

export function computeNetPosition(
  state: Pick<TrackerState, 'cashAccounts' | 'cashLedger' | 'batches' | 'trades' | 'customerLoans' | 'deletedLoanIds' | 'usdtTransfers'>,
  asOf: number,
  options: NetPositionOptions = {},
): NetPosition {
  const warnings: NetPosition['warnings'] = [];
  const sums = new Map<string, { side: 'asset' | 'liability'; amount: number }>();
  const add = (key: NetPositionLineKey, side: 'asset' | 'liability', amount: number) => {
    const slot = sums.get(key) ?? { side, amount: 0 };
    slot.amount += amount;
    sums.set(key, slot);
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
  if (stockCost > 0) add('stock', 'asset', stockCost);

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

  // ── Cash and bank, from the ledger up to asOf ──
  const ledger = (state.cashLedger || []).filter(e => e.ts <= asOf);
  let usdtAccountBalance = 0;
  for (const acc of state.cashAccounts || []) {
    const balance = getAccountBalance(acc.id, ledger);
    if (!balance) continue;
    if (acc.currency === 'USDT') { usdtAccountBalance += balance; continue; }
    if (acc.currency === 'EGP' && !egpPerUsdt && !warnings.includes('egp_unpriced')) warnings.push('egp_unpriced');
    const qar = acc.currency === 'USD' ? balance * usdToQar : acc.currency === 'EGP' ? egpToQar(balance, egpPerUsdt) : balance;
    // A negative balance is an overdraft: owed, not owned.
    if (qar >= 0) add(ACCOUNT_LINE[acc.type] ?? 'cash_hand', 'asset', qar);
    else add('merchant_borrowed', 'liability', -qar);
  }
  if (usdtAccountBalance) {
    if (!usdtRateQAR) warnings.push('usdt_unpriced');
    add('usdt_in_accounts', usdtAccountBalance >= 0 ? 'asset' : 'liability', Math.abs(usdtAccountBalance) * usdtRateQAR);
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

  // ── USDT lent to / borrowed from other merchants, net per merchant ──
  const byMerchant = new Map<string, number>();
  for (const t of transfers as UsdtTransfer[]) {
    if (!isTransferActive(t)) continue;
    const key = transferCounterpartyKey(t);
    // Positive means the merchant owes me: lending out USDT, or repaying a
    // borrow, leaves them (or less of my debt) in my favour; borrowing in, or
    // getting a lend returned, goes the other way.
    const net = t.kind === 'lend_out' || t.kind === 'borrow_repay' ? t.amountUSDT : -t.amountUSDT;
    byMerchant.set(key, (byMerchant.get(key) ?? 0) + net);
  }
  if (byMerchant.size > 0 && !usdtRateQAR) warnings.push('usdt_unpriced');
  for (const net of byMerchant.values()) {
    if (Math.abs(net) < 1e-9) continue;
    add(net > 0 ? 'merchant_lent' : 'merchant_borrowed', net > 0 ? 'asset' : 'liability', Math.abs(net) * usdtRateQAR);
  }

  const lines: NetPositionLine[] = [...sums.entries()]
    .map(([key, v]) => ({ key: key as NetPositionLineKey, side: v.side, amountQAR: round2(v.amount) }))
    .filter(l => l.amountQAR !== 0);
  const assetsQAR = round2(lines.filter(l => l.side === 'asset').reduce((s, l) => s + l.amountQAR, 0));
  const liabilitiesQAR = round2(lines.filter(l => l.side === 'liability').reduce((s, l) => s + l.amountQAR, 0));
  return {
    asOf, lines, assetsQAR, liabilitiesQAR, netQAR: round2(assetsQAR - liabilitiesQAR),
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
