/**
 * Currency localization utilities
 * Provides localized names for currencies in both English and Arabic
 *
 * Rule: en → show code as-is (QAR, EGP, USDT)
 *       ar → show Arabic name (ريال, جنيه, دولار)
 */

import type { Lang } from './i18n';

export type CurrencyCode = 'QAR' | 'EGP' | 'USD' | 'USDT' | 'AED' | 'SAR';

const currencyNames: Record<CurrencyCode, Record<Lang, string>> = {
  QAR: { en: 'QAR', ar: 'ريال' },
  EGP: { en: 'EGP', ar: 'جنيه' },
  USD: { en: 'USD', ar: 'دولار' },
  USDT: { en: 'USDT', ar: 'دولار' },
  AED: { en: 'AED', ar: 'إماراتي' },
  SAR: { en: 'SAR', ar: 'سعودي' },
};

/**
 * Get localized currency name
 * @param code Currency code (QAR, EGP, etc.)
 * @param lang Language (en or ar)
 * @returns Localized currency name
 */
export function getLocalizedCurrencyName(code: CurrencyCode, lang: Lang = 'en'): string {
  return currencyNames[code]?.[lang] ?? code;
}

/**
 * Shorthand: localize any currency code based on language.
 * Accepts loose string so callers don't need to cast.
 * en → returns code as-is, ar → returns Arabic name.
 */
export function localCur(code: string, lang: Lang): string {
  return currencyNames[code as CurrencyCode]?.[lang] ?? code;
}

/**
 * Format FX rate display with localized currency names
 * Example: "1 ريال = 13.9253 جنية" (Arabic) or "1 QAR = 13.9253 EGP" (English)
 */
export function formatFxRateDisplay(
  rate: number,
  sourceCurrency: CurrencyCode = 'QAR',
  targetCurrency: CurrencyCode = 'EGP',
  lang: Lang = 'en'
): string {
  const source = getLocalizedCurrencyName(sourceCurrency, lang);
  const target = getLocalizedCurrencyName(targetCurrency, lang);
  const formattedRate = typeof rate === 'number' ? rate.toFixed(4) : String(rate);
  return `1 ${source} = ${formattedRate} ${target}`;
}

/**
 * Get currency symbol for display
 */
export function getCurrencySymbol(code: CurrencyCode, lang: Lang = 'en'): string {
  const symbolMap: Record<CurrencyCode, string> = {
    QAR: lang === 'ar' ? 'ر.ق' : 'QAR',
    EGP: lang === 'ar' ? 'ج.م' : 'EGP',
    USD: '$',
    USDT: '₮',
    AED: 'د.إ',
    SAR: '﷼',
  };
  return symbolMap[code] ?? code;
}
