// ─── Bank balance cache ───
// Latest remaining balance reported by each bank account via SMS. Only the
// parsed numbers are stored; the SMS text itself is never persisted.

import { parseBalanceSms, type ParsedBalance, type RawSms } from './parser';

export interface BankBalanceEntry extends ParsedBalance {
  key: string;
  /** When the cache last wrote this entry. */
  updatedAt: number;
}

export type BankBalanceCache = Record<string, BankBalanceEntry>;

const STORAGE_KEY = 'bank-sms-balance-cache:v1';

export function balanceKey(p: Pick<ParsedBalance, 'sender' | 'last4' | 'currency'>): string {
  return [p.sender.toLowerCase(), p.last4, p.currency].join('|');
}

/** Newest SMS wins; an older or equal-age message never overwrites a newer one. */
export function applyBalance(cache: BankBalanceCache, parsed: ParsedBalance, now = Date.now()): BankBalanceCache {
  const key = balanceKey(parsed);
  const existing = cache[key];
  if (existing && existing.smsTimestamp >= parsed.smsTimestamp) return cache;
  return { ...cache, [key]: { ...parsed, key, updatedAt: now } };
}

export function applySmsBatch(cache: BankBalanceCache, messages: RawSms[], now = Date.now()): BankBalanceCache {
  let next = cache;
  for (const sms of messages) {
    const parsed = parseBalanceSms(sms);
    if (parsed) next = applyBalance(next, parsed, now);
  }
  return next;
}

export function latestSmsTimestamp(cache: BankBalanceCache): number {
  return Object.values(cache).reduce((max, e) => Math.max(max, e.smsTimestamp), 0);
}

export function loadCache(): BankBalanceCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCache(cache: BankBalanceCache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage can be unavailable or full; the cache is rebuilt from the inbox.
  }
}
