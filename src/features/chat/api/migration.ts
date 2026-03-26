import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function runLegacyMigration(dryRun = true) {
  try {
    const { data, error } = await supabase.rpc('fn_chat_migrate_legacy_messages', { _dry_run: dryRun } as any);
    if (error) throw error;
    return ok(data as Record<string, unknown>);
  } catch (error) {
    return fail({}, error);
  }
}

export async function migrationHealth() {
  try {
    const { data, error } = await supabase.rpc('fn_chat_migration_health');
    if (error) throw error;
    return ok((data ?? {}) as Record<string, unknown>);
  } catch (error) {
    return fail({}, error);
  }
}
