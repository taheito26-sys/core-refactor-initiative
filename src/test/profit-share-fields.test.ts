import { describe, expect, it } from 'vitest';
import { buildSharedProfitShareFields, parseInvestedCapital } from '@/lib/profit-share-fields';

describe('profit-share shared fields', () => {
  it('builds standard payload with invested capital + settlement way', () => {
    const result = buildSharedProfitShareFields({
      agreementType: 'standard',
      investedCapitalRaw: '12500.50',
      settlementWay: 'withdraw',
    });

    expect(result.investedCapital).toBe(12500.5);
    expect(result.settlementWay).toBe('withdraw');
  });

  it('accepts empty capital as zero for legacy-safe create/edit', () => {
    expect(parseInvestedCapital('')).toBe(0);
    expect(parseInvestedCapital('   ')).toBe(0);
  });

  it('rejects negative or malformed invested capital', () => {
    expect(() => parseInvestedCapital('-1')).toThrow(/non-negative/);
    expect(() => parseInvestedCapital('abc')).toThrow(/non-negative/);
  });

  it('operator-priority shared field handling remains valid', () => {
    const result = buildSharedProfitShareFields({
      agreementType: 'operator_priority',
      investedCapitalRaw: '40000',
      settlementWay: 'reinvest',
    });

    expect(result).toEqual({ investedCapital: 40000, settlementWay: 'reinvest' });
  });
});
