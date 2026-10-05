import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import type { MonthBridge, MonthPosition } from '@/lib/trading/net-position';
import type { MonthlySnapshot } from './snapshots';
import type { OpeningOverride } from './overrides';

const KEY = ['monthly-positions'];

type Row = {
  month: string; frozen: boolean; closed_at: string; reopened_at: string | null; reopen_count: number;
  position: MonthPosition; bridge: MonthBridge; rates: MonthlySnapshot['rates'];
};

const toSnapshot = (r: Row): MonthlySnapshot => ({
  month: r.month, frozen: r.frozen, closedAt: r.closed_at, reopenedAt: r.reopened_at, reopenCount: r.reopen_count,
  position: r.position, bridge: r.bridge, rates: r.rates,
});

/**
 * The user's saved month-end snapshots, by month. `unavailable` is set when
 * the table is missing (the migration has not been applied yet), so the page
 * can say so instead of failing.
 */
export function useMonthlySnapshots() {
  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Map<string, MonthlySnapshot>> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.from('monthly_positions' as any).select('*');
      if (error) throw error;
      return new Map(((data ?? []) as unknown as Row[]).map(r => [r.month, toSnapshot(r)]));
    },
    retry: false,
  });
  return { snapshots: query.data ?? new Map<string, MonthlySnapshot>(), unavailable: query.isError, loading: query.isLoading };
}

export function useMonthClosing() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

  /** Saves (or re-saves) a month's figures as frozen. */
  const close = async (month: string, position: MonthPosition, bridge: MonthBridge, rates: MonthlySnapshot['rates'], previous?: MonthlySnapshot) => {
    if (!userId) throw new Error('Not signed in');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('monthly_positions' as any).upsert({
      user_id: userId, month, frozen: true, closed_at: new Date().toISOString(),
      reopened_at: previous?.reopenedAt ?? null, reopen_count: previous?.reopenCount ?? 0,
      position, bridge, rates,
    }, { onConflict: 'user_id,month' });
    if (error) throw error;
    await refresh();
  };

  /** Unfreezes a month; the saved figures are kept and the re-open is counted. */
  const reopen = async (snapshot: MonthlySnapshot) => {
    if (!userId) throw new Error('Not signed in');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('monthly_positions' as any)
      .update({ frozen: false, reopened_at: new Date().toISOString(), reopen_count: snapshot.reopenCount + 1 })
      .eq('user_id', userId).eq('month', snapshot.month);
    if (error) throw error;
    await refresh();
  };

  return { close, reopen };
}

// ─── Opening positions entered by hand ───

const OPENINGS_KEY = ['net-position-openings'];

type OpeningRow = { month: string; manual: OpeningOverride['manual']; offsets: OpeningOverride['offsets']; updated_at: string };

export function useOpeningOverrides() {
  const query = useQuery({
    queryKey: OPENINGS_KEY,
    queryFn: async (): Promise<Map<string, OpeningOverride>> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.from('net_position_openings' as any).select('*');
      if (error) throw error;
      return new Map(((data ?? []) as unknown as OpeningRow[]).map(r => [r.month, { month: r.month, manual: r.manual, offsets: r.offsets, updatedAt: r.updated_at }]));
    },
    retry: false,
  });
  return { overrides: query.data ?? new Map<string, OpeningOverride>(), unavailable: query.isError };
}

export function useOpeningOverrideSaving() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: OPENINGS_KEY });

  const save = async (month: string, manual: OpeningOverride['manual'], offsets: OpeningOverride['offsets']) => {
    if (!userId) throw new Error('Not signed in');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('net_position_openings' as any).upsert(
      { user_id: userId, month, manual, offsets, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,month' },
    );
    if (error) throw error;
    await refresh();
  };

  const clear = async (month: string) => {
    if (!userId) throw new Error('Not signed in');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('net_position_openings' as any).delete().eq('user_id', userId).eq('month', month);
    if (error) throw error;
    await refresh();
  };

  return { save, clear };
}
