/*
 * Pure rules behind the two-customer split window. The window shows both
 * halves of one order side by side; everything that must stay consistent
 * between them (the quantities adding back up to the order, a fee that is
 * divided rather than copied, per-half revenue and loan principal) lives
 * here so it can be tested without rendering anything.
 */

export type SplitCashMode = 'none' | 'full' | 'partial';

export type SplitPlanError =
  | 'qty_invalid'
  | 'qty_too_large'
  | 'price_invalid'
  | 'buyer_missing'
  | 'second_buyer_missing'
  | 'same_buyer';

const EPS = 1e-8;

export function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A quantity as an input string: no float dust, no trailing zeros, empty for zero or less. */
export function formatQty(n: number): string {
  if (!Number.isFinite(n) || n <= EPS) return '';
  return String(round8(n));
}

/**
 * The other half after one half is typed: the two always add back up to the
 * order total. Typing more than the total leaves the other half empty rather
 * than negative, and the caller's validation reports the overshoot.
 */
export function otherHalf(total: number, typed: string): string {
  const value = Number(typed);
  if (!Number.isFinite(value) || value < 0) return formatQty(total);
  return formatQty(Math.max(0, total - value));
}

/** An even split, the first half rounded to two decimals and the second taking the exact remainder. */
export function evenSplit(total: number): [string, string] {
  if (!(total > 0)) return ['', ''];
  const first = round2(total / 2);
  return [formatQty(first), formatQty(round8(total - first))];
}

/** Revenue of one half in the base fiat, after its share of the fee. */
export function legRevenue(qty: number, price: number): number {
  if (!(qty > 0) || !(price > 0)) return 0;
  return qty * price;
}

/**
 * Splits a fee across the two halves in proportion to quantity: the first gets
 * its rounded share and the second the exact remainder, so the two always sum
 * to the original fee.
 */
export function allocateFee(fee: number, qtyA: number, qtyB: number): [number, number] {
  const total = qtyA + qtyB;
  if (!(fee > 0) || !(total > 0)) return [0, 0];
  const a = round2((fee * qtyA) / total);
  return [a, round2(fee - a)];
}

/** What a loaned half owes: its own revenue less its own fee, never negative. */
export function legLoanPrincipal(qty: number, price: number, fee: number): number {
  return Math.max(0, round2(qty * price - fee));
}

export interface SplitPlanInput {
  total: number;
  qtyA: number;
  qtyB: number;
  priceA: number;
  priceB: number;
  hasBuyerA: boolean;
  hasBuyerB: boolean;
  /** Both halves resolve to the same customer record. */
  sameBuyer: boolean;
}

export function validateSplitPlan(input: SplitPlanInput): SplitPlanError | null {
  const { total, qtyA, qtyB, priceA, priceB } = input;
  if (!(qtyA > 0) || !(qtyB > 0)) return 'qty_invalid';
  if (Math.abs(qtyA + qtyB - total) > 1e-6) return 'qty_too_large';
  if (!(priceA > 0) || !(priceB > 0)) return 'price_invalid';
  if (!input.hasBuyerA) return 'buyer_missing';
  if (!input.hasBuyerB) return 'second_buyer_missing';
  if (input.sameBuyer) return 'same_buyer';
  return null;
}

export interface SplitCustomerOption {
  id: string;
  name: string;
  nameEn?: string;
  nameAr?: string;
  phone?: string;
}

function fold(value: string | undefined): string {
  return (value || '').normalize('NFKC').trim().toLowerCase();
}

/** Autocomplete: customers matching the typed text by any name or phone, best matches first. */
export function matchCustomerOptions<T extends SplitCustomerOption>(
  options: T[],
  query: string,
  excludeId?: string,
  limit = 6,
): T[] {
  const q = fold(query);
  const pool = options.filter(o => o.id !== excludeId);
  if (!q) return pool.slice(0, limit);
  const scored: Array<{ option: T; score: number }> = [];
  for (const option of pool) {
    const names = [option.name, option.nameEn, option.nameAr].map(fold).filter(Boolean);
    let score = -1;
    if (names.some(n => n === q)) score = 0;
    else if (names.some(n => n.startsWith(q))) score = 1;
    else if (names.some(n => n.includes(q))) score = 2;
    else if (fold(option.phone).includes(q)) score = 3;
    if (score >= 0) scored.push({ option, score });
  }
  return scored.sort((x, y) => x.score - y.score).slice(0, limit).map(s => s.option);
}

/** The option whose name exactly equals the typed text, if there is exactly one. */
export function exactCustomerMatch<T extends SplitCustomerOption>(options: T[], query: string): T | null {
  const q = fold(query);
  if (!q) return null;
  const hits = options.filter(o => [o.name, o.nameEn, o.nameAr].map(fold).includes(q));
  return hits.length === 1 ? hits[0] : null;
}
