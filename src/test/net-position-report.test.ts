import { describe, expect, it } from 'vitest';
import { buildNetPositionReportHtml, type NetPositionReportLabels } from '@/features/net-position/report';
import { monthToClose } from '@/features/net-position/reminder';
import { extractReportSheets } from '@/lib/htmlReportToPdf';
import type { MonthBridge, MonthPosition } from '@/lib/trading/net-position';
import type { MonthlySnapshot } from '@/features/net-position/snapshots';

const labels: NetPositionReportLabels = {
  title: 'Net position', statusFrozen: 'Frozen {date}', statusLive: 'Live', opening: 'Opening', closing: 'Closing', change: 'Change',
  revenue: 'Revenue', bridge: 'Bridge', business: 'Business', personal: 'Personal', uncategorised: 'Uncategorised', deposits: 'Deposits',
  adjustments: 'Adjustments', other: 'Other', priorCorrections: 'Corrections', breakdown: 'Breakdown', assets: 'Assets', liabilities: 'Liabilities',
  rates: 'Rates', usdRate: 'USD', usdtRate: 'USDT', egpRate: 'EGP', footer: 'f', generatedOn: 'on',
  lines: { cash_hand: 'Hand', cash_bank: 'Bank', cash_vault: 'Vault', cash_custody: 'Custody', usdt_in_accounts: 'USDT', stock: 'Stock', customer_loans: 'Loans', merchant_lent: 'Lent', merchant_borrowed: 'Owed' },
  categories: { rent: 'Rent', owner_draw: 'Owner draw' },
};
const pos = (net: number, lines: Array<{ key: string; side: 'asset' | 'liability'; amountQAR: number }>) =>
  ({ netQAR: net, assetsQAR: net, liabilitiesQAR: 0, lines, usdToQar: 3.6, usdtRateQAR: 3.6, egpPerUsdt: 50, warnings: [] });
const month = { key: '2026-09', opening: pos(100, [{ key: 'cash_hand', side: 'asset', amountQAR: 100 }]), closing: pos(110, [{ key: 'cash_hand', side: 'asset', amountQAR: 110 }]) } as unknown as MonthPosition;
const bridge = {
  openingQAR: 100, netRevenueQAR: 20, business: [{ key: 'rent', amountQAR: 6 }], businessTotalQAR: 6,
  personal: [{ key: 'owner_draw', amountQAR: 4 }], personalTotalQAR: 4, uncategorisedQAR: 0, uncategorisedCount: 0,
  depositsQAR: 0, adjustmentsInQAR: 0, otherQAR: 0, closingQAR: 110,
} as unknown as MonthBridge;
const base = { labels, monthLabel: 'September 2026', month, bridge, dir: 'ltr' as const, generatedOn: 'today' };

describe('buildNetPositionReportHtml', () => {
  it('is one printable sheet with the bridge, categories kept apart, and the frozen status', () => {
    const html = buildNetPositionReportHtml({ ...base, frozenAt: '2026-10-02' });
    expect(extractReportSheets(html).sheets).toHaveLength(1);
    expect(html).toContain('Frozen 2026-10-02');
    expect(html).toContain('Rent');
    expect(html).toContain('Owner draw');
    expect(html).toContain('+10');
    expect(html).not.toMatch(/:root\s*\{/);
  });

  it('escapes text coming from labels and says when the figures are live', () => {
    const html = buildNetPositionReportHtml({ ...base, frozenAt: null, businessName: '<b>Shop & Co</b>' });
    expect(html).toContain('&lt;b&gt;Shop &amp; Co&lt;/b&gt;');
    expect(html).toContain('Live');
  });
});

describe('monthToClose', () => {
  const now = new Date(2026, 9, 3, 12).getTime();
  const sept = new Date(2026, 8, 15, 12).getTime();
  const withActivity = { batches: [], trades: [], cashLedger: [{ ts: sept }] } as never;
  const frozen = { frozen: true } as MonthlySnapshot;

  it('asks to close last month when it had activity and is not frozen', () => {
    expect(monthToClose(withActivity, new Map(), now)).toBe('2026-09');
  });
  it('stays quiet when last month is already frozen, or had nothing in it', () => {
    expect(monthToClose(withActivity, new Map([['2026-09', frozen]]), now)).toBeNull();
    expect(monthToClose({ batches: [], trades: [], cashLedger: [] } as never, new Map(), now)).toBeNull();
  });
  it('still asks for a month that was re-opened', () => {
    expect(monthToClose(withActivity, new Map([['2026-09', { frozen: false } as MonthlySnapshot]]), now)).toBe('2026-09');
  });
});
