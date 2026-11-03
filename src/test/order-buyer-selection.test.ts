import { describe, expect, it } from 'vitest';
import { resolveSavedOrderBuyer } from '@/features/orders/utils/order-buyer';
import { materializeListedCustomer, type ListedCustomer } from '@/features/merchants/lib/customer-listing';
import { hasSavedOrderBuyer } from '@/features/orders/utils/order-buyer';
import type { Customer } from '@/lib/tracker-helpers';
const buyer = { id: 'existing', name: 'Mohamed Al-Damrawy', nameAr: 'محمد الدمراوي' } as Customer;
describe('record sale buyer identity', () => {
  it('resolves a prefilled exact saved name without requiring another dropdown click', () => {
    const chosen = resolveSavedOrderBuyer([buyer], ' Mohamed Al-Damrawy ', '');
    expect(chosen?.id).toBe('existing');
    const saved = materializeListedCustomer(chosen!, [buyer]);
    expect(saved.customers).toHaveLength(1);
    expect(hasSavedOrderBuyer(saved.customers, saved.id)).toBe(true);
  });
  it('matches language-specific saved names and ignores case without fuzzy matching', () => {
    expect(resolveSavedOrderBuyer([buyer], 'mohamed al-damrawy')?.id).toBe('existing');
    expect(resolveSavedOrderBuyer([buyer], 'محمد الدمراوي')?.id).toBe('existing');
    expect(resolveSavedOrderBuyer([buyer], 'Mohamed')).toBeNull();
  });
  it('does not invent a buyer for unknown, blank or placeholder names', () => {
    for (const text of ['New Buyer', '', '—', 'OKX P2P']) expect(resolveSavedOrderBuyer([buyer], text)).toBeNull();
  });
  it('requires explicit selection when distinct saved identities share a name', () => {
    const options = [buyer, { ...buyer, id: 'different' }];
    expect(resolveSavedOrderBuyer(options, buyer.name)).toBeNull();
    expect(resolveSavedOrderBuyer(options, buyer.name, 'different')?.id).toBe('different');
  });
  it('uses the existing portal identity for a unique connected buyer', () => {
    const connected = { id: 'list-row', source: 'connected', customerUserId: 'portal-buyer', name: buyer.name } as ListedCustomer;
    const chosen = resolveSavedOrderBuyer([connected], buyer.name);
    expect(materializeListedCustomer(chosen!, []).id).toBe('portal-buyer');
  });
});
