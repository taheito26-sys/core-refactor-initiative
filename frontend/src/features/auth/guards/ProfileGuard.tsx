import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth-context';

/**
 * ProfileGuard checks that the authenticated user has a merchant profile.
 * If not, redirects to onboarding.
 * Also checks profile approval status — if pending/rejected, shows appropriate state.
 */
export function ProfileGuard({ children }: { children: React.ReactNode }) {
  const { profile, merchantProfile, isLoading } = useAuth();

  if (isLoading) return null;

  // If profile is pending admin approval
  if (profile && profile.status === 'pending') {
    return <Navigate to="/pending-approval" replace />;
  }

  // If profile was rejected
  if (profile && profile.status === 'rejected') {
    return <Navigate to="/account-rejected" replace />;
  }

  // No merchant profile yet — needs onboarding
  if (!merchantProfile) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
