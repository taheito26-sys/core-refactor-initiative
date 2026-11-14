import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { TripData } from '@/features/shipments/api';
import type { ShipmentDriver } from '@/features/shipments/types';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const iso = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const state: { drivers: ShipmentDriver[]; trips: TripData[]; loading: boolean } = { drivers: [], trips: [], loading: false };
const setActive = vi.fn();
vi.mock('@/features/shipments/hooks', () => ({
  useDrivers: () => ({ data: state.drivers, isLoading: state.loading }),
  useTripData: () => ({ data: state.trips, isLoading: false }),
  useSetDriverActive: () => ({ mutate: setActive, isPending: false }),
  useCreateDriver: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DriversPanel } from '@/features/shipments/components/DriversPanel';

const driver = (id: string, active = true): ShipmentDriver => ({ id, user_id: `u${id}`, username: `user-${id}`, display_name: `Driver ${id}`, phone: '+20100', truck_plate: `P-${id}`, active, created_at: iso(900) });
const trip = (id: string, driverId: string, over: Partial<TripData> = {}): TripData => ({
  id, customer_user_id: 'c', reference: `SH-${id}`, cargo: 'x', weight_tons: 10, target_temp_c: -15, tolerance_c: 3, reading_interval_hours: 3,
  driver_id: driverId, status: 'delivered', note: null, started_at: iso(30), delivered_at: iso(5), created_at: iso(40),
  stops: [{ reached_at: iso(30) }, { reached_at: iso(5) }] as TripData['stops'],
  readings: [{ taken_at: iso(27), is_alert: false }, { taken_at: iso(24), is_alert: true }] as TripData['readings'],
  locations: [], ...over,
});
const panel = () => render(<DriversPanel lang="en" now={NOW} tabs={<div>tabs</div>} onAdd={vi.fn()} />);

beforeEach(() => { state.drivers = []; state.trips = []; state.loading = false; setActive.mockClear(); });

describe('Drivers tab', () => {
  it('invites the customer to add a first driver', () => {
    const onAdd = vi.fn();
    render(<DriversPanel lang="en" now={NOW} tabs={null} onAdd={onAdd} />);
    expect(screen.getByText('No drivers yet')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Add driver/ })[0]);
    expect(onAdd).toHaveBeenCalled();
  });

  it('shows each driver with their state and their statistics', () => {
    state.drivers = [driver('1'), driver('2'), driver('3', false)];
    state.trips = [trip('a', '1'), trip('b', '2', { status: 'on_the_road', delivered_at: null })];
    panel();
    const one = screen.getByRole('article', { name: 'Driver 1' });
    expect(within(one).getByText('Available')).toBeTruthy();
    expect(within(one).getByText('1/1')).toBeTruthy();
    expect(within(one).getByText('50%')).toBeTruthy();
    expect(within(screen.getByRole('article', { name: 'Driver 2' })).getByText('On the road')).toBeTruthy();
    expect(within(screen.getByRole('article', { name: 'Driver 3' })).getByText('Switched off')).toBeTruthy();
  });

  it('lists drivers on the road first', () => {
    state.drivers = [driver('1'), driver('2')];
    state.trips = [trip('b', '2', { status: 'on_the_road', delivered_at: null })];
    panel();
    const names = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(names).toEqual(['Driver 2', 'Driver 1']);
  });

  it('adds the team up at the top', () => {
    state.drivers = [driver('1'), driver('2')];
    state.trips = [trip('a', '1'), trip('b', '2')];
    panel();
    const tiles = document.querySelector('.co-tiles') as HTMLElement;
    expect(within(tiles).getByText('Drivers')).toBeTruthy();
    expect(within(tiles).getByText('50%')).toBeTruthy();
  });

  it('opens the six month history and the trip list', () => {
    state.drivers = [driver('1')];
    state.trips = [trip('a', '1')];
    panel();
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    expect(screen.getByText('Last six months')).toBeTruthy();
    expect(screen.getByText('SH-a')).toBeTruthy();
  });

  it('switches a driver off and on', () => {
    state.drivers = [driver('1'), driver('3', false)];
    panel();
    fireEvent.click(within(screen.getByRole('article', { name: 'Driver 1' })).getByRole('button', { name: /Switch off/ }));
    expect(setActive.mock.calls[0][0]).toEqual({ driverId: '1', active: false });
    fireEvent.click(within(screen.getByRole('article', { name: 'Driver 3' })).getByRole('button', { name: /Switch on/ }));
    expect(setActive.mock.calls[1][0]).toEqual({ driverId: '3', active: true });
  });

  it('filters by name, plate or username, and says when nothing matches', () => {
    state.drivers = [driver('1'), driver('2')];
    panel();
    fireEvent.change(screen.getByLabelText('Search drivers'), { target: { value: 'p-2' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search drivers'), { target: { value: 'zzz' } });
    expect(screen.getByText('No drivers match.')).toBeTruthy();
  });

  it('narrows to a month, and last month has no trips for a trip that started this month', () => {
    state.drivers = [driver('1')];
    state.trips = [trip('a', '1')];
    panel();
    const last = document.querySelectorAll('.co-months .co-chip')[1] as HTMLElement;
    fireEvent.click(last);
    expect(within(screen.getByRole('article', { name: 'Driver 1' })).getByText('0/0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(within(screen.getByRole('article', { name: 'Driver 1' })).getByText('1/1')).toBeTruthy();
  });
});
