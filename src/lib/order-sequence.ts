/**
 * Orders are sequenced by when they were actually placed, never by when they
 * were last touched. Two orders can land in the same minute, so ties fall
 * back to the exchange order number, which only ever grows.
 */

/** Compare two digit strings numerically without losing precision on 19-digit order numbers. */
export function compareOrderNumbers(a?: string | null, b?: string | null): number {
  const x = (a ?? '').replace(/^0+/, '');
  const y = (b ?? '').replace(/^0+/, '');
  if (!/^\d+$/.test(x) || !/^\d+$/.test(y)) return 0;
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

export interface Placement {
  ts: number;
  orderNumber?: string | null;
  id?: string;
}

/** Oldest first: by placement time, then exchange order number, then id so the result is stable. */
export function comparePlacement(a: Placement, b: Placement): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  const byNumber = compareOrderNumbers(a.orderNumber, b.orderNumber);
  if (byNumber !== 0) return byNumber;
  return (a.id ?? '').localeCompare(b.id ?? '');
}

/** A date as the value of a datetime-local input: local wall-clock time, not UTC. */
export function toLocalInputValue(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
