// Exact helper functions from the TRACKER_CLOUDFLARE- repo

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function num(v: any, def = 0): number {
  const n = parseFloat(v);
  return isNaN(n) ? def : n;
}

// ── Centralized number formatting ──────────────────────────────────
// Rule: TRUNCATION everywhere (not rounding) for consistency.

/**
 * Truncate a number to `dp` decimal places without rounding.
 * e.g. trunc4(3.73234) → 3.7323
 */
function truncateToDP(n: number, dp: number): number {
  const factor = Math.pow(10, dp);
  return Math.trunc(n * factor) / factor;
}

/**
 * Format a PRICE value: max 4 decimal places, truncated, no trailing zeros.
 * Examples: 3 → "3", 3.7 → "3.7", 3.7300 → "3.73", 3.73234 → "3.7323"
 */
export function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const truncated = truncateToDP(n, 4);
  // Use toFixed(4) then strip trailing zeros
  let s = truncated.toFixed(4);
  // Remove trailing zeros after decimal point
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

/**
 * Format a TOTAL/aggregate value: whole number (truncated), with thousands separators.
 * Examples: 7790.00 → "7,790", 1250.75 → "1,250"
 */
export function fmtTotal(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const truncated = Math.trunc(n);
  return truncated.toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

export function fmtU(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return '—';
  // dp === 0 → total formatting (whole number, truncated)
  if (dp === 0) return fmtTotal(n);
  // Otherwise → price formatting (max 4dp, truncated, no trailing zeros)
  return fmtPrice(n);
}

/** Format fiat amount with currency code. Defaults to QAR for backward compat. */
export function fmtQ(v: number, fiatCurrency: 'QAR' | 'EGP' = 'QAR'): string {
  const x = num(v, 0);
  return fmtTotal(x) + ' ' + fiatCurrency;
}

export function fmtQRaw(v: number): string {
  const x = num(v, 0);
  return fmtTotal(x);
}

export function fmtP(n: number): string {
  const x = num(n, 0);
  if (!Number.isFinite(x)) return '—';
  return fmtPrice(x);
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(num(n))) return '—';
  const v = num(n);
  return (v >= 0 ? '+' : '') + Math.trunc(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) + '%';
}

