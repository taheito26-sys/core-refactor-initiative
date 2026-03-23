import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AuditLogRow {
  id: string;
  admin_user_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export function useAdminAuditLogs(search: string = '') {
  return useQuery({
    queryKey: ['admin-audit', search],
    queryFn: async (): Promise<AuditLogRow[]> => {
      let query = supabase
        .from('admin_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      const { data, error } = await query;
      if (error) throw error;

      let rows = (data ?? []) as AuditLogRow[];
      if (search.trim()) {
        const q = search.toLowerCase();
        rows = rows.filter(r =>
          r.action.toLowerCase().includes(q) ||
          r.target_type.toLowerCase().includes(q) ||
          r.admin_user_id.toLowerCase().includes(q) ||
          r.target_id?.toLowerCase().includes(q)
        );
      }
      return rows;
    },
    refetchInterval: 15_000,
  });
}
