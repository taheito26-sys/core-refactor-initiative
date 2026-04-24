/**
 * Currency localization utilities
 * Provides localized names for currencies in both English and Arabic
 */

import type { Lang } from './i18n';

export type CurrencyCode = 'QAR' | 'EGP' | 'USD' | 'USDT' | 'AED' | 'SAR';

const currencyNames: Record<CurrencyCode, Record<Lang, string>> = {
  QAR: { en: 'QAR', ar: 'ريال' },
  EGP: { en: 'EGP', ar: 'جنية' },
  USD: { en: 'USD', ar: 'دولار' },
  USDT: { en: 'USDT', ar: 'USDT' },
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
