import { describe, expect, it } from 'vitest';
import { applyLineOffsets, applyOpeningOverride, type MonthPosition, type NetPosition } from '@/lib/trading/net-position';
import { MANUAL_LINE_KEYS, NET_POSITION_START, liveOffsetsFor, manualOpeningTotal, offsetsFor, offsetsFromManual, recordedLineValue, type OpeningOverride } from '@/features/net-position/overrides';

const pos = (lines: Array<{ key: string; side: 'asset' | 'liability'; amountQAR: number }>): NetPosition => {
  const assets = lines.filter(l => l.side === 'asset').reduce((s, l) => s + l.amountQAR, 0);
  const liabilities = lines.filter(l => l.side === 'liability').reduce((s, l) => s + l.amountQAR, 0);
  return { lines, assetsQAR: assets, liabilitiesQAR: liabilities, netQAR: assets - liabilities } as unknown as NetPosition;
};

describe('applyLineOffsets', () => {
  it('moves a line, adds a missing one, and recomputes the totals', () => {
    const p = applyLineOffsets(pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1000 }]), { cash_hand: 500, exchange_usdt: 200, manual_other: 999 });
    expect(p.lines.find(l => l.key === 'cash_hand')?.amountQAR).toBe(1500);
    expect(p.lines.find(l => l.key === 'exchange_usdt')?.amountQAR).toBe(200)
    expect(p.lines.find(l => l.key === 'manual_other')).toBeUndefined();
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
  const recorded = pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1000 }, { key: 'customer_loans', side: 'asset', amountQAR: 300 }]);

  it('reads what the records say a line was', () => {
    expect(recordedLineValue(recorded, 'cash_hand')).toBe(1000);
    expect(recordedLineValue(recorded, 'customer_loans')).toBe(300);
    expect(recordedLineValue(recorded, 'personal_loans')).toBe(0);
  });

  it('turns what was typed into offsets from the records', () => {
    const offsets = offsetsFromManual(recorded, { cash_hand: 1500, customer_loans: 100, personal_loans: 800, manual_other: 0 });
    expect(offsets).toEqual({ cash_hand: 500, customer_loans: -200, personal_loans: 800 });
    const adjusted = applyLineOffsets(recorded, offsets);
    expect(adjusted.netQAR).toBe(recorded.netQAR + 500 - 200 + 800);
  });

  it('totals an entered position', () => {
    expect(manualOpeningTotal({ cash_hand: 1000, customer_loans: 500, manual_other: -200 })).toBe(1500);
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
    const p = applyLineOffsets(pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1000 }]), { stock: -114856, merchant_lent: 37267, merchant_borrowed: 431, cash_hand: 50 });
    expect(p.lines.map(l => l.key)).toEqual(['cash_hand']);
    expect(p.netQAR).toBe(1050);
  });
});

describe('a position typed by hand stays as typed', () => {
  const override: OpeningOverride = {
    month: '2026-10', manual: { cash_hand: 5000, exchange_usdt: 2000, customer_loans: 0, personal_loans: 0 },
    // Saved when the records said cash was 1000; deliberately stale below.
    offsets: { cash_hand: 4000, exchange_usdt: 2000 }, updatedAt: '',
  };
  const overrides = new Map([[override.month, override]]);

  it('follows today\'s records, so editing an earlier month cannot move the typed opening', () => {
    const before = pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1000 }]);
    const after = pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1800 }]);
    for (const recorded of [before, after]) {
      const live = liveOffsetsFor(overrides, '2026-10', () => recorded)!;
      expect(applyLineOffsets(recorded, live.offsets).lines.find(l => l.key === 'cash_hand')?.amountQAR).toBe(5000);
    }
  });

  it('carries into later months, measured against the records at the moment the figures were saved', () => {
    const asked: number[] = [];
    const live = liveOffsetsFor(overrides, '2026-12', ts => { asked.push(ts); return pos([{ key: 'cash_hand', side: 'asset', amountQAR: 1000 }]); });
    // Nothing was saved with a time, so the first moment of October is the baseline.
    expect(asked).toEqual([new Date(2026, 9, 1).getTime() - 1]);
    expect(live?.from).toBe('2026-10');
    expect(live?.offsets.cash_hand).toBe(4000);
  });

  it('does not apply to an earlier month', () => {
    expect(liveOffsetsFor(overrides, '2026-09', () => pos([]))).toBeNull();
  });
});

