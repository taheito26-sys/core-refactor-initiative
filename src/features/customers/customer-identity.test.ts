import { describe, expect, it } from 'vitest';
import type { Customer } from '@/lib/tracker-helpers';
import {
  customerHistoryCount,
  customerIdGroup,
  resolveCustomerPortalLinks,
  resolveCustomerPortalUserId,
  resolveTradePortalUserId,
  unlinkedPortalConnections,
} from './customer-identity';

const PORTAL_A = '11111111-1111-4111-8111-111111111111';
const PORTAL_B = '22222222-2222-4222-8222-222222222222';
const PORTAL_C = '33333333-3333-4333-8333-333333333333';

const cust = (id: string, name: string, extra: Partial<Customer> = {}): Customer => ({
  id, name, phone: '', tier: 'C', dailyLimitUSDT: 0, notes: '', createdAt: 0, ...extra,
});

describe('resolveCustomerPortalLinks', () => {
  it('uses the explicit portalUserId written when the merchant created the login', () => {
    const customers = [cust('local-1', 'Ahmed', { portalUserId: PORTAL_A })];
    // Portal display name differs from the merchant's spelling -- the
    // explicit link must not depend on names at all.
    const links = resolveCustomerPortalLinks(customers, [{ customerUserId: PORTAL_A, name: 'Ahmad K.' }]);
    expect(links.get('local-1')).toBe(PORTAL_A);
  });

  it('uses the server-side merchant_customer_id link', () => {
    const customers = [cust('local-1', 'Ahmed')];
    const links = resolveCustomerPortalLinks(customers, [
      { customerUserId: PORTAL_A, name: 'Someone else', merchantCustomerId: 'local-1' },
    ]);
    expect(links.get('local-1')).toBe(PORTAL_A);
  });

  it('links a record materialized from a portal account (id is the portal UUID)', () => {
    const customers = [cust(PORTAL_B, 'Hatem')];
    const links = resolveCustomerPortalLinks(customers, [{ customerUserId: PORTAL_B, name: 'Hatem' }]);
    expect(links.get(PORTAL_B)).toBe(PORTAL_B);
  });

  it('falls back to an unambiguous name match for legacy pairs, in either language', () => {
    const customers = [cust('local-1', 'Mohamed Taha', { nameAr: 'محمد طه' })];
    const links = resolveCustomerPortalLinks(customers, [{ customerUserId: PORTAL_C, name: 'محمد طه' }]);
    expect(links.get('local-1')).toBe(PORTAL_C);
  });

  it('does not guess when two portal accounts share a name', () => {
    const customers = [cust('local-1', 'Ali')];
    const links = resolveCustomerPortalLinks(customers, [
      { customerUserId: PORTAL_A, name: 'Ali' },
      { customerUserId: PORTAL_B, name: 'Ali' },
    ]);
    expect(links.has('local-1')).toBe(false);
  });

  it('does not let a name lookalike claim an account explicitly linked elsewhere', () => {
    const customers = [
      cust('local-1', 'Ahmed Original', { portalUserId: PORTAL_A }),
      cust('local-2', 'Ahmed'),
    ];
    const links = resolveCustomerPortalLinks(customers, [{ customerUserId: PORTAL_A, name: 'Ahmed' }]);
    expect(links.get('local-1')).toBe(PORTAL_A);
    expect(links.has('local-2')).toBe(false);
  });

  it('drops a link whose connection is gone or blocked', () => {
    const customers = [cust('local-1', 'Ahmed', { portalUserId: PORTAL_A })];
    expect(resolveCustomerPortalLinks(customers, []).size).toBe(0);
  });
});

describe('resolveTradePortalUserId', () => {
  it('routes a trade on a duplicate record of a linked buyer to the same portal', () => {
    const customers = [
      cust('local-1', 'Damrawy', { portalUserId: PORTAL_A }),
      cust('local-dup', 'damrawy '),
    ];
    const links = resolveCustomerPortalLinks(customers, [{ customerUserId: PORTAL_A, name: 'Mohamed Al-Damrawy' }]);
    expect(resolveTradePortalUserId({ customerId: 'local-dup' }, customers, links)).toBe(PORTAL_A);
  });

  it('honours an explicit connectedCustomerId already on the trade', () => {
    expect(resolveTradePortalUserId({ customerId: 'x', connectedCustomerId: PORTAL_B }, [], new Map())).toBe(PORTAL_B);
  });

  it('returns null for an unlinked buyer', () => {
    const customers = [cust('local-1', 'Rakan')];
    expect(resolveTradePortalUserId({ customerId: 'local-1' }, customers, new Map())).toBeNull();
    expect(resolveCustomerPortalUserId(customers, new Map(), '')).toBeNull();
  });
});

describe('customer directory helpers', () => {
  it('lists only portal accounts no record is linked to', () => {
    const connections = [
      { customerUserId: PORTAL_A, name: 'Ahmed' },
      { customerUserId: PORTAL_B, name: 'New buyer' },
    ];
    const links = new Map([['local-1', PORTAL_A]]);
    expect(unlinkedPortalConnections(connections, links).map(c => c.customerUserId)).toEqual([PORTAL_B]);
  });

  it('groups records of the same buyer by any name variant', () => {
    const customers = [cust('a', 'Ahmed', { nameAr: 'أحمد' }), cust('b', 'أحمد'), cust('c', 'Other')];
    expect([...customerIdGroup(customers, 'a')].sort()).toEqual(['a', 'b']);
  });

  it('counts the history recorded under exactly this record', () => {
    const state = {
      trades: [{ customerId: 'a' }, { customerId: 'a' }, { customerId: 'b' }],
      customerLoans: [{ customerId: 'a' }],
    };
    expect(customerHistoryCount(state, 'a')).toEqual({ trades: 2, loans: 1 });
    expect(customerHistoryCount(state, 'z')).toEqual({ trades: 0, loans: 0 });
  });
});
