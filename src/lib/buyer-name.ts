/** Shared by customer forms, order validation, and language-specific display names. */
export function normalizeBuyerName(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim() : '';
}

const placeholders = new Set(['unknown', 'unnamed', 'none', 'null', 'undefined', 'n/a', 'no name', 'no buyer', 'غير معروف', 'بدون اسم', 'binance p2p', 'okx p2p']);

export function isMeaningfulBuyerName(value: unknown): boolean {
  const name = normalizeBuyerName(value);
  return name.length <= 120 && (name.match(/\p{L}/gu)?.length ?? 0) >= 1
    && !placeholders.has(name.toLocaleLowerCase('en'))
    && !/^Client #[\da-f]{8}$/i.test(name)
    && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(name);
}

/** New buyers need a full personal name. Existing named buyers may keep their established spelling. */
export function isFullBuyerName(value: unknown): boolean {
  const name = normalizeBuyerName(value);
  const parts = name.split(' ');
  return isMeaningfulBuyerName(name) && parts.length >= 2
    && parts.every(part => /^\p{L}[\p{L}\p{M}.'’‐‑-]*$/u.test(part));
}
