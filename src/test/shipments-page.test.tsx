import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ShipmentWithDetails } from '@/features/shipments/types';

const state: { data: ShipmentWithDetails[]; loading: boolean } = { data: [], loading: false };
vi.mock('@/features/shipments/hooks', () => ({
  useShipments: () => ({ data: state.data, isLoading: state.loading, isError: false }),
  useShipment: () => ({ data: null, isLoading: false }),
  useDrivers: () => ({ data: [], isLoading: false }),
  useCreateShipment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssignDriver: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelShipment: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateDriver: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetDriverActive: () => ({ mutate: vi.fn(), isPending: false }),
  usePhotoUrl: () => ({ data: 'https://example.test/p.jpg', isLoading: false, isError: false }),
}));
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: 'en' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import CustomerShipmentsPage from '@/pages/customer/CustomerShipmentsPage';

const at = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const stop = (id: string, seq: number, reached: string | null) => ({ id: `${id}-${seq}`, shipment_id: id, seq, name_en: `Stop ${seq}`, name_ar: `محطة ${seq}`, kind: 'fixed' as const, reached_at: reached });
const ship = (id: string, status: ShipmentWithDetails['status'], temp: number | null, alert = false, readingHoursAgo = 0.3): ShipmentWithDetails => ({
  id, customer_user_id: 'c', reference: `SH-${id}`, cargo: `Cargo ${id}`, weight_tons: 10, target_temp_c: -15, tolerance_c: 3, reading_interval_hours: 3,
  driver_id: null, status, note: null, started_at: status === 'preparing' ? null : at(20), delivered_at: null, created_at: at(22),
  driver: { id: 'd', display_name: 'Driver One', truck_plate: 'T1', phone: null },
  stops: [stop(id, 10, status === 'preparing' ? null : at(20)), stop(id, 20, null)],
  readings: temp === null ? [] : [{ id: `${id}-r`, shipment_id: id, temperature_c: temp, set_point_c: -15, photo_path: `${id}/a.jpg`, note: null, is_alert: alert, taken_at: at(readingHoursAgo) }],
});

beforeEach(() => { state.data = []; state.loading = false; });

describe('Shipments page', () => {
  it('invites the customer to dispatch a first shipment when there are none', () => {
    render(<CustomerShipmentsPage />);
    expect(screen.getByText('No shipments yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /New shipment/ })).toHaveLength(1);
    expect(screen.queryByText('Needs attention')).toBeNull();
  });

  it('counts each status, and counts a hot or late truck as needing attention', () => {
    state.data = [
      ship('1', 'on_the_road', 8.5, true),            // out of range
      ship('2', 'on_the_road', -15, false, 5),        // photo overdue (3 h interval, last 5 h ago)
      ship('3', 'on_the_road', -15, false, 0.5),      // fine
      ship('4', 'preparing', null),
      ship('5', 'delivered', -15, false, 30),
    ];
    render(<CustomerShipmentsPage />);
    const tile = (name: string) => screen.getByRole('button', { name: new RegExp(name) });
    expect(within(tile('On the road')).getByText('3')).toBeTruthy();
    expect(within(tile('Needs attention')).getByText('2')).toBeTruthy();
    expect(within(tile('Preparing')).getByText('1')).toBeTruthy();
    expect(within(tile('Delivered')).getByText('1')).toBeTruthy();
  });

  it('filters the list from a tile and clears the filter again', () => {
    state.data = [ship('1', 'on_the_road', 8.5, true), ship('3', 'on_the_road', -15), ship('4', 'preparing', null)];
    render(<CustomerShipmentsPage />);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /Needs attention/ }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('SH-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('searches by reference, cargo or driver', () => {
    state.data = [ship('1', 'on_the_road', -15), ship('2', 'preparing', null)];
    render(<CustomerShipmentsPage />);
    fireEvent.change(screen.getByLabelText('Search shipments'), { target: { value: 'cargo 2' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('SH-2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search shipments'), { target: { value: 'nothing here' } });
    expect(screen.getByText('No shipments match.')).toBeTruthy();
  });
});
