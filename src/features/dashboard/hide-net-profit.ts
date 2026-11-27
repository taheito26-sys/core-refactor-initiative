// ─── Hide the monthly net profit ───────────────────────────────────
//
// A merchant can mask the net profit figure on the dashboard. The choice is
// kept until they flip it back: on the device (localStorage, never cleared on
// sign-out) and on their account (auth user metadata), so it also survives a
// reinstall or a new device. Every mounted dashboard shares one store, so the
// tile and the hero always agree.

import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export const HIDE_NET_PROFIT_META = 'hide_net_profit';
export const MASK = '••••••';

const storageKey = (userId: string) => `dh-hide-net-profit:${userId}`;

let current = false;
let currentUser: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function readLocal(userId: string): boolean | null {
  try {
    const v = localStorage.getItem(storageKey(userId));
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function writeLocal(userId: string, hidden: boolean) {
  try { localStorage.setItem(storageKey(userId), hidden ? '1' : '0'); } catch { /* storage unavailable */ }
}

/** Loads the saved choice for this user: the account's copy wins, then the device's, else shown. */
export function loadHiddenNetProfit(userId: string, metadata: Record<string, unknown> | null | undefined) {
  const fromAccount = metadata?.[HIDE_NET_PROFIT_META];
  const next = typeof fromAccount === 'boolean' ? fromAccount : readLocal(userId) ?? false;
  if (typeof fromAccount === 'boolean') writeLocal(userId, fromAccount);
  if (currentUser !== userId || current !== next) {
    currentUser = userId;
    current = next;
    emit();
  }
}

export function setHiddenNetProfit(userId: string, hidden: boolean) {
  currentUser = userId;
  current = hidden;
  writeLocal(userId, hidden);
  emit();
  void supabase.auth.updateUser({ data: { [HIDE_NET_PROFIT_META]: hidden } }).catch(() => { /* the device copy still holds it */ });
}

/** The signed-in user, or none where a screen is drawn outside the app's sign-in (a preview or a test). */
function useOptionalUser() {
  try {
    return useAuth().user;
  } catch {
    return null;
  }
}

export function useHiddenNetProfit(): [boolean, () => void] {
  const user = useOptionalUser();
  const userId = user?.id ?? null;
  const metadata = user?.user_metadata as Record<string, unknown> | undefined;
  useEffect(() => { if (userId) loadHiddenNetProfit(userId, metadata); }, [userId, metadata]);
  const hidden = useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => (userId && currentUser === userId ? current : (userId ? readLocal(userId) ?? false : false)),
  );
  return [hidden, () => { if (userId) setHiddenNetProfit(userId, !hidden); }];
}
