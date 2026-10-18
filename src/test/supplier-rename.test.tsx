import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SuppliersPanel } from '@/features/suppliers/SuppliersPanel';
import type { TrackerState } from '@/lib/tracker-helpers';

vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: 'en' }, update: vi.fn() }) }));

const state = {
  suppliers: [{ id: 's1', name: 'Abu Hamad', phone: '', notes: '', createdAt: 1 }],
  batches: [
    { id: 'b1', ts: 1, source: 'Abu Hamad', note: '', buyPriceQAR: 3.6, initialUSDT: 100, revisions: [] },
    { id: 'b2', ts: 2, source: ' abu hamad ', note: '', buyPriceQAR: 3.7, initialUSDT: 50, revisions: [] },
    { id: 'b3', ts: 3, source: 'Omar', note: '', buyPriceQAR: 3.7, initialUSDT: 50, revisions: [] },
  ],
  trades: [],
  usdtTransfers: [],
} as unknown as TrackerState;

describe('renaming a supplier', () => {
  it('moves its batches to the new name so stock, profit and the supplier list stay together', () => {
    const applyState = vi.fn();
    render(<SuppliersPanel state={state} applyState={applyState} />);
    applyState.mockClear();
    fireEvent.click(screen.getAllByText('Edit')[0]);
    const input = screen.getByDisplayValue('Abu Hamad') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Abu Hammad' } });
    fireEvent.click(screen.getByText('Save'));
    const next = applyState.mock.calls.at(-1)![0] as TrackerState;
    expect(next.suppliers!.map(s => s.name)).toContain('Abu Hammad');
    expect(next.batches.map(b => b.source)).toEqual(['Abu Hammad', 'Abu Hammad', 'Omar']);
  });
});