export function fmtDur(ms: number): string {
  if (!ms || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return d + 'd ' + (h % 24) + 'h';
  if (h > 0) return h + 'h ' + (m % 60) + 'm';
  return m + 'm';
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

/**
 * Format a fiat amount with display currency awareness.
 * @param fiatAmount - The amount in whatever fiat currency the record uses
 * @param displayCurrency - What the user wants to see ('QAR', 'EGP', or 'USDT')
 * @param wacop - Weighted average cost of purchase (for USDT conversion)
 * @param recordFiat - The actual fiat currency of this record (defaults to 'QAR' for backward compat)
 */
export function fmtQWithUnit(
  fiatAmount: number,
  displayCurrency: string = 'QAR',
  wacop: number | null = null,
  recordFiat: 'QAR' | 'EGP' = 'QAR',
): string {
  const q = num(fiatAmount);
  if (!Number.isFinite(q)) return '—';
  if (displayCurrency === 'USDT' && wacop && wacop > 0) {
    return fmtPrice(q / wacop) + ' USDT';
  }
  // Show in the record's actual fiat currency
  return fmtTotal(q) + ' ' + recordFiat;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function esc(s: any): string {
  return String(s || '');
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Types matching the repo state model ──

// ── Cash Management System Types ──────────────────────────────
export type CashAccountType = 'hand' | 'bank' | 'vault' | 'merchant_custody';
export type CashCurrency = 'QAR' | 'EGP' | 'USDT' | 'USD';
export type LedgerEntryType =
  | 'opening'
  | 'deposit'
  | 'sale_deposit'
  | 'withdrawal'
  | 'transfer_in'
  | 'transfer_out'
  | 'stock_purchase'
  | 'stock_refund'
  | 'stock_edit_adjust'
  | 'reconcile'
  | 'merchant_funding_out'
  | 'merchant_funding_return'
  | 'merchant_sale_proceeds'
  | 'merchant_settlement_in'
  | 'merchant_settlement_out'
  | 'merchant_fee'
  | 'merchant_adjustment';

export interface CashAccount {
  id: string;
  name: string;
  type: CashAccountType;
  currency: CashCurrency;
  status: 'active' | 'inactive';
  bankName?: string;
  branch?: string;
  nickname?: string;
  lastReconciled?: number;
  notes?: string;
  createdAt: number;
  /** Linked merchant ID if this is a custody account */
  merchantId?: string;
  /** Linked relationship ID */
  relationshipId?: string;
  /** Purpose of the account (default: custody) */
  purpose?: 'custody' | 'clearing' | 'settlement';
  /** Flag to explicitly mark as merchant account */
  isMerchantAccount?: boolean;
}

export interface CashLedgerEntry {
  id: string;
  ts: number;
  type: LedgerEntryType;
  accountId: string;
  contraAccountId?: string;
  direction: 'in' | 'out';
  amount: number;
  currency: CashCurrency;
  fxRate?: number;
  linkedEntityType?: 'batch' | 'trade' | 'relationship' | 'settlement';
  linkedEntityId?: string;
  note?: string;
  /** Metadata for merchant/linked tracking */
  merchantId?: string;
  relationshipId?: string;
  tradeId?: string;
  orderId?: string;
  batchId?: string;
  settlementId?: string;
}

export function getAccountBalance(accountId: string, ledger: CashLedgerEntry[]): number {
  return (ledger || [])
    .filter(e => e.accountId === accountId)
    .reduce((sum, e) => sum + (e.direction === 'in' ? e.amount : -e.amount), 0);
}

export function getAllAccountBalances(accounts: CashAccount[], ledger: CashLedgerEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const acc of accounts || []) {
    map.set(acc.id, getAccountBalance(acc.id, ledger));
  }
  return map;
}

/** Derive the legacy cashQAR total from the new multi-account ledger (User cash only) */
export function deriveCashQAR(cashAccounts: CashAccount[], cashLedger: CashLedgerEntry[]): number {
  if (!cashAccounts || cashAccounts.length === 0) return 0;
  let total = 0;
  for (const acc of cashAccounts) {
    if (acc.status !== 'active' || acc.currency !== 'QAR') continue;
    // Rule: Merchant accounts are EXCLUDED from the main dashboard cash totals
    if (acc.type === 'merchant_custody') continue;
    total += getAccountBalance(acc.id, cashLedger);
  }
  return total;
}

export interface Batch {
  id: string;
  ts: number;
  source: string;
  note: string;
  buyPriceQAR: number;
  initialUSDT: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  revisions: any[];
  /** ID of the CashAccount used to fund this batch */
  fundingAccountId?: string;
  /** ID of the CashLedgerEntry for this batch's purchase */
  fundingLedgerEntryId?: string;
  /** Custody location tracking */
  custodyType?: 'self' | 'merchant';
  custodyMerchantId?: string;
  custodyRelationshipId?: string;
}

export type LinkedTradeStatus = 'pending_approval' | 'approved' | 'rejected' | 'cancellation_pending' | 'cancelled';

export type SettlementMode =
  | 'instant_to_self_cash'
  | 'merchant_holds_proceeds'
  | 'merchant_buys_for_me'
  | 'merchant_holds_inventory';

export interface Trade {
  id: string;
  ts: number;
  inputMode: 'USDT' | 'QAR';
  amountUSDT: number;
  sellPriceQAR: number;
  feeQAR: number;
  note: string;
  voided: boolean;
  usesStock: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  revisions: any[];
  customerId: string;
  /** Manual buy price (QAR per USDT) — used when usesStock is false */
  manualBuyPrice?: number;
  /** Linked merchant deal ID (if this is a merchant order — legacy, kept for old data) */
  linkedDealId?: string;
  /** Linked relationship ID (if this is a merchant order) */
  linkedRelId?: string;
  /** Linked merchant user/profile ID (counterparty) */
  linkedMerchantId?: string;
  // ── Trade-centric agreement fields ──
  /** Agreement family: profit_share or sales_deal */
  agreementFamily?: 'profit_share' | 'sales_deal' | 'capital_transfer';
  /** Agreement template ID used */
  agreementTemplateId?: string;
  /** Partner share percentage */
  partnerPct?: number;
  /** Merchant share percentage */
  merchantPct?: number;
  /** Approval status for merchant-linked trades */
  approvalStatus?: LinkedTradeStatus;
  /** Who requested cancellation (user_id), if cancellation_pending */
  cancellationRequestedBy?: string;
  /** New Merchant-Linked Settlement Fields */
  settlementMode?: SettlementMode;
  /** Account where proceeds were/will be deposited (could be merchant custody account) */
  proceedsAccountId?: string;
  /** Dedicated merchant settlement account ID */
  merchantSettlementAccountId?: string;
  /** Where inventory is held after execution */
  inventoryCustodyMerchantId?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  tier: string;
  dailyLimitUSDT: number;
  notes: string;
  createdAt: number;
}

export interface DerivedBatch {
  id: string;
  buyPriceQAR: number;
  initialUSDT: number;
  remainingUSDT: number;
}

export interface TradeCalcResult {
  ok: boolean;
  netQAR: number;
  avgBuyQAR: number;
  margin: number;
  ppu: number;
  slices: { batchId: string; qty: number; cost: number }[];
  coveredQty: number;
  shortfallQty: number;
  totalCost: number;
}

export interface StockLayer {
  id: string;
  ts: number;
  remainingQty: number;
  buyPrice: number;
}

export interface FifoConsumeRow {
  layerId: string;
  qty: number;
  buyPrice: number;
  cost: number;
}

export interface FifoResult {
  coveredQty: number;
  shortfallQty: number;
  totalCost: number;
  unitCost: number | null;
  consumed: FifoConsumeRow[];
}

export function consumeFifo(layers: StockLayer[], sellQty: number): FifoResult {
  const ordered = layers.filter(l => l.remainingQty > 0);

  let remainingToSell = Math.max(0, sellQty);
  let coveredQty = 0;
  let totalCost = 0;
  const consumed: FifoConsumeRow[] = [];

  for (const layer of ordered) {
    if (remainingToSell <= 0) break;

    const takeQty = Math.min(layer.remainingQty, remainingToSell);
    const cost = takeQty * layer.buyPrice;
    consumed.push({
      layerId: layer.id,
      qty: takeQty,
      buyPrice: layer.buyPrice,
      cost,
    });
    coveredQty += takeQty;
    totalCost += cost;
    remainingToSell -= takeQty;
  }

  return {
    coveredQty,
    shortfallQty: remainingToSell,
    totalCost,
    unitCost: coveredQty > 0 ? totalCost / coveredQty : null,
    consumed,
  };
}

export interface CashTransaction {
  id: string;
  ts: number;
  type: 'deposit' | 'withdraw' | 'batch_purchase' | 'sale_deposit';
  amount: number;
  balanceAfter: number;
  owner: string;
  bankAccount: string;
  note: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  notes: string;
  createdAt: number;
}

export interface TrackerState {
  currency: 'QAR' | 'EGP' | 'USDT';
  range: string;
  batches: Batch[];
  trades: Trade[];
  customers: Customer[];
  suppliers: Supplier[];
  cashQAR: number;
  cashOwner: string;
  cashHistory: CashTransaction[];
  /** Multi-wallet cash accounts (replaces single cashQAR for multi-account users) */
  cashAccounts: CashAccount[];
  /** Immutable cash ledger — every balance change appends here */
  cashLedger: CashLedgerEntry[];
  settings: { lowStockThreshold: number; priceAlertThreshold: number };
  cal: { year: number; month: number; selectedDay: number | null };
}

export interface DerivedState {
  batches: DerivedBatch[];
  tradeCalc: Map<string, TradeCalcResult>;
}

// ── FIFO computation ──

/** Returns true if a trade should be excluded from FIFO stock consumption */
function isTradeInactive(t: Trade): boolean {
  if (t.voided) return true;
  const status = t.approvalStatus;
  if (status === 'cancelled' || status === 'rejected') return true;
  return false;
}

/**
 * Select eligible batches for a trade using merchant-aware FIFO.
 * If the trade is linked to a merchant (via linkedMerchantId or linkedRelId),
 * prefer batches whose source matches the merchant/supplier name.
 * Fall back to all remaining batches if merchant pool is exhausted.
 */
function selectEligibleBatches(
  trade: Trade,
  sortedBatches: Batch[],
  remaining: Map<string, number>,
): Batch[] {
  // If the trade is merchant-linked, try to identify supplier-specific batches
  const merchantId = trade.linkedMerchantId;
  if (merchantId) {
    const merchantBatches = sortedBatches.filter(b => {
      const rem = remaining.get(b.id) || 0;
      if (rem <= 0) return false;
      // Match by source containing the merchant ID (case-insensitive)
      const src = (b.source || '').toLowerCase();
      return src.includes(merchantId.toLowerCase());
    });
    if (merchantBatches.length > 0) {
      // Merchant pool first, then remaining global pool as fallback
      const globalFallback = sortedBatches.filter(b => {
        const rem = remaining.get(b.id) || 0;
        return rem > 0 && !merchantBatches.includes(b);
      });
      return [...merchantBatches, ...globalFallback];
    }
  }
  // Default: global FIFO order
  return sortedBatches;
}

export function computeFIFO(batches: Batch[], trades: Trade[]): DerivedState {
  const sortedBatches = [...batches].sort((a, b) => a.ts - b.ts);
  const remaining = new Map<string, number>();
  for (const b of sortedBatches) remaining.set(b.id, b.initialUSDT);

  const tradeCalc = new Map<string, TradeCalcResult>();
  // Filter out inactive trades (voided, cancelled, rejected) from stock consumption
  const sortedTrades = [...trades].filter(t => !isTradeInactive(t) && t.usesStock).sort((a, b) => a.ts - b.ts);

  for (const t of sortedTrades) {
    // Use merchant-aware batch selection
    const eligibleBatches = selectEligibleBatches(t, sortedBatches, remaining);
    const layers: StockLayer[] = eligibleBatches.map(b => ({
      id: b.id,
      ts: b.ts,
      remainingQty: Math.max(0, remaining.get(b.id) || 0),
      buyPrice: b.buyPriceQAR,
    }));
    const fifo = consumeFifo(layers, t.amountUSDT);
    const slices = fifo.consumed.map(row => ({ batchId: row.layerId, qty: row.qty, cost: row.cost }));

    for (const row of fifo.consumed) {
      const rem = remaining.get(row.layerId) || 0;
      remaining.set(row.layerId, Math.max(0, rem - row.qty));
    }

    const fullyMatched = fifo.shortfallQty <= 0;
    const rev = t.amountUSDT * t.sellPriceQAR;
    const netQAR = fullyMatched ? rev - fifo.totalCost - t.feeQAR : 0;
    const avgBuyQAR = fullyMatched && t.amountUSDT > 0 ? fifo.totalCost / t.amountUSDT : 0;
    const margin = fullyMatched && rev > 0 ? (netQAR / rev) * 100 : 0;

    tradeCalc.set(t.id, {
      ok: fullyMatched || !t.usesStock,
      netQAR,
      avgBuyQAR,
      margin,
      ppu: rev > 0 ? netQAR / t.amountUSDT : 0,
      slices,
      coveredQty: fifo.coveredQty,
      shortfallQty: fifo.shortfallQty,
      totalCost: fifo.totalCost,
    });
  }

  // Non-stock trades (manual mode) — use manualBuyPrice for cost
  // Also exclude inactive trades here
  for (const t of trades.filter(t => !isTradeInactive(t) && !t.usesStock)) {
    const rev = t.amountUSDT * t.sellPriceQAR;
    const cost = t.manualBuyPrice ? t.amountUSDT * t.manualBuyPrice : 0;
    const netQAR = rev - cost - t.feeQAR;
    const avgBuyQAR = t.manualBuyPrice || 0;
    const margin = rev > 0 ? (netQAR / rev) * 100 : 0;
    tradeCalc.set(t.id, {
      ok: true,
      netQAR,
      avgBuyQAR,
      margin,
      ppu: rev > 0 ? netQAR / t.amountUSDT : 0,
      slices: [],
      coveredQty: t.amountUSDT,
      shortfallQty: 0,
      totalCost: cost,
    });
  }

  const derivedBatches: DerivedBatch[] = sortedBatches.map(b => ({
    id: b.id,
    buyPriceQAR: b.buyPriceQAR,
    initialUSDT: b.initialUSDT,
    remainingUSDT: Math.max(0, remaining.get(b.id) || 0),
  }));

  return { batches: derivedBatches, tradeCalc };
}

export function totalStock(derived: DerivedState): number {
  return derived.batches.reduce((s, b) => s + Math.max(0, b.remainingUSDT), 0);
}

export function stockCostQAR(derived: DerivedState): number {
  return derived.batches.reduce((s, b) => s + Math.max(0, b.remainingUSDT) * b.buyPriceQAR, 0);
}

export function getWACOP(derived: DerivedState): number | null {
  const a = derived.batches.filter(b => b.remainingUSDT > 0);
  if (!a.length) return null;
  const tv = a.reduce((s, b) => s + b.remainingUSDT * b.buyPriceQAR, 0);
  const ta = a.reduce((s, b) => s + b.remainingUSDT, 0);
  return ta > 0 ? tv / ta : null;
}

export function inRange(ts: number, range: string): boolean {
  const now = new Date();
  const nowTs = now.getTime();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

  if (range === 'all') return true;
  if (range === 'today') return ts >= startOfDay(nowTs);
  if (range === '7d') return ts >= nowTs - 7 * 864e5;
  if (range === '30d') return ts >= nowTs - 30 * 864e5;
  if (range === 'this_month') return ts >= startOfThisMonth;
  if (range === 'last_month') return ts >= startOfLastMonth && ts < startOfThisMonth;
  return true;
}

/** Apply merchant share to net profit for linked trades (show only "my cut") */
function getMySharePct(trade: Trade): number {
  // Legacy rows may store 0 or invalid pct values; recover from partnerPct when possible.
  const merchantPct = Number(trade.merchantPct);
  if (Number.isFinite(merchantPct) && merchantPct > 0 && merchantPct <= 100) return merchantPct;
  const partnerPct = Number(trade.partnerPct);
  if (Number.isFinite(partnerPct) && partnerPct >= 0 && partnerPct < 100) return 100 - partnerPct;
  return 100;
}

function applyMyShare(trade: Trade, fullNet: number): number {
  if (trade.linkedDealId || trade.linkedRelId) {
    return fullNet * getMySharePct(trade) / 100;
  }
  return fullNet;
}

export function kpiFor(state: TrackerState, derived: DerivedState, range: string) {
  const trades = state.trades.filter(t => !isTradeInactive(t) && inRange(t.ts, range));
  let rev = 0, net = 0, qty = 0, fee = 0;
  for (const t of trades) {
    const c = derived.tradeCalc.get(t.id);
    const tradeRev = t.amountUSDT * t.sellPriceQAR;
    rev += tradeRev;
    qty += t.amountUSDT;
    fee += t.feeQAR;
    let fullNet = 0;
    if (c?.ok) {
      fullNet = c.netQAR;
    } else if (t.manualBuyPrice) {
      fullNet = tradeRev - (t.amountUSDT * t.manualBuyPrice) - t.feeQAR;
    }
    net += applyMyShare(t, fullNet);
  }
  const margins = trades
    .map(t => { const c = derived.tradeCalc.get(t.id); return c?.ok ? c.margin : null; })
    .filter((x): x is number => x !== null);
  const avgMgn = margins.length ? margins.reduce((s, v) => s + v, 0) / margins.length : 0;
  return { rev, net, qty, fee, count: trades.length, avgMgn };
}

export function rangeLabel(range: string): string {
  if (range === 'today') return 'Today';
  if (range === '7d') return '7 Days';
  if (range === '30d') return '30 Days';
  if (range === 'this_month') return 'This Month';
  if (range === 'last_month') return 'Last Month';
  if (range === 'all') return 'All Time';
  return range;
}

export function batchCycleTime(state: TrackerState, derived: DerivedState, id: string): number | null {
  const b = state.batches.find(x => x.id === id);
  if (!b) return null;
  const cs = state.trades.filter(t => {
    const c = derived.tradeCalc.get(t.id);
    return c?.ok && c.slices.some(s => s.batchId === id);
  });
  return cs.length ? Math.max(...cs.map(t => t.ts)) - b.ts : null;
}
