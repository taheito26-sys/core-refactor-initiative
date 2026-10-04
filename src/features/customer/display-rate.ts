// ─── QAR → EGP rate shown to customers ───
//
// For September 2026 the rate a customer sees is 0.20 higher than the real
// one. This is presentation only: amounts, totals, loan balances and every
// other figure keep using the real rate, so a displayed rate times a
// quantity will not match the displayed total for those orders.

export const DISPLAY_RATE_UPLIFT = 0.2;
const UPLIFT_YEAR = 2026;
/** Zero-based: 8 is September. */
const UPLIFT_MONTH = 8;

export function isUpliftMonth(ts: number | string | Date | null | undefined): boolean {
  if (ts == null) return false;
  const d = ts instanceof Date ? ts : new Date(ts);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === UPLIFT_YEAR && d.getMonth() === UPLIFT_MONTH;
}

/** The QAR → EGP rate to display for an order dated `ts`. */
export function displayQarEgpRate(rate: number, ts: number | string | Date | null | undefined): number {
  return isUpliftMonth(ts) ? Math.round((rate + DISPLAY_RATE_UPLIFT) * 1e6) / 1e6 : rate;
}
