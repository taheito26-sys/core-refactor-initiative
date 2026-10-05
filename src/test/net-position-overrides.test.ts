import { describe, expect, it } from 'vitest';
import { applyLineOffsets, applyOpeningOverride, type MonthPosition, type NetPosition } from '@/lib/trading/net-position';
import { manualOpeningTotal, offsetsFor, offsetsFromManual, recordedLineValue, type OpeningOverride } from '@/features/net-position/overrides';

const pos = (lines: Array<{ key: string; side: 'asset' | 'liability'; amountQAR: number }>): NetPosition => {
  const assets = lines.filter(l => l.side === 'asset').reduce((s, l) => s + l.amountQAR, 0);
  const liabilities = lines.filter(l => l.side === 'liability').reduce((s, l) => s + l.amountQAR, 0);
  return { lines, assetsQAR: assets, liabilitiesQAR: liabilities, netQAR: assets - liabilities } as unknown as NetPosition;
};

describe('applyLineOffsets', () => {
  it('moves a line, adds a missing one, and recomputes the totals', () => {
    const p = applyLineOffsets(pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1000 }]), { cash_hand: 500, manual_other: 200 });
    expect(p.lines.find(l => l.key === 'cash_hand')?.amountQAR).toBe(1500);
    expect(p.lines.find(l => l.key === 'manual_other')?.amountQAR).toBe(200);
    expect(p.netQAR).toBe(1700);
  });
  it('flips a line to a liability when pushed below zero', () => {
    const p = applyLineOffsets(pos([{ key: 'cash_hand', side: 'asset', amountQAR: 100 }]), { cash_hand: -300 });
    expect(p.lines[0]).toMatchObject({ side: 'liability', amountQAR: 200 });
    expect(p.netQAR).toBe(-200);
  });
});

describe('applyOpeningOverride', () => {
  it('shifts opening and closing by the same amount so the change in the month stays as recorded', () => {
    const month = {
      opening: pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1000 }]),
      closing: pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1300 }]),
      netRevenueQAR: 300, changeQAR: 300, unexplainedQAR: 0,
    } as unknown as MonthPosition;
    const m = applyOpeningOverride(month, { cash_hand: 4000 });
    expect(m.opening.netQAR).toBe(5000);
    expect(m.closing.netQAR).toBe(5300);
    expect(m.changeQAR).toBe(300);
    expect(m.unexplainedQAR).toBe(0);
  });
});

describe('entering a position by hand', () => {
  const recorded = pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1000 }, { key: 'merchant_borrowed', side: 'liability', amountQAR: 300 }]);

  it('reads recorded values in the entered form, a debt as a positive amount owed', () => {
    expect(recordedLineValue(recorded, 'cash_hand')).toBe(1000);
    expect(recordedLineValue(recorded, 'merchant_borrowed')).toBe(300);
    expect(recordedLineValue(recorded, 'customer_loans')).toBe(0);
  });

  it('turns what was typed into signed offsets from the records', () => {
    const offsets = offsetsFromManual(recorded, { cash_hand: 1500, merchant_borrowed: 100, customer_loans: 800, manual_other: 0 });
    expect(offsets).toEqual({ cash_hand: 500, merchant_borrowed: 200, customer_loans: 800 });
    // Owing 200 less is worth +200 to the net position.
    const adjusted = applyLineOffsets(recorded, offsets);
    expect(adjusted.netQAR).toBe(recorded.netQAR + 500 + 200 + 800);
  });

  it('totals an entered position as assets minus what is owed', () => {
    expect(manualOpeningTotal({ cash_hand: 1000, customer_loans: 500, merchant_borrowed: 200 })).toBe(1300);
  });
});

describe('offsetsFor', () => {
  const o = (month: string, offsets: OpeningOverride['offsets']): OpeningOverride => ({ month, manual: {}, offsets, updatedAt: '' });
  const map = new Map([['2026-03', o('2026-03', { cash_hand: 100 })], ['2026-06', o('2026-06', { cash_hand: 250 })]]);

  it('uses the latest override set at or before the month, and nothing before the first', () => {
    expect(offsetsFor(map, '2026-02')).toBeNull();
    expect(offsetsFor(map, '2026-03')).toEqual({ offsets: { cash_hand: 100 }, from: '2026-03' });
    expect(offsetsFor(map, '2026-05')?.from).toBe('2026-03');
    expect(offsetsFor(map, '2026-09')).toEqual({ offsets: { cash_hand: 250 }, from: '2026-06' });
  });
});

describe('lines that are no longer counted', () => {
  it('ignores offsets saved earlier for USDT stock and USDT lent', () => {
    const p = applyLineOffsets(pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1000 }]), { stock: -114856, merchant_lent: 37267, cash_hand: 50 });
    expect(p.lines.map(l => l.key)).toEqual(['cash_hand']);
    expect(p.netQAR).toBe(1050);
  });
});
