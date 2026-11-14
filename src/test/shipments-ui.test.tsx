import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ShipmentWithDetails } from '@/features/shipments/types';

const submitReading = vi.fn();
const getFixMock = vi.fn();
const readScreenMock = vi.fn();
const stampMock = vi.fn(async () => new Blob(['stamped'], { type: 'image/jpeg' }));
const lookupPlaceMock = vi.fn();
vi.mock('@/features/shipments/api', () => ({
  submitReading: (...a: unknown[]) => submitReading(...a),
  signedPhotoUrl: vi.fn().mockResolvedValue('https://example.test/photo.jpg'),
}));
vi.mock('@/features/shipments/location', async (orig) => ({ ...(await orig<typeof import('@/features/shipments/location')>()), getFix: (...a: unknown[]) => getFixMock(...a) }));
vi.mock('@/features/shipments/place', () => ({ lookupPlace: (...a: unknown[]) => lookupPlaceMock(...a) }));
vi.mock('@/features/shipments/read-screen', () => ({ readScreen: (...a: unknown[]) => readScreenMock(...a) }));
vi.mock('@/features/shipments/stamp', () => ({ stampPhoto: (...a: unknown[]) => (stampMock as (...x: unknown[]) => Promise<Blob>)(...a) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ userId: 'u1' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DriverReadingForm } from '@/features/shipments/components/DriverReadingForm';
import { LocationError } from '@/features/shipments/location';
import type { LocationAccess } from '@/features/shipments/useLocationAccess';
import { ShipmentCard } from '@/features/shipments/components/ShipmentCard';
import { RouteLine } from '@/features/shipments/components/RouteLine';

const NOW = new Date('2026-11-14T12:00:00Z').getTime();
const stop = (seq: number, name: string, reached: string | null) =>
  ({ id: `s${seq}`, shipment_id: 'sh1', seq, name_en: name, name_ar: name, kind: 'fixed', reached_at: reached }) as const;

const shipment = (over: Partial<ShipmentWithDetails> = {}): ShipmentWithDetails => ({
  id: 'sh1', customer_user_id: 'c1', reference: 'SH-0001', cargo: 'Frozen chicken', weight_tons: 18.4, target_temp_c: -15,
  tolerance_c: 3, reading_interval_hours: 3, driver_id: 'd1', status: 'on_the_road', note: null,
  started_at: '2026-11-14T08:00:00Z', delivered_at: null, created_at: '2026-11-14T07:00:00Z',
  driver: { id: 'd1', display_name: 'Ahmed El-Sayed', truck_plate: 'ABC 123', phone: null },
  stops: [stop(10, 'Obour (Cairo)', '2026-11-14T08:00:00Z'), stop(20, 'Kafr El Sheikh', '2026-11-14T09:30:00Z'), stop(30, 'Port Said', null), stop(40, 'Qatar (delivery)', null)],
  readings: [{ id: 'r1', shipment_id: 'sh1', temperature_c: 8.5, set_point_c: -15, photo_path: 'sh1/a.jpg', note: null, is_alert: true, taken_at: '2026-11-14T11:42:00Z', latitude: 25.2854, longitude: 51.531, accuracy_m: 12, device_taken_at: '2026-11-14T11:41:50Z', time_mismatch: false, entry_mode: 'auto', place_ar: 'بورسعيد', place_en: 'Port Said' }],
  locations: [{ latitude: 25.2854, longitude: 51.531, accuracy_m: 12, recorded_at: '2026-11-14T11:42:00Z', source: 'reading', place_ar: 'بورسعيد', place_en: 'Port Said' }],
  ...over,
});

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('ShipmentCard', () => {
  it('shows the reference, the temperature against the target, the driver, the area and the route progress', () => {
    wrap(<ShipmentCard shipment={shipment()} lang="en" now={NOW} onOpen={vi.fn()} />);
    expect(screen.getByText('SH-0001')).toBeTruthy();
    expect(screen.getByText('8.5')).toBeTruthy();
    expect(screen.getAllByText('Out of range').length).toBeGreaterThan(0);
    expect(screen.getByText('-15')).toBeTruthy();
    expect(screen.getByText('Ahmed El-Sayed')).toBeTruthy();
    expect(screen.getAllByText('Port Said').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
    expect(screen.getByText(/^2\/\d+$/)).toBeTruthy();
    expect(screen.getByText(/Last reading/)).toBeTruthy();
  });

  it('reads in Arabic and says when a reading is overdue', () => {
    wrap(<ShipmentCard shipment={shipment()} lang="ar" now={NOW + 4 * 3600_000} onOpen={vi.fn()} />);
    expect(screen.getAllByText('خارج النطاق').length).toBeGreaterThan(0);
    expect(screen.getByText(/آخر قراءة/)).toBeTruthy();
  });

  it('flags a late reading in the status tag when the temperature itself is fine', () => {
    const fine = shipment({ readings: [{ ...shipment().readings[0], temperature_c: -15, is_alert: false }] });
    wrap(<ShipmentCard shipment={fine} lang="en" now={NOW + 4 * 3600_000} onOpen={vi.fn()} />);
    expect(screen.getByText('Reading overdue')).toBeTruthy();
  });

  it('says there is no reading yet and shows no area for a shipment still being prepared', () => {
    wrap(<ShipmentCard shipment={shipment({ status: 'preparing', started_at: null, readings: [], locations: [], driver: null })} lang="en" now={NOW} onOpen={vi.fn()} />);
    expect(screen.getByText('No reading yet')).toBeTruthy();
    expect(screen.getByText('No driver assigned')).toBeTruthy();
    expect(screen.queryByText('Truck is in')).toBeNull();
  });

  it('opens by click or keyboard', () => {
    const onOpen = vi.fn();
    wrap(<ShipmentCard shipment={shipment()} lang="en" now={NOW} onOpen={onOpen} />);
    const card = screen.getByRole('button', { name: /SH-0001/ });
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe('RouteLine', () => {
  it('shows the route ends and how far the truck has got', () => {
    wrap(<RouteLine stops={shipment().stops} status="on_the_road" lang="en" />);
    expect(screen.getByText('Obour (Cairo)')).toBeTruthy();
    expect(screen.getByText('Qatar (delivery)')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('2 / 4');
  });

  it('puts no truck on the line before the trip starts or after delivery', () => {
    const parked = shipment({ status: 'preparing', stops: shipment().stops.map((st) => ({ ...st, reached_at: null })) });
    const { container } = wrap(<RouteLine stops={parked.stops} status="preparing" lang="en" />);
    expect(container.querySelector('svg.lucide-truck')).toBeNull();
  });
});

const granted: LocationAccess = { permission: 'granted', backgroundDenied: false, request: vi.fn(), activeCount: 1 };
const FIX = { latitude: 25.2854, longitude: 51.531, accuracy: 12, timestamp: Date.now() };

describe('DriverReadingForm', () => {
  const form = (access: LocationAccess = granted) => wrap(<DriverReadingForm shipment={{ id: 'sh1', reference: 'SH-0001', target_temp_c: -15 }} driverName="Ahmed" access={access} lang="en" />);
  const photo = (lastModified = Date.now()) => new File(['x'], 'screen.jpg', { type: 'image/jpeg', lastModified });
  const pick = (f = photo()) => fireEvent.change(screen.getByLabelText('Photo of the temperature screen'), { target: { files: [f] } });
  const sendButton = () => screen.getByRole('button', { name: /Send reading/ }) as HTMLButtonElement;
  const tempInput = () => screen.getByLabelText('Temperature shown (°C)') as HTMLInputElement;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
    globalThis.URL.revokeObjectURL = vi.fn();
    getFixMock.mockResolvedValue({ ...FIX, timestamp: Date.now() });
    readScreenMock.mockResolvedValue({ temperature: 8.5, setPoint: -15 });
    submitReading.mockResolvedValue({});
    lookupPlaceMock.mockResolvedValue({ ar: 'الحي العربي، بورسعيد', en: 'Al-Arab, Port Said' });
  });

  it('cannot send before a photo is taken', () => {
    form();
    expect(sendButton().disabled).toBe(true);
  });

  it('stamps the photo, reads the screen and fills the fields, then sends with the proof attached', async () => {
    form();
    pick();
    await waitFor(() => expect(tempInput().value).toBe('8.5'));
    expect(stampMock).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ reference: 'SH-0001', driverName: 'Ahmed', fix: expect.objectContaining({ latitude: 25.2854 }), place: 'Al-Arab, Port Said' }));
    expect(screen.getByText(/read automatically/i)).toBeTruthy();
    expect((screen.getByLabelText('Set point shown (°C)') as HTMLInputElement).value).toBe('-15');
    expect(sendButton().disabled).toBe(false);

    fireEvent.click(sendButton());
    await waitFor(() => expect(submitReading).toHaveBeenCalled());
    expect(submitReading.mock.calls[0][0]).toMatchObject({
      shipmentId: 'sh1', temperatureC: 8.5, setPointC: -15, entryMode: 'auto', read: { temperature: 8.5, setPoint: -15 },
      fix: expect.objectContaining({ longitude: 51.531 }),
      place: { ar: 'الحي العربي، بورسعيد', en: 'Al-Arab, Port Said' },
    });
    await waitFor(() => expect(tempInput().value).toBe(''));
  });

  it('still sends the reading, with the coordinates alone, when the area cannot be named', async () => {
    lookupPlaceMock.mockResolvedValue(null);
    form();
    pick();
    await waitFor(() => expect(tempInput().value).toBe('8.5'));
    expect(stampMock).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ place: null }));
    fireEvent.click(sendButton());
    await waitFor(() => expect(submitReading).toHaveBeenCalled());
    expect(submitReading.mock.calls[0][0].place).toBeNull();
  });

  it('falls back to typing when the screen cannot be read', async () => {
    readScreenMock.mockResolvedValue(null);
    form();
    pick();
    await waitFor(() => expect(screen.getByText(/could not be read automatically/i)).toBeTruthy());
    expect(tempInput().value).toBe('');
    expect(sendButton().disabled).toBe(true);
    fireEvent.change(tempInput(), { target: { value: '-14,5' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(submitReading).toHaveBeenCalled());
    expect(submitReading.mock.calls[0][0]).toMatchObject({ temperatureC: -14.5, entryMode: 'manual', read: null });
  });

  it('records that the driver corrected what the system read, and keeps what it read', async () => {
    form();
    pick();
    await waitFor(() => expect(tempInput().value).toBe('8.5'));
    fireEvent.change(tempInput(), { target: { value: '8' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(submitReading).toHaveBeenCalled());
    expect(submitReading.mock.calls[0][0]).toMatchObject({ temperatureC: 8, entryMode: 'auto_edited', read: { temperature: 8.5, setPoint: -15 } });
  });

  it('will not continue without a location, and lets the driver try again', async () => {
    getFixMock.mockRejectedValue(new LocationError('unavailable'));
    form();
    pick();
    await waitFor(() => expect(screen.getByText(/Could not find your location/)).toBeTruthy());
    expect(stampMock).not.toHaveBeenCalled();
    expect(sendButton().disabled).toBe(true);
    getFixMock.mockResolvedValue({ ...FIX, timestamp: Date.now() });
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(tempInput().value).toBe('8.5'));
  });

  it('says location is blocked when the driver denied it', async () => {
    getFixMock.mockRejectedValue(new LocationError('denied'));
    form();
    pick();
    await waitFor(() => expect(screen.getByText(/Location is blocked/)).toBeTruthy());
  });

  it('refuses a photo that is not from just now', async () => {
    form();
    pick(photo(Date.now() - 3 * 3600_000));
    await new Promise((r) => setTimeout(r, 30));
    expect(getFixMock).not.toHaveBeenCalled();
    expect(stampMock).not.toHaveBeenCalled();
    expect(sendButton().disabled).toBe(true);
  });

  it('keeps the stamped photo and the numbers when the upload fails, so the driver can retry', async () => {
    submitReading.mockRejectedValueOnce(new Error('Failed to fetch'));
    form();
    pick();
    await waitFor(() => expect(tempInput().value).toBe('8.5'));
    fireEvent.click(sendButton());
    await waitFor(() => expect(submitReading).toHaveBeenCalledTimes(1));
    expect(tempInput().value).toBe('8.5');
    expect(sendButton().disabled).toBe(false);
  });

  it('cannot take a photo until location is allowed', () => {
    form({ ...granted, permission: 'prompt' });
    expect((screen.getByRole('button', { name: /Photograph the screen/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Allow location above first.')).toBeTruthy();
  });

  it('types a minus with the ± button for keypads that have none', async () => {
    readScreenMock.mockResolvedValue(null);
    form();
    pick();
    await waitFor(() => expect(screen.getByText(/could not be read automatically/i)).toBeTruthy());
    fireEvent.change(tempInput(), { target: { value: '15' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Switch between plus and minus' })[0]);
    expect(tempInput().value).toBe('-15');
  });
});
