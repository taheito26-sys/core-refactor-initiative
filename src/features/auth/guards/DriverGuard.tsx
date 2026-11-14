import { Navigate } from 'react-router-dom';
import { StartupLoading } from '../StartupLoading';
import { useAuth } from '../auth-context';

/**
 * Admits shipment drivers only (profiles.role = 'driver'). A driver account has no merchant or
 * customer profile, so anyone else who lands on /d/* is sent to their own portal.
 */
export function DriverGuard({ children }: { children: React.ReactNode }) {
  const { profile, customerProfile, isLoading } = useAuth();

  if (isLoading) return <StartupLoading />;
  if (profile?.status === 'suspended' || profile?.status === 'rejected') return <Navigate to="/login" replace />;
  if (profile?.role === 'driver') return <>{children}</>;
  return <Navigate to={customerProfile ? '/c/home' : '/dashboard'} replace />;
}
