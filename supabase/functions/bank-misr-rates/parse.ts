// Pure parser for Banque Misr's exchange-rate page, kept free of Deno APIs so the
// Vitest suite can import it.

export interface BankMisrQarNotes {
  /** EGP the bank pays per 1 QAR note. */
  buy: number;
  /** EGP the bank charges per 1 QAR note. */
  sell: number;
}

// The page lists, per currency, Notes (buy, sell) then Transfer (buy, sell). Only the
// first pair of the QATARI Riyal row is wanted.
const QAR_ROW = /QATARI\s+Riyal\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>/i;

// Anything outside this is a layout change or a bad scrape, not a real rate; never store it.
const MIN_PLAUSIBLE = 5;
const MAX_PLAUSIBLE = 50;

export function parseBankMisrQarNotes(html: string): BankMisrQarNotes | null {
  const match = QAR_ROW.exec(html);
  if (!match) return null;
  const buy = Number(match[1].replace(/,/g, ''));
  const sell = Number(match[2].replace(/,/g, ''));
  if (![buy, sell].every((n) => Number.isFinite(n) && n >= MIN_PLAUSIBLE && n <= MAX_PLAUSIBLE)) return null;
  if (buy > sell) return null;
  return { buy, sell };
}
