import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const update = vi.fn();
let portalPalette: string | undefined = 'emerald';
vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ customerProfile: { display_name: 'x', display_name_ar: null, phone: null, country: 'Qatar' }, userId: 'u1', refreshProfile: vi.fn(), logout: vi.fn(), email: 'a@b.c' }),
}));
vi.mock('@/lib/theme-context', async () => {
  const layouts = await vi.importActual<typeof import('@/lib/theme/layouts')>('@/lib/theme/layouts');
  return {
    LAYOUTS: layouts.LAYOUTS,
    THEME_NAMES: {},
    useTheme: () => ({
      settings: { language: 'en', layout: layouts.LAYOUTS[0].id, theme: Object.keys(layouts.LAYOUTS[0].themes)[0], portalPalette },
      update,
      currentLayout: layouts.LAYOUTS[0],
    }),
  };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/features/customer/customer-portal', () => ({
  CUSTOMER_COUNTRIES: ['Qatar'],
  updateCustomerProfile: vi.fn(),
  resolveCustomerDisplayName: () => 'x',
}));

import CustomerSettingsPage from '@/pages/customer/CustomerSettingsPage';

describe('customer settings: home and orders colours', () => {
  it('lists all three palettes and saves the chosen one', () => {
    render(<MemoryRouter><CustomerSettingsPage /></MemoryRouter>);
    expect(screen.getByText('Home & orders colours')).toBeTruthy();
    expect(screen.getByText('Emerald').closest('button')?.getAttribute('aria-pressed')).toBe('true');
    screen.getByText('Gold & Charcoal').click();
    expect(update).toHaveBeenCalledWith({ portalPalette: 'gold' });
    screen.getByText('Ocean Teal').click();
    expect(update).toHaveBeenCalledWith({ portalPalette: 'ocean' });
  });

  it('shows emerald as chosen when nothing has been saved yet', () => {
    portalPalette = undefined;
    render(<MemoryRouter><CustomerSettingsPage /></MemoryRouter>);
    expect(screen.getAllByText('Emerald').pop()?.closest('button')?.getAttribute('aria-pressed')).toBe('true');
  });
});