describe('a fresh start from October 2026', () => {
  const records = pos([
    { key: 'cash_hand', side: 'asset', amountQAR: 8000 },
    { key: 'cash_bank', side: 'asset', amountQAR: 3000 },
    { key: 'customer_loans', side: 'asset', amountQAR: 500 },
  ]);

  it('starts at the month October 2026 and counts money in banks as a line to type', () => {
    expect(NET_POSITION_START).toBe('2026-10');
    expect(MANUAL_LINE_KEYS).toContain('cash_bank');
    expect(MANUAL_LINE_KEYS).toContain('exchange_usdt');
  });

  it('opens at zero in every line when nothing has been typed, whatever the older records say', () => {
    const live = liveOffsetsFor(new Map(), '2026-10', () => records)!;
    const opening = applyLineOffsets(records, live.offsets);
    expect(opening.netQAR).toBe(0);
    expect(live.from).toBe('2026-10');
  });

  it('ignores every month before October 2026', () => {
    expect(liveOffsetsFor(new Map(), '2026-09', () => records)).toBeNull();
    const sept: OpeningOverride = { month: '2026-09', manual: { cash_hand: 999 }, offsets: {}, updatedAt: '' };
    expect(liveOffsetsFor(new Map([[sept.month, sept]]), '2026-10', () => records)?.from).toBe('2026-10');
  });

  it('keeps the exchange figure out of the closing: opening is typed, closing is the live balance', () => {
    const month = {
      opening: pos([]),
      closing: pos([{ key: 'exchange_usdt', side: 'asset', amountQAR: 5000 }, { key: 'cash_hand', side: 'asset', amountQAR: 700 }]),
      netRevenueQAR: 0, changeQAR: 0, unexplainedQAR: 0,
    } as unknown as MonthPosition;
    const m = applyOpeningOverride(month, { exchange_usdt: 4000, cash_hand: 1000 });
    expect(m.opening.netQAR).toBe(5000);
    // Closing: live exchange balance 5,000 (not 9,000) plus cash 700 + the typed 1,000.
    expect(m.closing.lines.find(l => l.key === 'exchange_usdt')?.amountQAR).toBe(5000);
    expect(m.closing.netQAR).toBe(5000 + 1700);
  });

  it('carries only the cash and loan adjustments into later months', () => {
    const oct: OpeningOverride = { month: '2026-10', manual: { cash_hand: 1000, exchange_usdt: 4000 }, offsets: {}, updatedAt: '' };
    const nov = liveOffsetsFor(new Map([[oct.month, oct]]), '2026-11', () => pos([]))!;
    expect(nov.offsets.exchange_usdt).toBeUndefined();
    expect(nov.offsets.cash_hand).toBe(1000);
  });
});

describe('typing what you have now never doubles what was recorded before saving', () => {
  // Cash was 0 on 1 October, then 125,500 was deposited on 10 October (setting up), and the figure was typed and saved later that day.
  const savedAt = new Date(2026, 9, 10, 18, 0).getTime();
  const override: OpeningOverride = { month: '2026-10', manual: { cash_hand: 125500, cash_bank: 49000 }, offsets: {}, updatedAt: new Date(savedAt).toISOString() };
  const overrides = new Map([[override.month, override]]);
  const firstMoment = new Date(2026, 9, 1).getTime() - 1;
  const at = (ts: number) => (ts <= firstMoment
    ? pos([])
    : pos([{ key: 'cash_hand', side: 'asset', amountQAR: 125500 }, { key: 'cash_bank', side: 'asset', amountQAR: 49000 }]));

  it('opens at the typed figures and closes at them when nothing changed after saving', () => {
    const live = liveOffsetsFor(overrides, '2026-10', at)!;
    const month = { opening: at(firstMoment), closing: at(Date.now()), netRevenueQAR: 0, changeQAR: 0, unexplainedQAR: 0 } as unknown as MonthPosition;
    const m = applyOpeningOverride(month, live.openingOffsets, live.offsets);
    expect(m.opening.netQAR).toBe(125500 + 49000);
    expect(m.closing.netQAR).toBe(125500 + 49000);
    expect(m.changeQAR).toBe(0);
  });

  it('counts only what is recorded after the figures were saved', () => {
    const live = liveOffsetsFor(overrides, '2026-10', at)!;
    const after = (extra: number) => pos([{ key: 'cash_hand', side: 'asset', amountQAR: 125500 + extra }, { key: 'cash_bank', side: 'asset', amountQAR: 49000 }]);
    const month = { opening: at(firstMoment), closing: after(-3000), netRevenueQAR: 0, changeQAR: 0, unexplainedQAR: 0 } as unknown as MonthPosition;
    const m = applyOpeningOverride(month, live.openingOffsets, live.offsets);
    expect(m.closing.netQAR).toBe(125500 + 49000 - 3000);
    expect(m.changeQAR).toBe(-3000);
  });
});
