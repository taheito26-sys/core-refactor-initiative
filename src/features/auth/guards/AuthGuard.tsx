import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { StartupLoading } from '../StartupLoading';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <StartupLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
