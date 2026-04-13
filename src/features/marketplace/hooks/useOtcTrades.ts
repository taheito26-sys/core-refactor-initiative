import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useEffect } from 'react';

export interface OtcTrade {
  id: string;
  listing_id: string | null;
  initiator_user_id: string;
  responder_user_id: string;
  initiator_merchant_id: string;
  responder_merchant_id: string;
  side: 'cash' | 'usdt';
  currency: string;
  amount: number;
  rate: number;
  total: number;
  counter_amount: number | null;
  counter_rate: number | null;
  counter_total: number | null;
  note: string | null;
  counter_note: string | null;
  status: 'offered' | 'countered' | 'confirmed' | 'completed' | 'cancelled' | 'expired';
  chat_room_id: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  counterparty_name?: string;
}

export type SendOfferInput = {
  listing_id: string;
  responder_user_id: string;
  responder_merchant_id: string;
  side: 'cash' | 'usdt';
  currency: string;
  amount: number;
  rate: number;
  total: number;
  note?: string;
};

export type CounterOfferInput = {
  trade_id: string;
  counter_amount: number;
  counter_rate: number;
  counter_total: number;
  counter_note?: string;
};

const MY_TRADES_KEY = ['otc', 'my-trades'];

export function useOtcTrades() {
  const { userId, merchantProfile } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: MY_TRADES_KEY,
    queryFn: async (): Promise<OtcTrade[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('otc_trades')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (error) throw error;

      // Enrich with counterparty names
      const allUserIds = new Set<string>();
      (data || []).forEach(t => {
        allUserIds.add(t.initiator_user_id);
        allUserIds.add(t.responder_user_id);
      });
      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('user_id, display_name')
        .in('user_id', [...allUserIds]);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p.display_name]));

      return (data || []).map(row => ({
        ...row,
        side: row.side as OtcTrade['side'],
        status: row.status as OtcTrade['status'],
        counterparty_name: profileMap.get(
          row.initiator_user_id === userId ? row.responder_user_id : row.initiator_user_id
        ) ?? 'Unknown',
      }));
    },
    enabled: !!userId,
  });

  // Realtime
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('otc-trades-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'otc_trades' }, () => {
        qc.invalidateQueries({ queryKey: MY_TRADES_KEY });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, qc]);

  const sendOffer = useMutation({
    mutationFn: async (input: SendOfferInput) => {
      if (!userId || !merchantProfile) throw new Error('Not authenticated');

      // 1. Create the trade
      const { data: trade, error } = await supabase
        .from('otc_trades')
        .insert({
          listing_id: input.listing_id,
          initiator_user_id: userId,
          responder_user_id: input.responder_user_id,
          initiator_merchant_id: merchantProfile.merchant_id,
          responder_merchant_id: input.responder_merchant_id,
          side: input.side,
          currency: input.currency,
          amount: input.amount,
          rate: input.rate,
          total: input.total,
          note: input.note || null,
          status: 'offered',
        })
        .select()
        .single();
      if (error) throw error;

      // 2. Auto-create a direct chat room between the two merchants
      try {
        // Check if a direct room already exists
        const { data: existingDirect } = await supabase
          .from('chat_direct_rooms')
          .select('room_id')
          .or(`and(user_a_id.eq.${userId},user_b_id.eq.${input.responder_user_id}),and(user_a_id.eq.${input.responder_user_id},user_b_id.eq.${userId})`)
          .maybeSingle();

        let chatRoomId = existingDirect?.room_id ?? null;

        if (!chatRoomId) {
          // Create a new direct room via RPC
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: newRoomId } = await (supabase.rpc as any)('fn_chat_create_room', {
            _name: `OTC Trade`,
            _type: 'direct',
            _lane: 'Personal',
            _member_merchant_ids: [merchantProfile.merchant_id, input.responder_merchant_id],
          });
          chatRoomId = newRoomId ?? null;
        }

        // Link the chat room to the trade
        if (chatRoomId) {
          await supabase
            .from('otc_trades')
            .update({ chat_room_id: chatRoomId })
            .eq('id', trade.id);
        }
      } catch (chatErr) {
        // Don't fail the trade if chat creation fails
        console.warn('[OTC] Auto-chat room creation failed:', chatErr);
      }

      return trade;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_TRADES_KEY });
    },
  });

  const counterOffer = useMutation({
    mutationFn: async (input: CounterOfferInput) => {
      const { data, error } = await supabase
        .from('otc_trades')
        .update({
          counter_amount: input.counter_amount,
          counter_rate: input.counter_rate,
          counter_total: input.counter_total,
          counter_note: input.counter_note || null,
          status: 'countered',
        })
        .eq('id', input.trade_id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_TRADES_KEY });
    },
  });

  const confirmTrade = useMutation({
    mutationFn: async (tradeId: string) => {
      const { data, error } = await supabase
        .from('otc_trades')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', tradeId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_TRADES_KEY }),
  });

  const completeTrade = useMutation({
    mutationFn: async (tradeId: string) => {
      const { data, error } = await supabase
        .from('otc_trades')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', tradeId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_TRADES_KEY }),
  });

  const cancelTrade = useMutation({
    mutationFn: async (tradeId: string) => {
      const { data, error } = await supabase
        .from('otc_trades')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', tradeId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_TRADES_KEY }),
  });

  return {
    trades: query.data ?? [],
    isLoading: query.isLoading,
    sendOffer,
    counterOffer,
    confirmTrade,
    completeTrade,
    cancelTrade,
    refetch: query.refetch,
  };
}
