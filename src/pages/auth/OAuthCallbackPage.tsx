import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

/**
 * OAuthCallbackPage — rendered at /auth/callback after Google OAuth.
 *
 * Supabase routes the user back here with either:
 *   - PKCE flow: ?code=<code>  → must call exchangeCodeForSession()
 *   - Implicit flow: #access_token=... → Supabase JS auto-detects on init
 *
 * Once onAuthStateChange fires with a valid session, isAuthenticated becomes
 * true and we navigate to /dashboard. A 15-second safety timeout falls back
 * to /login if the exchange never resolves.
 */
export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const redirectedRef = useRef(false);

  // Handle PKCE code exchange (Supabase default for newer setups)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(code).catch((err) => {
        console.error('[OAuthCallback] exchangeCodeForSession failed', err);
      });
    }
    // Implicit flow (#access_token=...) is handled automatically by the
    // Supabase client via detectSessionInUrl on createClient()
  }, []);

  // Redirect to dashboard as soon as session is confirmed
  useEffect(() => {
    if (isAuthenticated && !redirectedRef.current) {
      redirectedRef.current = true;
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Safety net: redirect to login if auth never resolves
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!redirectedRef.current) {
        redirectedRef.current = true;
        navigate('/login', { replace: true });
      }
    }, 15_000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
