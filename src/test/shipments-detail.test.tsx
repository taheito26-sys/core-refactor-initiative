import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ShipmentWithDetails } from '@/features/shipments/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const withQuery = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

const state: { data: ShipmentWithDetails | null } = { data: null };
vi.mock('@/features/shipments/hooks', () => ({
  useShipment: () => ({ data: state.data, isLoading: false }),
  useDrivers: () => ({ data: [{ id: 'd', display_name: 'Ahmed', truck_plate: 'T1', active: true }] }),
  useAssignDriver: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelShipment: () => ({ mutate: vi.fn(), isPending: false }),
  usePhotoUrl: () => ({ data: 'https://example.test/p.jpg', isLoading: false, isError: false }),
}));
const lookupMock = vi.fn();
vi.mock('@/features/shipments/place', () => ({ lookupPlaceForViewer: (...a: unknown[]) => lookupMock(...a) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ShipmentDetailSheet } from '@/features/shipments/components/ShipmentDetailSheet';

const NOW = new Date('2026-11-14T12:00:00Z').getTime();
const iso = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const stop = (seq: number, en: string, ar: string, reached: boolean) => ({ id: `s${seq}`, shipment_id: 'x', seq, name_en: en, name_ar: ar, kind: 'fixed' as const, reached_at: reached ? iso(20 - seq) : null });
const reading = (h: number, t: number, alert: boolean) => ({
  id: `r${h}`, shipment_id: 'x', temperature_c: t, set_point_c: -15, photo_path: 'x/a.jpg', note: null, is_alert: alert, taken_at: iso(h),
  latitude: 31.2653, longitude: 32.3019, accuracy_m: 18, device_taken_at: iso(h), time_mismatch: false, entry_mode: 'auto' as const,
  place_ar: 'بورسعيد', place_en: 'Port Said',
});
const base = (over: Partial<ShipmentWithDetails> = {}): ShipmentWithDetails => ({
  id: 'x', customer_user_id: 'c', reference: 'SH-0001', cargo: 'Frozen fish', weight_tons: 12, target_temp_c: -15, tolerance_c: 3, reading_interval_hours: 3,
  driver_id: 'd', status: 'on_the_road', note: null, started_at: iso(20), delivered_at: null, created_at: iso(24),
  driver: { id: 'd', display_name: 'Ahmed', truck_plate: 'T1', phone: '+20100' },
  stops: [stop(1, 'Obour', 'العبور', true), stop(2, 'Kafr El Sheikh', 'كفر الشيخ', true), stop(3, 'Port Said', 'بورسعيد', false)],
  readings: [reading(0.3, 8.5, true), reading(3, -15, false), reading(6, -14, false)],
  locations: [
    { latitude: 31.2653, longitude: 32.3019, accuracy_m: 10, recorded_at: iso(0.3), source: 'reading', place_ar: 'بورسعيد', place_en: 'Port Said' },
    { latitude: 30.8, longitude: 30.9, accuracy_m: 10, recorded_at: iso(3), source: 'auto', place_ar: 'كفر الشيخ', place_en: 'Kafr El Sheikh' },
  ],
  ...over,
});

const open = (lang: 'en' | 'ar' = 'en') => render(withQuery(<ShipmentDetailSheet shipmentId="x" lang={lang} now={NOW} onClose={vi.fn()} />));
beforeEach(() => { state.data = base(); });

describe('Shipment detail panel', () => {
  it('leads with the temperature now, in words, and the proof attached to it', () => {
    open();
    expect(screen.getAllByText('8.5°C').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Out of range').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Port Said').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Read from the photo').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link').some((a) => (a.getAttribute('href') ?? '').includes('google.com/maps?q=31.265300,32.301900'))).toBe(true);
  });

  it('shows the trip in numbers: time, stops, distance, share in range, lowest and highest', () => {
    open();
    const box = screen.getByText('The trip in numbers').closest('section') as HTMLElement;
    expect(within(box).getByText('2/3')).toBeTruthy();
    expect(within(box).getByText('67%')).toBeTruthy();
    expect(within(box).getByText('-15…8.5')).toBeTruthy();
    expect(within(box).getByText('1 out of range')).toBeTruthy();
  });

  it('shows where the truck is by name with a map, and the earlier positions', () => {
    open();
    expect(document.querySelector('iframe')?.getAttribute('src')).toContain('openstreetmap.org/export/embed.html');
    expect(screen.getByText('Kafr El Sheikh', { selector: 'b' })).toBeTruthy();
    expect(screen.getByText(/Last seen/)).toBeTruthy();
  });

  it('never prints GPS coordinates, only the area by name', () => {
    open();
    expect(document.body.textContent).not.toMatch(/°\s*[NSEW]/);
    expect(screen.getAllByText('Open in maps').length).toBeGreaterThan(0);
  });

  it('names the area of a position saved without one, in the reader language', async () => {
    lookupMock.mockResolvedValue({ ar: 'سفاجا، محافظة البحر الأحمر، مصر', en: 'Safaga, Red Sea Governorate, Egypt' });
    state.data = base({
      readings: [{ ...reading(0.3, 8.5, true), place_ar: null, place_en: null }],
      locations: [{ latitude: 26.73, longitude: 33.93, accuracy_m: 10, recorded_at: iso(0.3), source: 'auto', place_ar: null, place_en: null }],
    });
    open('ar');
    expect((await screen.findAllByText('سفاجا، محافظة البحر الأحمر، مصر')).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/°\s*[NSEW]/);
  });

  it('marks reached stops and names the next one', () => {
    open();
    const route = screen.getByText('Route', { selector: 'h3' }).closest('section') as HTMLElement;
    expect(within(route).getByText('Next stop')).toBeTruthy();
    expect(within(route).queryAllByText('Not reached yet')).toHaveLength(0);
    expect(route.querySelectorAll('li.reached')).toHaveLength(2);
  });

  it('lists every reading, and offers to cancel a shipment that is on the road', () => {
    open();
    const box = screen.getByText('Readings', { selector: 'h3' }).closest('section') as HTMLElement;
    expect(within(box).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Cancel this shipment' })).toBeTruthy();
  });

  it('says the driver has not shared a location or sent a photo yet', () => {
    state.data = base({ readings: [], locations: [], status: 'preparing', started_at: null });
    open();
    expect(screen.getByText('The driver has not sent a photo yet.')).toBeTruthy();
    expect(screen.getByText('The driver has not shared a location yet.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Assigned driver' })).toBeTruthy();
  });

  it('reads in Arabic', () => {
    open('ar');
    expect(screen.getByText('الحرارة الآن', { selector: 'h3' })).toBeTruthy();
    expect(screen.getByText('الرحلة بالأرقام')).toBeTruthy();
    expect(screen.getAllByText('بورسعيد').length).toBeGreaterThan(0);
  });

  it('does not offer to cancel a delivered shipment', () => {
    state.data = base({ status: 'delivered', delivered_at: iso(1) });
    open();
    expect(screen.queryByRole('button', { name: 'Cancel this shipment' })).toBeNull();
  });
});
