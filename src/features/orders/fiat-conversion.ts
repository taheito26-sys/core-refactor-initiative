/**
 * Conversion rate between the QAR a P2P order is sold for and the currency the buyer actually paid in.
 *
 * The exchange reports a fiat price per USDT (say 54 EGP) and the merchant enters his own QAR/USDT sell
 * rate (say 3.83), so the buyer's conversion is 54 / 3.83 = 14.10 EGP per QAR. When the per-USDT price is
 * unknown the order's fiat total over its QAR revenue gives the same figure.
 */
export function fiatPerQar(input: {
  fiatPricePerUsdt?: number | null;
  sellQarPerUsdt: number;
  fiatTotal?: number | null;
  qarRevenue?: number | null;
}): number | null {
  const { fiatPricePerUsdt, sellQarPerUsdt, fiatTotal, qarRevenue } = input;
  let rate: number | null = null;
  if (fiatPricePerUsdt && fiatPricePerUsdt > 0 && sellQarPerUsdt > 0) rate = fiatPricePerUsdt / sellQarPerUsdt;
  else if (fiatTotal && fiatTotal > 0 && qarRevenue && qarRevenue > 0) rate = fiatTotal / qarRevenue;
  return rate != null && Number.isFinite(rate) ? rate : null;
}
