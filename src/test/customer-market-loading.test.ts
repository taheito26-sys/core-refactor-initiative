import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reads, invoke } = vi.hoisted(() => ({ reads: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      let market = '';
      const query = {
        select: () => query,
        eq: (_key: string, value: string) => { market = value; return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          reads(market);
          return { data: {
            market, fetched_at: new Date().toISOString(),
            data: market === 'qatar' ? { sellAvg: 4 } : { buyAvg: 60, emergencyAvg: 59 },
          }, error: null };
        },
      };
      return query;
    },
    functions: { invoke },
  },
}));

import { getCustomerMarketKpis } from '@/features/customer/customer-market';

describe('customer market loading', () => {
  beforeEach(() => { reads.mockClear(); invoke.mockClear(); });

  it('checks freshness once and derives all cards and guide from the same new reads', async () => {
    const result = await getCustomerMarketKpis();
    expect(result.guide.rate).toBe(15);
    expect(result.egypt?.buyAvg).toBe(60);
    expect(result.egypt?.emergencyAvg).toBe(59);
    expect(reads).toHaveBeenCalledTimes(4);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('performs new reads on each call rather than reusing a saved response', async () => {
    await getCustomerMarketKpis();
    await getCustomerMarketKpis();
    expect(reads).toHaveBeenCalledTimes(8);
  });
});
