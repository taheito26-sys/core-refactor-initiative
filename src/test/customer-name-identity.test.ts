import { describe, it, expect } from 'vitest';
import { customerNameVariants, resolveCustomerName, type Customer } from '@/lib/tracker-helpers';
import { canonicalizeName } from '@/lib/text-normalize';

const buyer = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1',
  name: 'Mohamed Al-Damrawy',
  phone: '',
  tier: 'C',
  dailyLimitUSDT: 0,
  notes: '',
  createdAt: 0,
  ...over,
});

/**
 * Stands in for the lookup `ensureCustomer` does when a merchant types a buyer
 * name on the order form: whichever spelling is typed has to land on the
 * buyer's existing record, because a miss silently creates a second customer
 * whose orders the buyer's own portal statement link never covers.
 */
const findByTypedName = (customers: Customer[], typed: string) =>
  customers.find(c => customerNameVariants(c).some(v => canonicalizeName(v) === canonicalizeName(typed)));

describe('customerNameVariants', () => {
  it('lists every name a buyer is known by, skipping blanks', () => {
    expect(customerNameVariants(buyer({ nameEn: 'Mohamed Al-Damrawy', nameAr: 'محمد الدمراوي' })))
      .toEqual(['Mohamed Al-Damrawy', 'Mohamed Al-Damrawy', 'محمد الدمراوي']);
    expect(customerNameVariants(buyer({ nameEn: '', nameAr: '   ' }))).toEqual(['Mohamed Al-Damrawy']);
  });
});

describe('buyer identity lookup by typed name', () => {
  it('matches a buyer from either language once both names are on file', () => {
    const customers = [buyer({ nameEn: 'Mohamed Al-Damrawy', nameAr: 'محمد الدمراوي' })];
    expect(findByTypedName(customers, 'Mohamed Al-Damrawy')?.id).toBe('c1');
    expect(findByTypedName(customers, 'محمد الدمراوي')?.id).toBe('c1');
  });

  it('still matches the English name when the legacy name holds the Arabic spelling', () => {
    // The shape that caused the production split: `name` had been repointed to
    // the Arabic spelling, so a lookup against `name` alone missed entirely and
    // every new order started a second customer record.
    const customers = [buyer({ name: 'محمد الدمراوي', nameEn: 'Mohamed Al-Damrawy', nameAr: 'محمد الدمراوي' })];
    expect(findByTypedName(customers, 'Mohamed Al-Damrawy')?.id).toBe('c1');
  });

  it('is insensitive to case and surrounding whitespace', () => {
    const customers = [buyer({ nameEn: 'Mohamed Al-Damrawy' })];
    expect(findByTypedName(customers, '  mohamed al-damrawy  ')?.id).toBe('c1');
  });

  it('does not match an unrelated buyer', () => {
    const customers = [buyer({ nameEn: 'Mohamed Al-Damrawy', nameAr: 'محمد الدمراوي' })];
    expect(findByTypedName(customers, 'Ahmed Al-Rashid')).toBeUndefined();
  });
});

describe('resolveCustomerName', () => {
  it('prefers the active language, then the other language, then the legacy name', () => {
    const both = buyer({ nameEn: 'Mohamed Al-Damrawy', nameAr: 'محمد الدمراوي' });
    expect(resolveCustomerName(both, 'ar')).toBe('محمد الدمراوي');
    expect(resolveCustomerName(both, 'en')).toBe('Mohamed Al-Damrawy');

    const arabicOnly = buyer({ nameAr: 'محمد الدمراوي' });
    expect(resolveCustomerName(arabicOnly, 'en')).toBe('محمد الدمراوي');

    const legacyOnly = buyer();
    expect(resolveCustomerName(legacyOnly, 'ar')).toBe('Mohamed Al-Damrawy');
  });
});
