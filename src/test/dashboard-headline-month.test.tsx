import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardHome } from '@/features/dashboard/components/home/DashboardHome';
import { rangeWindow, type DashPoint } from '@/features/dashboard/dashboard-model';
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/features/dashboard/components/home/ProfitTrendCard', () => ({ ProfitTrendCard: () => null }));
vi.mock('@/features/dashboard/components/home/DashboardSheets', () => ({ DashboardFilterSheet: () => null, DashboardSearchSheet: () => null }));
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('monthly headline KPI rendering', () => {
  it('shows November values against full October totals even when the toolbar range is 30D', () => {
    const now = new Date(2026, 10, 1, 22).getTime();
    const point = (ts: number, vol: number, net: number): DashPoint => ({ ts, vol, net, fullNet: net, own: true, client: 'Buyer' });
    const points = [point(new Date(2026, 9, 31).getTime(), 1100000, 30000), point(new Date(2026, 10, 1, 14).getTime(), 21892, 685)];
    const { container } = render(<DashboardHome points={points} allPoints={points} now={now} win={rangeWindow('30d', now, null)} rangeText="selected period" comparisonText="vs previous period" lang="en" money={String} parts={n => ({ n: n.toLocaleString('en-US'), u: 'QAR' })} tiles={[]} moreTiles={[]} fees={0} cash={{ total: '0', unit: 'QAR', counted: 0, active: 0, accounts: [] }} onGo={() => {}} />);
    const cards = container.querySelectorAll('.dh-stat');
    expect(cards[0].textContent).toContain('21,892');
    expect(cards[0].textContent).toContain('-98.0%');
    expect(cards[0].textContent).toContain('Oct 26 total: 1,100,000 QAR');
    expect(cards[1].textContent).toContain('685');
    expect(cards[1].textContent).toContain('-97.7%');
    expect(cards[1].textContent).toContain('Oct 26 total: 30,000 QAR');
    expect(cards[1].textContent).toContain('Nov 26 so far vs Oct 26 in full');
  });
  it('ranks clients by the current calendar month and compares each metric with the full prior month', () => {
    const now = new Date(2026, 10, 3, 22).getTime();
    const point = (ts: number, client: string, vol: number, net: number): DashPoint => ({ ts, client, vol, net, fullNet: net, own: true });
    const client = 'Mohamed Al-Damrawy';
    const points = [
      point(new Date(2026, 9, 1).getTime(), client, 400000, 10000),
      point(new Date(2026, 9, 31, 23).getTime(), client, 700000, 20000),
      point(new Date(2026, 9, 20).getTime(), 'Previous month only', 9999999, 999999),
      point(new Date(2026, 10, 2).getTime(), client, 21892, 685),
      point(new Date(2026, 10, 2).getTime(), 'Other current client', 100, 1000),
    ];
    const { container } = render(<DashboardHome points={points} allPoints={points} now={now} win={rangeWindow('30d', now, null)} rangeText="selected period" comparisonText="vs previous period" lang="en" money={n => n.toLocaleString('en-US') + ' QAR'} parts={n => ({ n: String(n), u: 'QAR' })} tiles={[]} moreTiles={[]} fees={0} cash={{ total: '0', unit: 'QAR', counted: 0, active: 0, accounts: [] }} onGo={() => {}} />);
    const section = container.querySelector('.dh-top')!;
    const row = () => [...section.querySelectorAll('tbody tr')].find(row => row.textContent?.includes(client))!;
    expect(section.textContent).toContain('Nov 26 so far vs Oct 26 in full');
    expect(section.textContent).not.toContain('Previous month only');
    expect(section.querySelector('tbody tr')?.textContent).toContain('Other current client');
    expect(row().textContent).toContain('685 QAR');
    expect(row().textContent).toContain('Oct 26: 30,000 QAR');
    expect(row().textContent).toContain('-97.7%');
    fireEvent.click(screen.getByRole('button', { name: 'dhVolume' }));
    expect(section.querySelector('tbody tr')?.textContent).toContain(client);
    expect(row().textContent).toContain('21,892 QAR');
    expect(row().textContent).toContain('Oct 26: 1,100,000 QAR');
    expect(row().textContent).toContain('-98.0%');
  });

});
