import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';

vi.mock('@/lib/i18n', () => ({ useT: () => Object.assign((key: string) => key, { lang: 'en', isRTL: false }) }));
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: 'ar' } }) }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ merchantProfile: null, logout: vi.fn() }) }));
vi.mock('@/features/admin/hooks/useAdminProfiles', () => ({ useIsAdmin: () => ({ data: false }) }));

import { MobileBottomNav } from '@/components/layout/AppSidebar';

describe('merchant mobile bottom navigation', () => {
  it('is mounted on the body so no page container can push it out of view', () => {
    const { container } = render(<MemoryRouter><div id="page"><MobileBottomNav onMoreClick={() => {}} /></div></MemoryRouter>);
    const nav = document.body.querySelector('nav.mobile-bottom-nav');
    expect(nav).toBeTruthy();
    expect(container.contains(nav)).toBe(false);
    expect(nav?.parentElement).toBe(document.body);
    expect(nav?.getAttribute('dir')).toBe('rtl');
    expect(nav?.querySelectorAll('.mobile-bottom-nav__item').length).toBe(6);
  });

  it('is pinned to the bottom edge of the screen', () => {
    const css = readFileSync('src/index.css', 'utf8');
    const rule = css.slice(css.indexOf('.mobile-bottom-nav {'), css.indexOf('}', css.indexOf('.mobile-bottom-nav {')));
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('bottom: 0');
  });
});
