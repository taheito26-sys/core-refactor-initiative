import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { UnifiedChatInbox } from '@/features/merchants/components/UnifiedChatInbox';
import '@/styles/tracker.css';

interface RelationshipRow {
  id: string;
  merchant_a_id: string;
  merchant_b_id: string;
  counterparty_name: string;
  counterparty_nickname: string;
  counterparty_code: string;
}

export default function ChatPage() {
  const { settings } = useTheme();
  const { userId, merchantProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [relationships, setRelationships] = useState<RelationshipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const isRTL = settings.language === 'ar';

  const initialRelationshipId = searchParams.get('conversation');
  const targetMessageId = searchParams.get('message');
  const shouldHighlight = searchParams.get('highlight') === '1';

  useEffect(() => {
    if (!userId || !merchantProfile?.merchant_id) return;
    const myId = merchantProfile.merchant_id;
    const load = async () => {
      setLoading(true);
      try {
        const [relsRes, profilesRes] = await Promise.all([
          supabase
            .from('merchant_relationships')
            .select('*')
            .order('created_at', { ascending: false }),
          supabase
            .from('merchant_profiles')
            .select('merchant_id, display_name, nickname, merchant_code'),
        ]);

        const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.merchant_id, p]));
        const enriched = (relsRes.data || []).map((r: any) => {
          const cpId = r.merchant_a_id === myId ? r.merchant_b_id : r.merchant_a_id;
          const cp = profileMap.get(cpId) as any;
          return {
            ...r,
            counterparty_name: cp?.display_name || cpId,
            counterparty_nickname: cp?.nickname || '',
            counterparty_code: cp?.merchant_code || '',
          };
        });
        setRelationships(enriched);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId, merchantProfile?.merchant_id]);

  const validConversation = useMemo(
    () => !!initialRelationshipId && relationships.some((r) => r.id === initialRelationshipId),
    [initialRelationshipId, relationships],
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="chat-full-page" dir={isRTL ? 'rtl' : 'ltr'}>
      <UnifiedChatInbox
        relationships={relationships}
        fullPage
        initialRelationshipId={validConversation ? initialRelationshipId : null}
        targetMessageId={targetMessageId}
        highlightTargetMessage={shouldHighlight}
        onAnchorHandled={() => {
          if (!searchParams.get('conversation') && !searchParams.get('message') && !searchParams.get('highlight')) return;
          const next = new URLSearchParams(searchParams);
          next.delete('message');
          next.delete('highlight');
          setSearchParams(next, { replace: true });
        }}
      />
    </div>
  );
}
