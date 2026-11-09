/** EGP taken off Bank Misr's QAR notes sell price before customers see it. */
export const BANK_MISR_PRICE_MARGIN_EGP = 0.25;

/** The price customers see: Bank Misr's sell price less the margin, to four decimals. */
export function bankMisrDisplayPrice(sell: number): number | null {
  if (!Number.isFinite(sell)) return null;
  const price = Math.round((sell - BANK_MISR_PRICE_MARGIN_EGP) * 10000) / 10000;
  return price > 0 ? price : null;
}
