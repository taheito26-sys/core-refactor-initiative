// Bridge module: re-exports useAuth from the features auth context
// so source-repo pages that import from @/lib/auth-context work unchanged.
import { useAuth as useFeatureAuth } from '@/features/auth/auth-context';

export function useAuth() {
  const auth = useFeatureAuth();
  return {
    userId: auth.userId,
    email: auth.email,
    isAuthenticated: auth.isAuthenticated,
    logout: auth.logout,
  };
}
