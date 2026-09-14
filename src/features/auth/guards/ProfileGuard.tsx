import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../auth-context';

/**
 * ProfileGuard checks that the authenticated user has a merchant profile, and
 * otherwise sends them wherever their account actually belongs.
 *
 * The destination is derived from the account itself, never from a portal the
 * user picked at login: sign-in is a single unified page, and which profiles
 * exist is the authoritative answer. A dual-role account (both a merchant and
 * a customer profile) lands in the merchant app; /c/* stays reachable
 * directly, and CustomerGuard admits them because they do have a customer
 * profile.
 *
 * The signup-time role is still honoured, but only for an account that has
 * neither profile yet — there, intent is the one thing the account cannot
 * tell us.
 */
export function ProfileGuard({ children }: { children: React.ReactNode }) {
  const { profile, merchantProfile, customerProfile, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If profile is pending admin approval
  if (profile && profile.status === 'pending') {
    return <Navigate to="/pending-approval" replace />;
  }

  // If profile was rejected
  if (profile && profile.status === 'rejected') {
    return <Navigate to="/account-rejected" replace />;
  }

  // A merchant profile is what this shell requires, and it wins for a
  // dual-role account.
  if (merchantProfile) {
    return <>{children}</>;
  }

  // Customer-only account.
  if (customerProfile) {
    return <Navigate to="/c/home" replace />;
  }

  // Neither profile exists yet, so this is a fresh account that still has to
  // onboard. Only here does the signup-time choice matter.
  const signupRole = typeof window !== 'undefined' ? localStorage.getItem('p2p_signup_role') : null;
  if (signupRole === 'customer' || profile?.role === 'customer') {
    if (typeof window !== 'undefined') localStorage.removeItem('p2p_signup_role');
    return <Navigate to="/c/onboarding" replace />;
  }
  return <Navigate to="/onboarding" replace />;
}
