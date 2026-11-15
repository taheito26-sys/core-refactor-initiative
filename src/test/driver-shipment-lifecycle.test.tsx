import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ShipmentWithDetails } from '@/features/shipments/types';
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), status: 'preparing', language: 'en' }));
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useParams: () => ({ id: 'trip' }), useOutletContext: () => ({ access: {}, driverName: 'Driver' }) }));
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: mocks.language } }) }));
vi.mock('@/features/shipments/hooks', () => ({
  useShipment: () => ({ data: { id: 'trip', reference: 'SH-1', cargo: 'Fish', status: mocks.status, target_temp_c: -15, tolerance_c: 3, reading_interval_hours: 3, stops: [], readings: [], locations: [], created_at: '2026-11-14T00:00:00Z', started_at: null } as unknown as ShipmentWithDetails, isLoading: false }),
  useStartShipment: () => ({ mutate: mocks.start, isPending: false }),
  useStopShipment: () => ({ mutate: mocks.stop, isPending: false }),
  useReachStop: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStop: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/shipments/components/DriverReadingForm', () => ({ DriverReadingForm: () => <div>Reading form</div> }));
vi.mock('@/features/shipments/reporting', () => ({ reportStopLocation: vi.fn() }));
import DriverShipmentPage from '@/pages/driver/DriverShipmentPage';
const open = () => render(<MemoryRouter><DriverShipmentPage /></MemoryRouter>);
beforeEach(() => { mocks.status = 'preparing'; mocks.language = 'en'; vi.clearAllMocks(); });
describe('Driver shipment lifecycle', () => {
  it('requires acceptance before starting and sending readings', () => {
    open();
    expect(screen.queryByText('Reading form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Accept and start shipment' }));
    expect(mocks.start).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm' }));
    expect(mocks.start).toHaveBeenCalledWith('trip', expect.any(Object));
  });
  it('can end a running trip without reaching the final stop', () => {
    mocks.status = 'on_the_road'; open();
    expect(screen.getByText('Reading form')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop and end shipment' }));
    expect(screen.getByText(/You cannot resume until the client approves/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm' }));
    expect(mocks.stop).toHaveBeenCalledWith('trip', expect.any(Object));
  });
  it.each(['delivered', 'ended_early', 'cancelled'])('locks the driver out after %s', (status) => {
    mocks.status = status; open();
    expect(screen.queryByRole('button', { name: 'Accept and start shipment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop and end shipment' })).toBeNull();
    expect(screen.queryByText('Reading form')).toBeNull();
  });
  it('supports Arabic acceptance and confirmation', () => {
    mocks.language = 'ar'; open();
    fireEvent.click(screen.getByRole('button', { name: 'قبول الشحنة وبدء الرحلة' }));
    expect(screen.getByRole('alertdialog').getAttribute('dir')).toBe('rtl');
  });
});
