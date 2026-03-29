import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import {
  getAuthFlowContext,
  isNativeRuntime,
} from '@/features/auth/auth-redirects';
import { getNativePlugin } from '@/platform/runtime';

export interface Profile {
  id: string;
  user_id: string;
  email: string;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantProfile {
  id: string;
  user_id: string;
  merchant_id: string;
  nickname: string;
  display_name: string;
  bio: string | null;
  region: string | null;
  default_currency: string;
  merchant_code: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

type BrowserPlugin = {
  open?: (options: { url: string }) => Promise<void>;
};

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  merchantProfile: MerchantProfile | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  devLogin: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [merchantProfile, setMerchantProfile] = useState<MerchantProfile | null>(null);

  const loadUserProfiles = useCallback(async (currentUserId?: string | null) => {
    const resolvedUserId = currentUserId ?? (await supabase.auth.getUser()).data.user?.id ?? null;

    if (!resolvedUserId) {
      setProfile(null);
      setMerchantProfile(null);
      return;
    }

    const [{ data: profileData }, { data: merchantData }] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('user_id', resolvedUserId)
        .maybeSingle(),
      supabase
        .from('merchant_profiles')
        .select('*')
        .eq('user_id', resolvedUserId)
        .maybeSingle(),
    ]);

    setProfile(profileData as Profile | null);
    setMerchantProfile(merchantData as MerchantProfile | null);
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadUserProfiles();
  }, [loadUserProfiles]);

  useEffect(() => {
    let isMounted = true;

    const syncAuthState = async (newSession: Session | null) => {
      if (!isMounted) return;

      // Handle Dev Mode Bypass
      if (localStorage.getItem('p2p_dev_mode') === 'true') {
        const mockUser: User = {
          id: '00000000-0000-0000-0000-000000000000',
          email: 'dev@local.test',
          app_metadata: {},
          user_metadata: { full_name: 'Dev Admin' },
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        } as any;

        const mockSession: Session = {
          access_token: 'mock-access-token',
          user: mockUser,
        } as any;

        const mockProfile: Profile = {
          id: 'dev-profile-123',
          user_id: mockUser.id,
          email: mockUser.email!,
          status: 'approved',
          approved_at: new Date().toISOString(),
        } as any;

        const mockMerchant: MerchantProfile = {
          id: 'dev-merchant-123',
          user_id: mockUser.id,
          merchant_id: 'M-TEST-001',
          nickname: 'Alpha',
          display_name: 'Alpha Merchant (DEV)',
          status: 'active',
          default_currency: 'USDT',
        } as any;

        setSession(mockSession);
        setUser(mockUser);
        setProfile(mockProfile);
        setMerchantProfile(mockMerchant);
        setIsLoading(false);
        return;
      }

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        await loadUserProfiles(newSession.user.id);
      } else {
        setProfile(null);
        setMerchantProfile(null);
      }

      if (isMounted) {
        setIsLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        void syncAuthState(newSession);
      }
    );

    void supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      void syncAuthState(existingSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserProfiles]);

  const login = useCallback(async (email: string, password: string) => {
    console.info('[Auth] Starting password login', { email: email.trim().toLowerCase() });

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) throw error;

    console.info('[Auth] Password login session request completed');
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const flowContext = getAuthFlowContext();
    const useNativeBrowser = isNativeRuntime();

    console.info('[Auth] Starting Google OAuth with Supabase', {
      runtime: flowContext.runtime,
      redirectTo: flowContext.oauthRedirectTo,
      returnPath: window.location.pathname + window.location.search,
      useNativeBrowser,
    });

    if (import.meta.env.DEV) {
      console.info('[Auth][DEV] Active Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
      console.info('[Auth][DEV] Active Project ID:', import.meta.env.VITE_SUPABASE_PROJECT_ID);
    }

    sessionStorage.setItem('oauth:return-path', window.location.pathname + window.location.search);
    sessionStorage.setItem('oauth:started-at', String(Date.now()));

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: flowContext.oauthRedirectTo,
        skipBrowserRedirect: useNativeBrowser,
      },
    });

    if (error) {
      console.error('[Auth] Google OAuth initiation failed', {
        message: error.message,
        name: error.name,
        status: 'status' in error ? error.status : undefined,
        redirectTo: flowContext.oauthRedirectTo,
        runtime: flowContext.runtime,
      });
      throw error;
    }

    console.info('[Auth] Google OAuth redirect prepared', {
      runtime: flowContext.runtime,
      redirectTo: flowContext.oauthRedirectTo,
      authorizationUrlHost: data?.url ? new URL(data.url).host : null,
      useNativeBrowser,
    });

    if (useNativeBrowser) {
      if (!data?.url) {
        throw new Error('Google OAuth redirect URL was not returned for native runtime.');
      }

      const browserPlugin = getNativePlugin<BrowserPlugin>('Browser');
      if (!browserPlugin?.open) {
        throw new Error('Native Browser plugin is not available for OAuth redirect.');
      }

      await browserPlugin.open({ url: data.url });
    }
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const flowContext = getAuthFlowContext();

    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: flowContext.oauthRedirectTo,
      },
    });
    if (error) throw error;
  }, []);

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
    setMerchantProfile(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const flowContext = getAuthFlowContext();

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: flowContext.passwordResetRedirectTo,
    });
    if (error) throw error;
  }, []);

  const devLogin = useCallback(() => {
    localStorage.setItem('p2p_dev_mode', 'true');
    window.location.reload();
  }, []);

  const value: AuthState = {
    isLoading,
    isAuthenticated: !!session,
    user,
    session,
    userId: user?.id ?? null,
    email: user?.email ?? null,
    profile,
    merchantProfile,
    login,
    loginWithGoogle,
    signup,
    logout,
    refreshProfile,
    resetPassword,
    devLogin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
