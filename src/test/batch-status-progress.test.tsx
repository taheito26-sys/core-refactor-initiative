import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: 'en' } }) }));
vi.mock('@/features/orders/v2/useAlignedCardRows', () => ({ useAlignedCardRows: () => {} }));
import { OrdersV2Card, type V2CardProps } from '@/features/orders/v2/OrdersV2';
import { BatchConsumption } from '@/features/stock/components/BatchConsumption';
const props: V2CardProps = { id: 'batch-1', name: 'Aly', initial: 'A', tone: 0, compactHeader: true, statusLabel: 'Partial', statusKind: 'warn', dateText: '10/28/2026', qty: '30,000 USDT', rate: '3.71 QAR', volume: '16,832 USDT', net: '+1,025 QAR', netTone: 'good', detailsLabel: 'Details', detailsOpen: false, onDetails: vi.fn(), menu: [], menuLabel: 'More', chatLabel: 'Chat', copyLabel: 'Copy', copiedLabel: 'Copied', labels: { qty: 'Qty', rate: 'Buy price', volume: 'Remaining', net: 'Profit' } };
afterEach(cleanup);
describe('stock status progress placement', () => {
  it('places the consumption bar immediately beside the batch status', () => {
    render(<OrdersV2Card {...props} statusAside={<BatchConsumption initial={30000} remaining={16832} />} />);
    const group = screen.getByText('Partial').closest('.ov2-status-group');
    expect(group).toBeTruthy(); expect(group?.contains(screen.getByRole('progressbar'))).toBe(true);
    expect(screen.getByRole('article').className).toContain('ov2-has-status-aside');
  });
  it('keeps ordinary order cards free of a stock progress slot', () => {
    render(<OrdersV2Card {...props} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('article').className).not.toContain('ov2-has-status-aside');
  });
});
