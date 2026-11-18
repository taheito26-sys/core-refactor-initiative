import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = { data: [] as Array<{ id: string; reference: string; cargo: string; status: string }> };
const mutate = vi.fn();
vi.mock('@/features/shipments/hooks', () => ({
  useShipments: () => ({ data: state.data }),
  useStartShipment: () => ({ mutate, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { DriverStartReminder } from '@/features/shipments/components/DriverStartReminder';

const show = (path = '/d/shipments') => render(<MemoryRouter initialEntries={[path]}><DriverStartReminder lang="en" /></MemoryRouter>);

describe('Driver start reminder', () => {
  it('stays hidden when no shipment is waiting to be started', () => {
    state.data = [{ id: 'a', reference: 'SH-1', cargo: 'Fish', status: 'on_the_road' }];
    show();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the waiting shipment as urgent and starts it after one confirmation', () => {
    state.data = [{ id: 'b', reference: 'SH-2', cargo: 'Chicken', status: 'preparing' }, { id: 'c', reference: 'SH-3', cargo: 'Beef', status: 'preparing' }];
    show();
    expect(screen.getByText(/Urgent: accept and start the shipment/)).toBeTruthy();
    expect(screen.getByText(/SH-2/).textContent).toContain('+1 more waiting');
    fireEvent.click(screen.getByRole('button', { name: 'Accept and start shipment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(mutate).toHaveBeenCalledWith('b', expect.any(Object));
  });

  it('steps aside on the shipment\'s own page, where the same action comes first', () => {
    state.data = [{ id: 'b', reference: 'SH-2', cargo: 'Chicken', status: 'preparing' }];
    show('/d/shipments/b');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
