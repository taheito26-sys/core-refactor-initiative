import type { PaymentMethodCategory } from '../types';

const VODAFONE_RE = /vodafone/i;
const INSTAPAY_RE = /instapay/i;
const BANK_RE = /bank|banque|cib|ahli|misr|account|transfer/i;
const WALLET_RE = /wallet|محفظة|fawry|we\s*pay|orange|etisalat|cash/i;

export function normalizePaymentMethodLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ');
}

export function classifyPaymentMethods(methods: string[]): PaymentMethodCategory[] {
  const categories = new Set<PaymentMethodCategory>();
  for (const raw of methods) {
    const m = normalizePaymentMethodLabel(raw);
    if (!m) continue;
    if (VODAFONE_RE.test(m)) { categories.add('vodafone_cash'); continue; }
    if (INSTAPAY_RE.test(m)) { categories.add('instapay'); continue; }
    if (BANK_RE.test(m)) { categories.add('bank'); continue; }
    if (WALLET_RE.test(m)) { categories.add('wallet'); continue; }
    categories.add('other');
  }
  return Array.from(categories);
}
