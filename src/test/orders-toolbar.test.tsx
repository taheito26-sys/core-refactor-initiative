import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrdersV2Months, OrdersV2Export } from '@/features/orders/v2/OrdersV2';

const months = [
  { key: '2026-10', label: 'Oct 26', long: 'October 2026' },
  { key: '2026-09', label: 'Sep 26', long: 'September 2026' },
  { key: '2026-08', label: 'Aug 26', long: 'August 2026' },
  { key: '2026-04', label: 'Apr 26', long: 'April 2026' },
];

describe('Orders and Stock toolbar', () => {
  it('shows the selected month and keeps older months available in the selector', () => {
    const select = vi.fn();
    render(<OrdersV2Months months={months} selected="2026-04" onSelect={select} allLabel="All Months" />);
    expect(screen.getByRole('combobox').textContent).toContain('April 2026');
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'September 2026' }));
    expect(select).toHaveBeenCalledWith('2026-09');
  });

  it('keeps a shortcut for recent months and lets the selector reset to all months', () => {
    const select = vi.fn();
    render(<OrdersV2Months months={months} selected="2026-10" onSelect={select} allLabel="All Months" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sep 26' }));
    expect(select).toHaveBeenCalledWith('2026-09');
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'All Months' }));
    expect(select).toHaveBeenCalledWith('all');
  });

  it('disables exporting when there are no exportable rows or an export is running', () => {
    render(<OrdersV2Export label="Export" xlsxLabel="Export XLSX" pdfLabel="Export PDF" disabled onXlsx={vi.fn()} onPdf={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
});
