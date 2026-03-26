import { MigrationService, MigrationStats } from '@/features/chat/lib/migration/service';
import { DeterministicResult, ok, fail } from '@/features/chat/lib/types';
import { supabase } from '@/integrations/supabase/client';

const svc = new MigrationService();

export async function runLegacyMigration(dryRun = true): Promise<DeterministicResult<MigrationStats>> {
  return svc.runMigration(dryRun);
}

export async function migrationHealth(): Promise<DeterministicResult<any>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_migration_health');
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail({}, error);
  }
}
