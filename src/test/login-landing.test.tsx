import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProfileGuard } from '@/features/auth/guards/ProfileGuard';

// Sign-in is one unified page for both roles, so where an account lands is
// decided here from the profiles it actually has. Getting this wrong strands a
// user in the wrong shell with no error shown, which is exactly the failure
// mode the portal picker used to paper over.

const mockAuth = vi.fn();
vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => mockAuth(),
}));

type Shape = {
  profile?: { role?: string; status?: string } | null;
  merchantProfile?: object | null;
  customerProfile?: object | null;
  isLoading?: boolean;
};

const landingFor = (shape: Shape): string => {
  mockAuth.mockReturnValue({
    profile: shape.profile ?? null,
    merchantProfile: shape.merchantProfile ?? null,
    customerProfile: shape.customerProfile ?? null,
    isLoading: shape.isLoading ?? false,
  });

  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<ProfileGuard><div>merchant-app</div></ProfileGuard>} />
        <Route path="/c/home" element={<div>customer-portal</div>} />
        <Route path="/onboarding" element={<div>merchant-onboarding</div>} />
        <Route path="/c/onboarding" element={<div>customer-onboarding</div>} />
        <Route path="/pending-approval" element={<div>pending</div>} />
        <Route path="/account-rejected" element={<div>rejected</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByText(/merchant-app|customer-portal|merchant-onboarding|customer-onboarding|pending|rejected/).textContent ?? '';
};

describe('unified login landing', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('sends a merchant account to the merchant app', () => {
    expect(landingFor({ profile: { role: 'merchant' }, merchantProfile: {} })).toBe('merchant-app');
  });

  it('sends a customer account to the customer portal', () => {
    expect(landingFor({ profile: { role: 'customer' }, customerProfile: {} })).toBe('customer-portal');
  });

  it('lands a dual-role account in the merchant app', () => {
    expect(landingFor({ profile: { role: 'merchant' }, merchantProfile: {}, customerProfile: {} }))
      .toBe('merchant-app');
  });

  it('ignores a stale portal choice left in localStorage', () => {
    // The old login page wrote this on every sign-in; a leftover value must
    // not drag a merchant into the customer portal.
    localStorage.setItem('p2p_signup_role', 'customer');
    expect(landingFor({ profile: { role: 'merchant' }, merchantProfile: {}, customerProfile: {} }))
      .toBe('merchant-app');
  });

  it('routes a customer-only account by its profile, not a stale merchant choice', () => {
    localStorage.setItem('p2p_signup_role', 'merchant');
    expect(landingFor({ profile: { role: 'customer' }, customerProfile: {} })).toBe('customer-portal');
  });

  it('honours the signup role only when neither profile exists yet', () => {
    localStorage.setItem('p2p_signup_role', 'customer');
    expect(landingFor({ profile: { role: 'customer' } })).toBe('customer-onboarding');
  });

  it('onboards a brand-new merchant when no signup role was recorded', () => {
    expect(landingFor({ profile: { role: 'merchant' } })).toBe('merchant-onboarding');
  });

  it('still gates a pending account ahead of any routing', () => {
    expect(landingFor({ profile: { role: 'merchant', status: 'pending' }, merchantProfile: {} }))
      .toBe('pending');
  });

  it('still gates a rejected account ahead of any routing', () => {
    expect(landingFor({ profile: { role: 'customer', status: 'rejected' }, customerProfile: {} }))
      .toBe('rejected');
  });
});
