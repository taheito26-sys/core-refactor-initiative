import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ShipmentWithDetails } from '@/features/shipments/types';

const submitReading = vi.fn();
vi.mock('@/features/shipments/api', () => ({
  submitReading: (...a: unknown[]) => submitReading(...a),
  signedPhotoUrl: vi.fn().mockResolvedValue('https://example.test/photo.jpg'),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ userId: 'u1' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DriverReadingForm } from '@/features/shipments/components/DriverReadingForm';
import { ShipmentCard } from '@/features/shipments/components/ShipmentCard';
import { FleetPulse } from '@/features/shipments/components/FleetPulse';

const NOW = new Date('2026-11-14T12:00:00Z').getTime();
const stop = (seq: number, name: string, reached: string | null) =>
  ({ id: `s${seq}`, shipment_id: 'sh1', seq, name_en: name, name_ar: name, kind: 'fixed', reached_at: reached }) as const;

const shipment = (over: Partial<ShipmentWithDetails> = {}): ShipmentWithDetails => ({
  id: 'sh1', customer_user_id: 'c1', reference: 'SH-0001', cargo: 'Frozen chicken', weight_tons: 18.4, target_temp_c: -15,
  tolerance_c: 3, reading_interval_hours: 3, driver_id: 'd1', status: 'on_the_road', note: null,
  started_at: '2026-11-14T08:00:00Z', delivered_at: null, created_at: '2026-11-14T07:00:00Z',
  driver: { id: 'd1', display_name: 'Ahmed El-Sayed', truck_plate: 'ABC 123', phone: null },
  stops: [stop(10, 'Obour (Cairo)', '2026-11-14T08:00:00Z'), stop(20, 'Kafr El Sheikh', '2026-11-14T09:30:00Z'), stop(30, 'Port Said', null), stop(40, 'Qatar (delivery)', null)],
  readings: [{ id: 'r1', shipment_id: 'sh1', temperature_c: 8.5, set_point_c: -15, photo_path: 'sh1/a.jpg', note: null, is_alert: true, taken_at: '2026-11-14T11:42:00Z' }],
  ...over,
});

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('ShipmentCard', () => {
  it('shows the route ends, progress, driver and an out-of-range temperature in words', () => {
    wrap(<ShipmentCard shipment={shipment()} lang="en" now={NOW} onOpen={vi.fn()} />);
    expect(screen.getByText('SH-0001')).toBeTruthy();
    expect(screen.getByText('Obour (Cairo)')).toBeTruthy();
    expect(screen.getByText('Qatar (delivery)')).toBeTruthy();
    expect(screen.getByText('Ahmed El-Sayed')).toBeTruthy();
    expect(screen.getByText('8.5°C')).toBeTruthy();
    expect(screen.getByText('Out of range')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
  });

  it('reads in Arabic and says when a reading is overdue', () => {
    wrap(<ShipmentCard shipment={shipment()} lang="ar" now={NOW + 4 * 3600_000} onOpen={vi.fn()} />);
    expect(screen.getByText('خارج النطاق')).toBeTruthy();
    expect(screen.getByText(/القراءة متأخرة/)).toBeTruthy();
  });

  it('opens on click', () => {
    const onOpen = vi.fn();
    wrap(<ShipmentCard shipment={shipment()} lang="en" now={NOW} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('FleetPulse', () => {
  it('counts only trucks on the road and names the next stop', () => {
    wrap(<FleetPulse shipments={[shipment(), shipment({ id: 'sh2', reference: 'SH-0002', status: 'preparing' })]} lang="en" now={NOW} onOpen={vi.fn()} />);
    expect(screen.getByText('1 on the road')).toBeTruthy();
    expect(screen.getByText(/→ Port Said/)).toBeTruthy();
    expect(screen.queryByText('SH-0002')).toBeNull();
  });

  it('says so when nothing is moving', () => {
    wrap(<FleetPulse shipments={[shipment({ status: 'delivered' })]} lang="en" now={NOW} onOpen={vi.fn()} />);
    expect(screen.getByText('No trucks are on the road right now.')).toBeTruthy();
  });
});

describe('DriverReadingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  const photo = () => new File(['x'], 'screen.jpg', { type: 'image/jpeg' });
  const pick = () => fireEvent.change(screen.getByLabelText('Photo of the temperature screen'), { target: { files: [photo()] } });

  it('cannot send without a photo and a temperature', () => {
    wrap(<DriverReadingForm shipment={{ id: 'sh1', target_temp_c: -15 }} lang="en" />);
    const send = screen.getByRole('button', { name: /Send reading/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    pick();
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Temperature shown (°C)'), { target: { value: '8.5' } });
    expect(send.disabled).toBe(false);
  });

  it('sends the photo with the typed temperature and the set point, then clears the form', async () => {
    submitReading.mockResolvedValue({});
    wrap(<DriverReadingForm shipment={{ id: 'sh1', target_temp_c: -15 }} lang="en" />);
    pick();
    fireEvent.change(screen.getByLabelText('Temperature shown (°C)'), { target: { value: '8,5' } });
    fireEvent.click(screen.getByRole('button', { name: /Send reading/ }));
    await waitFor(() => expect(submitReading).toHaveBeenCalled());
    expect(submitReading.mock.calls[0][0]).toMatchObject({ shipmentId: 'sh1', temperatureC: 8.5, setPointC: -15 });
    await waitFor(() => expect((screen.getByLabelText('Temperature shown (°C)') as HTMLInputElement).value).toBe(''));
  });

  it('keeps the photo and numbers when the upload fails, so the driver can retry', async () => {
    submitReading.mockRejectedValueOnce(new Error('Failed to fetch'));
    wrap(<DriverReadingForm shipment={{ id: 'sh1', target_temp_c: -15 }} lang="en" />);
    pick();
    fireEvent.change(screen.getByLabelText('Temperature shown (°C)'), { target: { value: '-14' } });
    fireEvent.click(screen.getByRole('button', { name: /Send reading/ }));
    await waitFor(() => expect(submitReading).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText('Temperature shown (°C)') as HTMLInputElement).value).toBe('-14');
    expect((screen.getByRole('button', { name: /Send reading/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('types a minus with the ± button for keypads that have none', () => {
    wrap(<DriverReadingForm shipment={{ id: 'sh1', target_temp_c: -15 }} lang="en" />);
    fireEvent.change(screen.getByLabelText('Temperature shown (°C)'), { target: { value: '15' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Switch between plus and minus' })[0]);
    expect((screen.getByLabelText('Temperature shown (°C)') as HTMLInputElement).value).toBe('-15');
  });
});
