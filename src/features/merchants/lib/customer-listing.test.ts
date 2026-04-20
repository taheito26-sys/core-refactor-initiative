import { describe, expect, it } from 'vitest';
import { resolveCustomerLabel } from './customer-labels';
import { mapConnectedCustomers, mergeListedCustomers } from './customer-listing';

describe('customer listing helpers', () => {
  it('maps connected customer rows to visible buyer options', () => {
    const [row] = mapConnectedCustomers([
      {
        customer_user_id: 'user-123',
        nickname: 'Farida',
        created_at: '2026-04-20T00:00:00.000Z',
      },
    ]);

    expect(row).toMatchObject({
      id: 'connected:user-123',
      name: 'Farida',
      source: 'connected',
      customerUserId: 'user-123',
    });
  });

  it('falls back to the customer uid when there is no nickname', () => {
    const [row] = mapConnectedCustomers([
      {
        customer_user_id: 'user-456',
        created_at: '2026-04-20T00:00:00.000Z',
      },
    ]);

    expect(row.name).toBe('user-456');
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

  it('keeps connected customers in the merged list ahead of local rows', () => {
    const merged = mergeListedCustomers(
      [
        { id: 'local-1', name: 'Mohamed Taha', phone: '123', tier: 'A', dailyLimitUSDT: 0, notes: '', createdAt: 1, source: 'local' },
        { id: 'local-2', name: 'Same Name', phone: '456', tier: 'B', dailyLimitUSDT: 0, notes: '', createdAt: 2, source: 'local' },
      ],
      [
        { id: 'connected:user-123', name: 'Same Name', phone: '', tier: 'C', dailyLimitUSDT: 0, notes: '', createdAt: 3, source: 'connected', customerUserId: 'user-123' },
      ],
    );

    expect(merged.map((row) => row.id)).toEqual(['connected:user-123', 'local-1']);
    expect(merged[0]).toMatchObject({
      id: 'connected:user-123',
      name: 'Same Name',
      source: 'connected',
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
      id: 'connected:user-789',
      name: 'Rakan Abd',
      phone: '555-2222',
      notes: 'Cairo',
    });
  });
});
