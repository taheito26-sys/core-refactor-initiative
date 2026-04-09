import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../auth-context';

/**
 * ProfileGuard checks that the authenticated user has a merchant profile.
 * If the user selected the "customer" portal at login, redirects to /c/home.
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

  const selectedPortal = typeof window !== 'undefined' ? localStorage.getItem('p2p_signup_role') : null;

  // If user explicitly chose customer portal and has a customer profile, go there
  if (selectedPortal === 'customer' && customerProfile) {
    return <Navigate to="/c/home" replace />;
  }

  // If user is customer-only (no merchant profile, role=customer, didn't pick merchant)
  if (profile && profile.role === 'customer' && !merchantProfile) {
    return <Navigate to="/c/home" replace />;
  }

  // No merchant profile yet — need onboarding
  if (!merchantProfile) {
    if (selectedPortal === 'customer') {
      localStorage.removeItem('p2p_signup_role');
      return <Navigate to="/c/onboarding" replace />;
    }
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
