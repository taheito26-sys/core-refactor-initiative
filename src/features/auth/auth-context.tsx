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

  const refreshProfile = useCallback(async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) {
      setProfile(null);
      setMerchantProfile(null);
      return;
    }

    // Fetch profile
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    setProfile(profileData as Profile | null);

    // Fetch merchant profile
    const { data: merchantData } = await supabase
      .from('merchant_profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    setMerchantProfile(merchantData as MerchantProfile | null);
  }, []);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          // Use setTimeout to avoid Supabase client deadlock
          setTimeout(() => refreshProfile(), 0);
        } else {
          setProfile(null);
          setMerchantProfile(null);
        }
        setIsLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      if (existingSession?.user) {
        refreshProfile();
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [refreshProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
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
