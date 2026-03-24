import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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

  useEffect(() => {
    let isMounted = true;

    const finalizeOAuth = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const providerError = params.get('error');
      const providerErrorDescription = params.get('error_description');

      if (providerError || providerErrorDescription) {
        const message = providerErrorDescription || providerError || 'Google sign-in was cancelled or rejected.';
        console.error('[OAuthCallback] OAuth provider returned an error', {
          error: providerError,
          errorDescription: providerErrorDescription,
          search: window.location.search,
        });
        toast.error(message);

        if (isMounted && !redirectedRef.current) {
          redirectedRef.current = true;
          navigate('/login', { replace: true });
        }

        return;
      }

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            throw error;
          }
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session?.user) {
          throw new Error('No authenticated session was created after Google sign-in.');
        }

        window.history.replaceState({}, document.title, '/auth/callback');
        sessionStorage.removeItem('oauth:return-path');
        sessionStorage.removeItem('oauth:started-at');

        console.info('[OAuthCallback] Supabase session restored', {
          userId: session.user.id,
          email: session.user.email,
        });
      } catch (err: unknown) {
        const rawMessage = err instanceof Error ? err.message : 'Unable to complete Google sign-in.';
        const message = rawMessage.toLowerCase().includes('state not found or expired')
          ? 'Google sign-in expired on this device. Please try again from the login page.'
          : rawMessage;

        console.error('[OAuthCallback] Failed to finalize Google OAuth session', {
          error: err,
          search: window.location.search,
          hash: window.location.hash,
          startedAt: sessionStorage.getItem('oauth:started-at'),
          returnPath: sessionStorage.getItem('oauth:return-path'),
        });

        toast.error(message);

        if (isMounted && !redirectedRef.current) {
          redirectedRef.current = true;
          navigate('/login', { replace: true });
        }
      }
    };

    void finalizeOAuth();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (isAuthenticated && !redirectedRef.current) {
      redirectedRef.current = true;
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!redirectedRef.current) {
        const message = 'Google sign-in timed out before a session was created.';
        console.error('[OAuthCallback] OAuth callback timed out', {
          search: window.location.search,
          hash: window.location.hash,
        });
        toast.error(message);
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
