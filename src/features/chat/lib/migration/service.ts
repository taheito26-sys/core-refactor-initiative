import { supabase } from '@/integrations/supabase/client';
import { parseLegacyContent } from './legacy-parser';
import { ok, fail, DeterministicResult } from '../types';

export interface MigrationStats {
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
  audit: any[];
}

export class MigrationService {
  async runMigration(dryRun = true): Promise<DeterministicResult<MigrationStats>> {
    const stats: MigrationStats = {
      total: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      audit: [],
    };

    try {
      // 1. Fetch legacy messages (merchant_messages)
      // Note: Assuming a legacy table exists for migration
      const { data: legacy, error: fetchError } = await supabase
        .from('merchant_messages' as any)
        .select('*')
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      stats.total = legacy?.length ?? 0;

      for (const row of (legacy ?? []) as any[]) {
        try {
          // 2. Check for existing migration (idempotency)
          const { data: existing } = await supabase
            .from('messages' as any)
            .select('id')
            .eq('client_nonce', `migrated_${row.id}`)
            .maybeSingle();

          if (existing) {
            stats.skipped++;
            continue;
          }

          // 3. Parse content
          const parsed = parseLegacyContent(row.body);

          // 4. Transform to new schema
          const newMessage = {
            room_id: row.room_id || row.relationship_id, // Map accordingly
            sender_id: row.sender_id,
            body: parsed.body,
            body_json: parsed.bodyJson,
            message_type: parsed.type,
            client_nonce: `migrated_${row.id}`,
            created_at: row.created_at,
            status: 'sent',
          };

          if (!dryRun) {
            const { error: insertError } = await supabase
              .from('messages' as any)
              .insert(newMessage);
            
            if (insertError) throw insertError;
            
            // Log to audit table
            await supabase.from('migration_audit_log' as any).insert({
              legacy_id: row.id,
              new_id: null, // If auto-gen
              status: 'success',
              payload: newMessage
            });
          }

          stats.migrated++;
        } catch (err) {
          stats.failed++;
          stats.audit.push({ id: row.id, error: String(err) });
        }
      }

      return ok(stats);
    } catch (error) {
      return fail(stats, error);
    }
  }
}
