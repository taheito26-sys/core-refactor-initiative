import { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { UnifiedChatInbox } from '@/features/merchants/components/UnifiedChatInbox';
import { useChatAttention } from '@/hooks/useChatAttention';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { useChatStore } from '@/lib/chat-store';

export default function ChatPage() {
  const { userId, merchantProfile } = useAuth();
  const merchantId = merchantProfile?.merchant_id;
  const [relationships, setRelationships] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Register attention tracking for unread suppression
  useChatAttention();

  // Fetch relationships
  useEffect(() => {
    if (!merchantId) return;

    const load = async () => {
      setLoading(true);
      try {
        const { data: rels, error } = await supabase
          .from('merchant_relationships')
          .select('*')
          .or(`merchant_a_id.eq.${merchantId},merchant_b_id.eq.${merchantId}`)
          .eq('status', 'active');

        if (error) throw error;

        if (!rels?.length) {
          setRelationships([]);
          setLoading(false);
          return;
        }

        // Get counterparty profiles
        const counterpartyIds = rels.map(r =>
          r.merchant_a_id === merchantId ? r.merchant_b_id : r.merchant_a_id
        );

        const { data: profiles } = await supabase
          .from('merchant_profiles')
          .select('merchant_id, display_name, nickname, merchant_code')
          .in('merchant_id', counterpartyIds);

        const profileMap = new Map(
          (profiles || []).map(p => [p.merchant_id, p])
        );

        const enriched = rels.map(r => {
          const cpId = r.merchant_a_id === merchantId ? r.merchant_b_id : r.merchant_a_id;
          const cp = profileMap.get(cpId);
          return {
            ...r,
            counterparty_name: cp?.display_name || cpId,
            counterparty_nickname: cp?.nickname || cpId,
            counterparty_code: cp?.merchant_code || '',
          };
        });

        setRelationships(enriched);
      } catch (err) {
        console.error('Failed to load relationships for chat:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [merchantId]);

  // Register realtime for unread tracking
  const relationshipIds = relationships.map(r => r.id);
  useChatRealtime({ relationshipIds });

  // Sync unread counts
  useEffect(() => {
    if (!userId || !relationshipIds.length) return;

    supabase
      .rpc('get_unread_counts', { _user_id: userId })
      .then(({ data }) => {
        if (data) {
          const counts: Record<string, number> = {};
          (data as Array<{ relationship_id: string; unread_count: number }>).forEach(r => {
            counts[r.relationship_id] = r.unread_count;
          });
          useChatStore.getState().setUnreadCounts(counts);
        }
      });
  }, [userId, relationshipIds.length]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <UnifiedChatInbox
      relationships={relationships}
      fullPage
    />
  );
}
