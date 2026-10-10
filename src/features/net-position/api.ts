import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import type { PersonalLoan } from '@/lib/trading/personal-loans';
import type { DayRow } from './position';

// The generated types predate these tables (20261010210000).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string) => supabase.from(name as any);

// ─── Settings: which accounts count, and the two rates typed by hand ───

const SETTINGS_KEY = ['net-position-settings'];

export interface NetPositionSettings {
  includedAccounts: string[];
  usdRate: number | null;
  egpRate: number | null;
}

type SettingsRow = { included_accounts: string[] | null; usd_rate: number | string | null; egp_rate: number | string | null };

export function useNetPositionSettings() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SETTINGS_KEY,
    enabled: !!userId,
    retry: false,
    queryFn: async (): Promise<NetPositionSettings> => {
      const { data, error } = await table('net_position_settings').select('*').maybeSingle();
      if (error) throw error;
      const row = data as unknown as SettingsRow | null;
      return {
        includedAccounts: row?.included_accounts ?? [],
        usdRate: row?.usd_rate != null ? Number(row.usd_rate) : null,
        egpRate: row?.egp_rate != null ? Number(row.egp_rate) : null,
      };
    },
  });

  /** Saves the settings as a whole; the screen updates at once and settles on what was stored. */
  const save = async (next: NetPositionSettings) => {
    if (!userId) throw new Error('Not signed in');
    queryClient.setQueryData(SETTINGS_KEY, next);
    const { error } = await table('net_position_settings').upsert(
      { user_id: userId, included_accounts: next.includedAccounts, usd_rate: next.usdRate, egp_rate: next.egpRate, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (error) {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      throw error;
    }
  };

  return { settings: query.data ?? null, loaded: query.isSuccess, unavailable: query.isError, save };
}

// ─── Saved days: one reading of the position per day ───

const DAYS_KEY = ['net-position-days'];

type DayRowRecord = { day: string; lines: DayRow['lines'] | null; net: number | string };

export function useNetPositionDays() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: DAYS_KEY,
    enabled: !!userId,
    retry: false,
    queryFn: async (): Promise<DayRow[]> => {
      const { data, error } = await table('net_position_days').select('day, lines, net').order('day', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as DayRowRecord[]).map(r => ({ day: r.day, lines: r.lines ?? {}, net: Number(r.net) }));
    },
  });

  const save = async (row: DayRow) => {
    if (!userId) throw new Error('Not signed in');
    const { error } = await table('net_position_days').upsert(
      { user_id: userId, day: row.day, lines: row.lines, net: row.net, saved_at: new Date().toISOString() },
      { onConflict: 'user_id,day' },
    );
    if (error) throw error;
    queryClient.setQueryData<DayRow[]>(DAYS_KEY, old => [...(old ?? []).filter(r => r.day !== row.day), row].sort((a, b) => a.day.localeCompare(b.day)));
  };

  return { days: query.data ?? [], loaded: query.isSuccess, unavailable: query.isError, save };
}

// ─── Personal loans (to people who are not customers) ───

const LOANS_KEY = ['personal-loans'];

type LoanRow = {
  id: string; person: string; principal: number; currency: PersonalLoan['currency'];
  lent_at: string; note: string | null; ledger_entry_id: string | null; repayments: PersonalLoan['repayments'];
};

const toLoan = (r: LoanRow): PersonalLoan => ({
  id: r.id, person: r.person, principal: Number(r.principal), currency: r.currency,
  lentAt: new Date(r.lent_at).getTime(), note: r.note ?? undefined, ledgerEntryId: r.ledger_entry_id ?? undefined, repayments: r.repayments ?? [],
});

export function usePersonalLoans() {
  const query = useQuery({
    queryKey: LOANS_KEY,
    queryFn: async (): Promise<PersonalLoan[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.from('personal_loans' as any).select('*').order('lent_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as LoanRow[]).map(toLoan);
    },
    retry: false,
  });
  return { loans: query.data ?? [], unavailable: query.isError };
}

export function usePersonalLoanActions() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: LOANS_KEY });

  const add = async (input: { person: string; principal: number; currency: PersonalLoan['currency']; lentAt: number; note?: string; ledgerEntryId?: string }) => {
    if (!userId) throw new Error('Not signed in');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('personal_loans' as any).insert({
      user_id: userId, person: input.person, principal: input.principal, currency: input.currency,
      lent_at: new Date(input.lentAt).toISOString(), note: input.note || null, ledger_entry_id: input.ledgerEntryId ?? null, repayments: [],
    }).select('id').single();
    if (error) throw error;
    await refresh();
    return (data as unknown as { id: string }).id;
  };

  /** Replaces a loan's repayment list (the caller appends or edits, so a repayment is never lost to a stale copy). */
  const setRepayments = async (loanId: string, repayments: PersonalLoan['repayments']) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('personal_loans' as any).update({ repayments }).eq('id', loanId);
    if (error) throw error;
    await refresh();
  };

  const remove = async (loanId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('personal_loans' as any).delete().eq('id', loanId);
    if (error) throw error;
    await refresh();
  };

  return { add, setRepayments, remove };
}
