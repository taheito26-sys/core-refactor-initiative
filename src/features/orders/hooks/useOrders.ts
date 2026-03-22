import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface OrderRow {
  id: string;
  title: string;
  amount: number;
  currency: string;
  status: string;
  deal_type: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  relationship_id: string;
  created_by: string;
}

export function useOrders(statusFilter?: string) {
  return useQuery({
    queryKey: ['orders', statusFilter],
    queryFn: async (): Promise<OrderRow[]> => {
      let query = supabase
        .from('merchant_deals')
        .select('*')
        .order('created_at', { ascending: false });

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });
}
