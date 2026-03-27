import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useEffect } from 'react';

export interface Message {
  id: string;
  relationship_id: string;
  sender_id: string;
  content: string;
  read_at: string | null;
  created_at: string;
  expires_at?: string | null;
}

export function useRelationshipMessages(relationshipId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['messages', relationshipId],
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase
        .from('merchant_messages')
        .select('*')
        .eq('relationship_id', relationshipId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!relationshipId,
  });

  // Realtime subscription
  useEffect(() => {
    if (!relationshipId) return;

    const channel = supabase
      .channel(`messages:${relationshipId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'merchant_messages',
          filter: `relationship_id=eq.${relationshipId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['messages', relationshipId] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [relationshipId, qc]);

  return query;
}

export function useSendMessage() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: { relationship_id: string; content: string }) => {
      const { error } = await supabase
        .from('merchant_messages')
        .insert({
          relationship_id: input.relationship_id,
          sender_id: userId!,
          content: input.content,
        } as any);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['messages', vars.relationship_id] });
    },
  });
}