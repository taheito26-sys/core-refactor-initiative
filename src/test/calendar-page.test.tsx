import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { buildStateFrom } from '@/lib/tracker-state';

const view = vi.hoisted(() => ({ language: 'en' as 'en' | 'ar' }));
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: view.language, currency: 'QAR', range: 'all' } }) }));
vi.mock('@/lib/useTrackerState', () => ({ useTrackerState: () => buildStateFrom({ trades: [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `tr-${i}`, ts: new Date(2026, 9, 19, 12 + i).getTime(), inputMode: 'USDT', amountUSDT: 1000, sellPriceQAR: 4, manualBuyPrice: 3.9, feeQAR: 0, voided: false, usesStock: false, revisions: [], customerId: '', note: '' })),
  { id: 'loss', ts: new Date(2026, 9, 20, 12).getTime(), amountUSDT: 1000, sellPriceQAR: 3.8, manualBuyPrice: 4, feeQAR: 0, voided: false, usesStock: false, revisions: [], customerId: '', note: '' },
] }) }));
vi.mock('recharts', async () => {
  const React = await import('react');
  return { ResponsiveContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children), BarChart: () => null, AreaChart: () => null, Area: () => null, Bar: () => null, CartesianGrid: () => null, Cell: () => null, ReferenceLine: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null };
});
import CalendarPage from '@/pages/CalendarPage';

describe('trading calendar controls', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 29, 12)); view.language = 'en'; });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('selects a day, expands its trades, filters losses and switches chart mode', () => {
    render(<CalendarPage />);
    fireEvent.click(screen.getByRole('button', { name: /^October 19, 2026/ }));
    const detail = screen.getByRole('complementary', { name: 'October 19, 2026' });
    expect(within(detail).getAllByText('Sell USDT')).toHaveLength(4);
    fireEvent.click(within(detail).getByRole('button', { name: /View All/ }));
    expect(within(detail).getAllByText('Sell USDT')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Loss Days' }));
    expect(screen.getByRole('button', { name: /^October 19, 2026/ }).className).toContain('is-filtered');
    expect(screen.getByRole('button', { name: /^October 20, 2026/ }).className).not.toContain('is-filtered');
    fireEvent.click(screen.getByRole('button', { name: 'Cumulative P&L' }));
    expect(screen.getByRole('button', { name: 'Cumulative P&L' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Show Volume' }));
    expect(screen.getByRole('button', { name: 'Show Volume' }).getAttribute('aria-pressed')).toBe('false');
  });
  it('changes months, returns to today and moves the selected day across months', () => {
    render(<CalendarPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByRole('complementary', { name: 'November 1, 2026' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByRole('complementary', { name: 'October 31, 2026' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('complementary', { name: 'October 29, 2026' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Choose month'), { target: { value: '2024-02' } });
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'date')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^February 29, 2024/ })).toBeTruthy();
  });
  it('renders Arabic labels and right-to-left content', () => {
    view.language = 'ar';
    render(<CalendarPage />);
    expect(screen.getByRole('main').getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('heading', { name: 'تقويم التداول' })).toBeTruthy();
  });
});
