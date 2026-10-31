import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const update = vi.hoisted(() => vi.fn());
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: 'en', currency: 'QAR', range: 'all' }, update }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => Object.assign((key: string) => key, { lang: 'en', isRTL: false }) }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ merchantProfile: null, logout: vi.fn() }) }));
vi.mock('@/components/notifications/ActivityCenter', () => ({ default: () => <button>Notifications</button> }));
vi.mock('@/components/shared/ZoomControls', () => ({ ZoomControls: () => <button>Zoom</button> }));
vi.mock('@/components/layout/ThemeColorPicker', () => ({ ThemeColorPicker: () => <button>Colors</button> }));
vi.mock('@/features/profile/UserProfileModal', () => ({ UserProfileModal: () => null }));

import { TopBar } from '@/components/layout/TopBar';

beforeEach(() => {
  localStorage.clear(); update.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shared tracker navigation', () => {
  it.each([true, false])('renders identical controls across every tracker route (mobile=%s)', isMobile => {
    const routes = ['/dashboard', '/trading/orders', '/trading/stock', '/trading/cash', '/trading/calendar', '/trading/p2p', '/crm', '/merchants', '/deals', '/analytics', '/trading/vault', '/settings', '/notifications', '/chat', '/marketplace', '/messages', '/invitations', '/approvals', '/relationships', '/admin', '/merchants/example'];
    let reference = '';
    for (const path of routes) {
      const view = render(<MemoryRouter initialEntries={[path]}><TopBar isMobile={isMobile} onMenuClick={() => {}} /></MemoryRouter>);
      const header = view.container.querySelector('header');
      expect(header).toBeTruthy();
      if (!reference) reference = header!.innerHTML;
      expect(header!.innerHTML).toBe(reference);
      expect(screen.getByRole('tab', { name: 'ov2LayoutNew' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'ov2LayoutClassic' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'search' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'dhFilters' })).toBeNull();
      view.unmount();
    }
  });

  it('keeps shared settings and the layout switch usable away from home', () => {
    render(<MemoryRouter initialEntries={['/trading/stock']}><TopBar isMobile onMenuClick={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByText('7D'));
    expect(update).toHaveBeenCalledWith({ range: '7d' });
    fireEvent.click(screen.getByRole('tab', { name: 'ov2LayoutClassic' }));
    expect(localStorage.getItem('home-design')).toBe('classic');
    expect(screen.getByRole('tab', { name: 'ov2LayoutClassic' }).getAttribute('aria-selected')).toBe('true');
  });
});
