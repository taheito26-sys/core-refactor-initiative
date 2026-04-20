import { describe, expect, it } from 'vitest';
import { resolveCustomerLabel } from './customer-labels';
import { mapConnectedCustomers, materializeListedCustomer, mergeListedCustomers } from './customer-listing';

describe('customer listing helpers', () => {
  it('uses customer profile display name before nickname and uid', () => {
    const rows = mapConnectedCustomers(
      [{ customer_user_id: 'abc-123', nickname: 'nick', created_at: '2026-04-20T00:00:00.000Z' }],
      new Map([
        ['abc-123', { user_id: 'abc-123', display_name: 'Mohamed Taha', phone: '+974 5555 5555' }],
      ]),
    );

    expect(rows[0]).toMatchObject({
      id: 'abc-123',
      name: 'Mohamed Taha',
      phone: '+974 5555 5555',
      customerUserId: 'abc-123',
    });
  });

  it('falls back to customer_user_id when no name fields exist', () => {
    const rows = mapConnectedCustomers([{ customer_user_id: 'abc-123', created_at: '2026-04-20T00:00:00.000Z' }]);
    expect(rows[0].name).toBe('abc-123');
  });

  it('never returns an empty customer label', () => {
    const label = resolveCustomerLabel({
      displayName: null,
      name: null,
      nickname: null,
      customerUserId: 'abc-123',
    });

    expect(label).toBe('abc-123');
  });

  it('skips blank display names and keeps the next fallback', () => {
    const label = resolveCustomerLabel({
      displayName: '   ',
      name: 'Mohamed Saeed',
      nickname: 'nick',
      customerUserId: 'abc-123',
    });

    expect(label).toBe('Mohamed Saeed');
  });

  it('keeps connected customers when merging and dedupes by name', () => {
    const merged = mergeListedCustomers(
      [{ id: 'local-1', name: 'Mohamed Taha', phone: '', tier: 'C', dailyLimitUSDT: 0, notes: '', createdAt: 1 }],
      [{ id: 'user-123', name: 'Mohamed Taha', phone: '', tier: 'C', dailyLimitUSDT: 0, notes: '', createdAt: 2, source: 'connected', customerUserId: 'user-123' }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('user-123');
  });

  it('preserves local metadata when a connected customer shares the same name', () => {
    const merged = mergeListedCustomers(
      [
        {
          id: 'local-1',
          name: 'Rakan',
          phone: '555-0101',
          tier: 'A',
          dailyLimitUSDT: 250,
          notes: 'VIP',
          createdAt: 1,
          source: 'local',
        },
      ],
      [
        {
          id: 'user-123',
          name: 'Rakan',
          phone: '',
          tier: 'C',
          dailyLimitUSDT: 0,
          notes: '',
          createdAt: 3,
          source: 'connected',
          customerUserId: 'user-123',
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'user-123',
      name: 'Rakan',
      source: 'connected',
      phone: '555-0101',
      tier: 'A',
      dailyLimitUSDT: 250,
      notes: 'VIP',
    });
  });

  it('materializes connected customers into the same normal customer shape', () => {
    const result = materializeListedCustomer(
      {
        id: 'user-123',
        name: 'Connected Buyer',
        phone: '+974 5555',
        tier: 'C',
        dailyLimitUSDT: 0,
        notes: 'Doha',
        createdAt: 123,
        source: 'connected',
        customerUserId: 'user-123',
      },
      [],
    );

    expect(result).toEqual({
      id: 'user-123',
      customers: [
        {
          id: 'user-123',
          name: 'Connected Buyer',
          phone: '+974 5555',
          tier: 'C',
          dailyLimitUSDT: 0,
          notes: 'Doha',
          createdAt: 123,
        },
      ],
    });
  });

  it('uses profile metadata when mapping connected customers', () => {
    const [row] = mapConnectedCustomers(
      [
        {
          customer_user_id: 'user-789',
          nickname: 'Rakan',
          created_at: '2026-04-20T00:00:00.000Z',
        },
      ],
      new Map([
        ['user-789', {
          user_id: 'user-789',
          display_name: 'Rakan Abd',
          name: 'Rakan',
          phone: '555-2222',
          region: 'Cairo',
          country: 'Egypt',
        }],
      ]),
    );

    expect(row).toMatchObject({
      id: 'user-789',
      name: 'Rakan Abd',
      phone: '555-2222',
      notes: 'Cairo',
    });
  });

  it('preserves local metadata when a connected customer shares the same name', () => {
    const merged = mergeListedCustomers(
      [
        {
          id: 'local-1',
          name: 'Rakan',
          phone: '555-0101',
          tier: 'A',
          dailyLimitUSDT: 250,
          notes: 'VIP',
          createdAt: 1,
          source: 'local',
        },
      ],
      [
        {
          id: 'connected:user-123',
          name: 'Rakan',
          phone: '',
          tier: 'C',
          dailyLimitUSDT: 0,
          notes: '',
          createdAt: 3,
          source: 'connected',
          customerUserId: 'user-123',
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'connected:user-123',
      name: 'Rakan',
      source: 'connected',
      phone: '555-0101',
      tier: 'A',
      dailyLimitUSDT: 250,
      notes: 'VIP',
    });
  });

  it('uses profile metadata when mapping connected customers', () => {
    const [row] = mapConnectedCustomers(
      [
        {
          customer_user_id: 'user-789',
          nickname: 'Rakan',
          created_at: '2026-04-20T00:00:00.000Z',
        },
      ],
      new Map([
        ['user-789', {
          user_id: 'user-789',
          display_name: 'Rakan Abd',
          name: 'Rakan',
          phone: '555-2222',
          region: 'Cairo',
          country: 'Egypt',
        }],
      ]),
    );

    expect(row).toMatchObject({
      id: 'user-789',
      name: 'Rakan Abd',
      phone: '555-2222',
      notes: 'Cairo',
    });
  });
});
