import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppNotification } from '@/types/notifications';

const mark = vi.fn();
vi.mock('@/hooks/useNotifications', () => ({
  useMarkNotificationRead: () => ({ mutate: mark, isPending: false }),
}));

import { DriverExcursionAlert, isDriverExcursionAlert } from '@/features/shipments/components/DriverExcursionAlert';

const alert = {
  id: 'n1',
  title: 'Temperature excursion / خروج عن النطاق',
  body: 'SH-0002: 8.5°C (allowed -18…-12°C). Check the reefer now.',
  category: 'system',
  read_at: null,
  created_at: '2026-11-18T10:00:00Z',
  entity_type: 'shipment',
  entity_id: 'ship-1',
  target_path: '/d/shipments/ship-1',
  target_entity_type: 'shipment',
  target_entity_id: 'ship-1',
  dedupe_key: 'shipment-driver-excursion:r1',
  target: {
    kind: 'system',
    notificationId: 'n1',
    entityType: 'shipment',
    entityId: 'ship-1',
    targetPath: '/d/shipments/ship-1',
    targetEntityType: 'shipment',
    targetEntityId: 'ship-1',
    dedupeKey: 'shipment-driver-excursion:r1',
  },
} as unknown as AppNotification;

describe('DriverExcursionAlert', () => {
  it('recognises the trigger dedupe key and ignores read or unrelated notifications', () => {
    expect(isDriverExcursionAlert(alert)).toBe(true);
    expect(isDriverExcursionAlert({ ...alert, read_at: '2026-11-18T11:00:00Z' })).toBe(false);
    expect(isDriverExcursionAlert({
      ...alert,
      target: { ...alert.target, dedupeKey: 'shipment-excursion:r1' },
    })).toBe(false);
  });

  it('shows the live excursion and links straight to the trip', () => {
    render(<MemoryRouter><DriverExcursionAlert alerts={[alert]} lang="en" /></MemoryRouter>);
    expect(screen.getByText('Live temperature alert')).toBeTruthy();
    expect(screen.getByText(alert.body!)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open trip/ }).getAttribute('href')).toBe('/d/shipments/ship-1');
  });

  it('can be dismissed from the cockpit', () => {
    render(<MemoryRouter><DriverExcursionAlert alerts={[alert]} lang="en" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));
    expect(mark).toHaveBeenCalledWith('n1');
  });
});
