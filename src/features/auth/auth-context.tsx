import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

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
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [merchantProfile, setMerchantProfile] = useState<MerchantProfile | null>(null);

  const loadUserProfiles = useCallback(async (currentUserId?: string | null) => {
    if (import.meta.env.DEV) return; // Keep dev mocks intact

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

      // BYPASS AUTHENTICATION IN DEV MODE
      if (import.meta.env.DEV) {
        const mockUser = {
          id: 'dev-user-id',
          email: 'developer@local.dev',
          role: 'authenticated',
          aud: 'authenticated',
        } as User;
        
        const mockProfile = {
          id: 'dev-profile-id',
          user_id: mockUser.id,
          email: mockUser.email!,
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: 'system',
          rejection_reason: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Profile;
        
        const mockMerchantProfile = {
          id: 'dev-merchant-id',
          user_id: mockUser.id,
          merchant_id: 'DEV01',
          nickname: 'DevUser',
          display_name: 'Local Developer',
          bio: 'Development environment automatically authenticated.',
          region: 'US',
          default_currency: 'USD',
          merchant_code: 'DEV',
          status: 'approved',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as MerchantProfile;

        console.info('[Auth] Development mode: Bypassing authentication with mock user.');

        setSession({ user: mockUser, access_token: 'fake-dev-token' } as Session);
        setUser(mockUser);
        setProfile(mockProfile);
        setMerchantProfile(mockMerchantProfile);
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
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/callback`;
    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isMobileViewport = window.matchMedia?.('(max-width: 1024px)').matches ?? false;
    const useManualRedirect = isStandalone || isMobileViewport;

    console.info('[Auth] Starting Google OAuth with Supabase', {
      redirectTo,
      isStandalone,
      isMobileViewport,
      useManualRedirect,
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
        redirectTo,
        skipBrowserRedirect: useManualRedirect,
      },
    });

    if (error) {
      console.error('[Auth] Google OAuth initiation failed', {
        message: error.message,
        name: error.name,
        status: 'status' in error ? error.status : undefined,
        redirectTo,
        isStandalone,
        isMobileViewport,
        useManualRedirect,
      });
      throw error;
    }

    console.info('[Auth] Google OAuth redirect prepared', {
      redirectTo,
      hasUrl: Boolean(data?.url),
      isStandalone,
      isMobileViewport,
      useManualRedirect,
    });

    if (useManualRedirect) {
      if (!data?.url) {
        throw new Error('Google OAuth redirect URL was not returned.');
      }

      window.location.assign(data.url);
    }
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  }, []);

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    setSession(null);
    setProfile(null);
    setMerchantProfile(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        isAuthenticated: !!session && !!user,
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
