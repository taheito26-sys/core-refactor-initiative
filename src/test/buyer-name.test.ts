import { describe, expect, it } from 'vitest';
import { isFullBuyerName, isMeaningfulBuyerName, normalizeBuyerName } from '@/lib/buyer-name';
import { resolveCustomerName, customerNameVariants, type Customer, type Trade } from '@/lib/tracker-helpers';
import { hasSavedOrderBuyer, assertSavedOrderBuyers } from '@/features/orders/utils/order-buyer';
import { resolveCustomerLabel } from '@/features/merchants/lib/customer-labels';

const customer = { id: 'buyer', name: 'Mohamed Al-Damrawy' } as Customer;

describe('buyer naming rules', () => {
  it.each(['', '  ', '—', '–', '- -', '―', '−', '___', '...', '\u200b—\u200b', '\u200b', '12345', '+974 5555 5555', 'unknown', 'N/A', 'OKX P2P', 'Client #ABCDEF12'])("rejects placeholder '%s'", value => {
    expect(isMeaningfulBuyerName(value)).toBe(false);
    expect(isFullBuyerName(value)).toBe(false);
  });
  it.each(['Mohamed Al-Damrawy', 'محمد الدمراوي', "Anne O'Neill", 'Jean-Luc Martin'])('accepts a full name: %s', value => {
    expect(isFullBuyerName(value)).toBe(true);
  });
  it('requires a full new name while allowing an established existing name', () => {
    expect(isFullBuyerName('Aly')).toBe(false);
    expect(hasSavedOrderBuyer([{ ...customer, name: 'Aly' }], customer.id)).toBe(true);
    expect(normalizeBuyerName('  Mohamed\u200b   Al-Damrawy  ')).toBe('Mohamed Al-Damrawy');
  });
  it('never lets a placeholder translation mask a real identity name in either language', () => {
    const saved = { ...customer, nameEn: '—', nameAr: '- -' };
    expect(resolveCustomerName(saved, 'en')).toBe(customer.name);
    expect(resolveCustomerName(saved, 'ar')).toBe(customer.name);
    expect(customerNameVariants(saved)).toEqual([customer.name]);
    expect(saved.name).toBe(customer.name);
  });
  it('uses a valid translated name without rewriting the original identity key', () => {
    const saved = { ...customer, name: '—', nameEn: 'Mohamed Al-Damrawy' };
    expect(hasSavedOrderBuyer([saved], saved.id)).toBe(true);
    expect(resolveCustomerName(saved, 'ar')).toBe('Mohamed Al-Damrawy');
    expect(saved.name).toBe('—');
  });
  it('rejects an order whose saved buyer only has placeholders in every language', () => {
    const saved = { ...customer, name: '- -', nameEn: '\u200b', nameAr: '—' };
    const trade = { id: 'order', customerId: saved.id } as Trade;
    expect(() => assertSavedOrderBuyers({ customers: [], trades: [] }, { customers: [saved], trades: [trade] })).toThrow('buyer');
  });
  it('skips an invalid connected-profile display name before choosing the real saved name', () => {
    expect(resolveCustomerLabel({ displayName: '—', name: customer.name, customerUserId: 'id' })).toBe(customer.name);
  });
});
