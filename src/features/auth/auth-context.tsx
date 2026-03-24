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
    const result = await lovable.auth.signInWithOAuth('google', {
      redirect_uri: window.location.origin,
    });
    if (result.error) throw result.error;
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
