import { describe, expect, it } from 'vitest';
import { STOCK_CASH_ROUTE } from '@/lib/navigation-routes';

describe('dashboard cash route', () => {
  it('deep links to stock cash tab', () => {
    expect(STOCK_CASH_ROUTE).toBe('/trading/stock?tab=cash');
  });
});
