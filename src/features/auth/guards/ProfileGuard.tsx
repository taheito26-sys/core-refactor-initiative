import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../auth-context';

/**
 * ProfileGuard checks that the authenticated user has a merchant profile.
 * If not, redirects to onboarding.
 * Also checks profile approval status — if pending/rejected, shows appropriate state.
 *
 * ISSUE 1 FIX: Previously returned null during loading, giving users a blank
 * white screen with no indication the app was working. Now shows a centred
 * spinner so the loading state is always visible.
 */
export function ProfileGuard({ children }: { children: React.ReactNode }) {
  const { profile, merchantProfile, isLoading } = useAuth();

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

  // No merchant profile yet — needs onboarding
  if (!merchantProfile) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
