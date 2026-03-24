import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { Loader2 } from 'lucide-react';

/**
 * OAuthCallbackPage
 *
 * Rendered at /~oauth/* after the Lovable auth library processes the Google
 * OAuth callback and sets the Supabase session via supabase.auth.setSession().
 *
 * Because the library is async, isLoading may already be false (no prior
 * session) before the new session is written. We therefore watch for
 * `isAuthenticated` to become true via onAuthStateChange — which fires
 * whenever the session changes — and redirect to /dashboard at that point.
 *
 * A 10-second safety timeout redirects back to /login if the auth library
 * never resolves (e.g. invalid OAuth code, network error).
 */
export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const redirectedRef = useRef(false);

  // Redirect to dashboard as soon as auth is confirmed
  useEffect(() => {
    if (isAuthenticated && !redirectedRef.current) {
      redirectedRef.current = true;
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Safety net: if auth never resolves, send the user back to login
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!redirectedRef.current) {
        redirectedRef.current = true;
        navigate('/login', { replace: true });
      }
    }, 10_000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
