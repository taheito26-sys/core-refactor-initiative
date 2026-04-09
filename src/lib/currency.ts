// ─── Currency Infrastructure ──────────────────────────────────────────────
// Centralized currency types, formatting, and helpers.
// All fiat display + calculation must go through here — no hardcoded "QAR".

// ── Supported fiat currencies ─────────────────────────────────────────────
export type FiatCurrency = 'QAR' | 'EGP';
export type AnyCurrency = FiatCurrency | 'USDT' | 'USD';

export const FIAT_CURRENCIES: readonly FiatCurrency[] = ['QAR', 'EGP'] as const;

export interface FiatCurrencyConfig {
  code: FiatCurrency;
  symbol: string;
  symbolAr: string;
  name: string;
  nameAr: string;
  /** Decimal places for display (QAR=0, EGP=0 for totals) */
  displayDecimals: number;
  /** Locale hint for formatting */
  locale?: string;
}

export const FIAT_CONFIG: Record<FiatCurrency, FiatCurrencyConfig> = {
  QAR: {
    code: 'QAR',
    symbol: 'QAR',
    symbolAr: 'ر.ق',
    name: 'Qatari Riyal',
    nameAr: 'ريال قطري',
    displayDecimals: 0,
  },
  EGP: {
    code: 'EGP',
    symbol: 'EGP',
    symbolAr: 'ج.م',
    name: 'Egyptian Pound',
    nameAr: 'جنيه مصري',
    displayDecimals: 0,
  },
};

// ── Number formatting (truncation, not rounding) ──────────────────────────

function truncateToDP(n: number, dp: number): number {
  const factor = Math.pow(10, dp);
  return Math.trunc(n * factor) / factor;
}

function fmtTotalRaw(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.trunc(n).toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function fmtPriceRaw(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const truncated = truncateToDP(n, 4);
  let s = truncated.toFixed(4);
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

// ── Public formatting API ─────────────────────────────────────────────────

/**
 * Format a fiat amount with its currency code.
 * e.g. fmtFiat(7790, 'QAR') → "7,790 QAR"
 *      fmtFiat(7790, 'EGP') → "7,790 EGP"
 */
export function fmtFiat(amount: number, currency: FiatCurrency): string {
  if (!Number.isFinite(amount)) return '—';
  return fmtTotalRaw(amount) + ' ' + currency;
}

/**
 * Format a fiat amount with Arabic symbol.
 * e.g. fmtFiatAr(7790, 'QAR') → "7,790 ر.ق"
 */
export function fmtFiatAr(amount: number, currency: FiatCurrency): string {
  if (!Number.isFinite(amount)) return '—';
  const cfg = FIAT_CONFIG[currency];
  return fmtTotalRaw(amount) + ' ' + cfg.symbolAr;
}

/**
 * Format amount with the user's display preference.
 * If displayCurrency is USDT, convert using wacop.
 * Otherwise show in the record's fiat currency.
 */
export function fmtWithUnit(
  fiatAmount: number,
  displayCurrency: 'QAR' | 'EGP' | 'USDT',
  recordFiatCurrency: FiatCurrency = 'QAR',
  wacop: number | null = null,
): string {
  if (!Number.isFinite(fiatAmount)) return '—';

  if (displayCurrency === 'USDT' && wacop && wacop > 0) {
    return fmtPriceRaw(fiatAmount / wacop) + ' USDT';
  }

  // Show in the record's actual fiat currency
  return fmtTotalRaw(fiatAmount) + ' ' + recordFiatCurrency;
}

/**
 * Get the fiat currency label for a given currency code.
 * Useful in form labels: "Sell Price (QAR)" or "Sell Price (EGP)"
 */
export function fiatLabel(currency: FiatCurrency, lang: 'en' | 'ar' = 'en'): string {
  const cfg = FIAT_CONFIG[currency];
  return lang === 'ar' ? cfg.symbolAr : cfg.code;
}

/**
 * Determine if two records can be aggregated (same fiat currency).
 * Returns false if currencies differ — prevents incorrect totals.
 */
export function canAggregate(currencyA: FiatCurrency, currencyB: FiatCurrency): boolean {
  return currencyA === currencyB;
}

/**
 * Default fiat currency for new records based on user preference.
 */
export function defaultFiat(baseFiatCurrency?: FiatCurrency): FiatCurrency {
  return baseFiatCurrency ?? 'QAR';
}
