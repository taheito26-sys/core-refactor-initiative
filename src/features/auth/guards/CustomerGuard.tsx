import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../auth-context';

/**
 * CustomerGuard ensures the user has role=customer and a customer_profiles row.
 * Redirects to customer onboarding if profile is missing.
 */
export function CustomerGuard({ children }: { children: React.ReactNode }) {
  const { profile, customerProfile, isLoading } = useAuth();

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

  // No customer profile yet — needs onboarding
  if (!customerProfile) {
    return <Navigate to="/c/onboarding" replace />;
  }

  return <>{children}</>;
}
