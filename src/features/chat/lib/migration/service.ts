import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export interface MigrationHealth {
  legacy_count: number;
  canonical_count: number;
  failed_count: number;
  last_run: Record<string, unknown>;
}

export interface MigrationRunResult {
  migrated: number;
  inserted: number;
  skipped: number;
  failed: number;
  repaired: number;
  orphaned: number;
  dry_run: boolean;
}

export async function migrateLegacyMessages(dryRun = true): Promise<DeterministicResult<MigrationRunResult>> {
  try {
    const { data, error } = await supabase.rpc('fn_chat_migrate_legacy_messages', { _dry_run: dryRun });
    if (error) throw error;
    return ok((data ?? {
      migrated: 0,
      inserted: 0,
      skipped: 0,
      failed: 0,
      repaired: 0,
      orphaned: 0,
      dry_run: dryRun,
    }) as MigrationRunResult);
  } catch (error) {
    return fail({
      migrated: 0,
      inserted: 0,
      skipped: 0,
      failed: 1,
      repaired: 0,
      orphaned: 0,
      dry_run: dryRun,
    }, error);
  }
}

export async function getMigrationHealth(): Promise<DeterministicResult<MigrationHealth>> {
  try {
    const { data, error } = await supabase.rpc('fn_chat_migration_health');
    if (error) throw error;
    return ok((data ?? {
      legacy_count: 0,
      canonical_count: 0,
      failed_count: 0,
      last_run: {},
    }) as MigrationHealth);
  } catch (error) {
    return fail({ legacy_count: 0, canonical_count: 0, failed_count: 0, last_run: {} }, error);
  }
}

export async function runScheduledMessages(limit = 50): Promise<DeterministicResult<number>> {
  try {
    const { data, error } = await supabase.rpc('fn_chat_run_scheduled_messages', { _limit: limit });
    if (error) throw error;
    return ok(Number(data ?? 0));
  } catch (error) {
    return fail(0, error);
  }
}
