import { describe, expect, it } from 'vitest';
import { canSaveOrderBuyer, materializeOrderBuyer, resolveSavedOrderBuyer } from '@/features/orders/utils/order-buyer';
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

describe('saving a typed order buyer', () => {
  it('creates a Binance username and saves a valid buyer for the order without Add', () => {
    const saved = materializeOrderBuyer([], '  DesertWolf72  ', '', []);
    expect(saved.id).toBeTruthy();
    expect(saved.customers).toHaveLength(1);
    expect(saved.customers[0].name).toBe('DesertWolf72');
    expect(hasSavedOrderBuyer(saved.customers, saved.id)).toBe(true);
    const again = materializeOrderBuyer(saved.customers, 'desertwolf72', '', saved.customers);
    expect(again.id).toBe(saved.id);
    expect(again.customers).toHaveLength(1);
  });
  it('keeps an existing buyer and connected portal identity', () => {
    expect(materializeOrderBuyer([buyer], 'محمد الدمراوي', '', [buyer]).id).toBe('existing');
    const connected = { id: 'row', source: 'connected', customerUserId: 'portal', name: 'DesertWolf72' } as ListedCustomer;
    expect(materializeOrderBuyer([connected], 'DesertWolf72', '', []).id).toBe('portal');
  });
  it('rejects empty and placeholder names, and requires a choice for duplicate saved names', () => {
    for (const text of ['', '  ', '—', 'Binance P2P', 'OKX P2P']) {
      expect(canSaveOrderBuyer([], text)).toBe(false);
      expect(materializeOrderBuyer([], text, '', []).id).toBe('');
    }
    const options = [buyer, { ...buyer, id: 'duplicate' }];
    expect(canSaveOrderBuyer(options, buyer.name)).toBe(false);
    expect(materializeOrderBuyer(options, buyer.name, '', options).id).toBe('');
    expect(materializeOrderBuyer(options, buyer.name, 'duplicate', options).id).toBe('duplicate');
  });
  it('saves two typed split buyers and preserves previously created buyers', () => {
    const first = materializeOrderBuyer([], 'DesertWolf72', '', []);
    const second = materializeOrderBuyer([], 'AnotherBuyer', '', first.customers);
    expect(second.id).not.toBe(first.id);
    expect(second.customers).toHaveLength(2);
    expect(materializeOrderBuyer([], 'DesertWolf72', '', second.customers).id).toBe(first.id);
  });
});
