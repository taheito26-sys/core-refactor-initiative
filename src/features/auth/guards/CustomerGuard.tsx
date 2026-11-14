import { Navigate } from 'react-router-dom';
import { StartupLoading } from '../StartupLoading';
import { useAuth } from '../auth-context';

/**
 * CustomerGuard ensures the user has role=customer and a customer_profiles row.
 * Redirects to customer onboarding if profile is missing.
 */
export function CustomerGuard({ children }: { children: React.ReactNode }) {
  const { profile, customerProfile, isLoading } = useAuth();

  if (isLoading) {
    return <StartupLoading />;
  }

  // If profile is pending admin approval
  if (profile && profile.status === 'pending') {
    return <Navigate to="/pending-approval" replace />;
  }

  // If profile was rejected
  if (profile && profile.status === 'rejected') {
    return <Navigate to="/account-rejected" replace />;
  }

  // A shipment driver has no customer profile and must not be sent to customer onboarding.
  if (profile?.role === 'driver') {
    return <Navigate to="/d/shipments" replace />;
  }

  // No customer profile yet — needs onboarding
  if (!customerProfile) {
    return <Navigate to="/c/onboarding" replace />;
  }

  return <>{children}</>;
}
