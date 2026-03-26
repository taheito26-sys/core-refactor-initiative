import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function getRoomPolicy(roomId: string): Promise<DeterministicResult<{ security: any; retention: any }>> {
  try {
    const [securityRes, retentionRes] = await Promise.all([
      supabase.from('room_security_policies' as any).select('*').eq('room_id', roomId).maybeSingle(),
      supabase.from('message_retention_policies' as any).select('*').eq('room_id', roomId).maybeSingle(),
    ]);

    if (securityRes.error) throw securityRes.error;
    if (retentionRes.error) throw retentionRes.error;

    return ok({ security: securityRes.data ?? null, retention: retentionRes.data ?? null });
  } catch (error) {
    return fail({ security: null, retention: null }, error);
  }
}

export async function applyRoomPolicy(roomId: string, security: Record<string, unknown>, retention: Record<string, unknown>): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await supabase.rpc('fn_chat_apply_room_policy', {
      _room_id: roomId,
      _security: security,
      _retention: retention,
    } as any);
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}

export async function getPolicyAudit(roomId: string): Promise<DeterministicResult<any[]>> {
  try {
    const { data, error } = await supabase
      .from('policy_audit_log' as any)
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return ok((data ?? []) as any[]);
  } catch (error) {
    return fail([], error);
  }
}
