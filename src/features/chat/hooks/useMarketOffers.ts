import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cancelMarketOffer, createMarketOffer, getMarketOffers } from '../api/chat';
import type { ChatMarketOffer, CreateMarketOfferInput } from '../types';

export const MARKET_OFFERS_KEY = (roomId: string) => ['chat', 'market-offers', roomId];

export function useMarketOffers(roomId: string | null, enabled = true) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: roomId ? MARKET_OFFERS_KEY(roomId) : ['chat', 'market-offers', 'idle'],
    queryFn: () => getMarketOffers(roomId!),
    enabled: !!roomId && enabled,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!roomId || !enabled) return;

    const channel = supabase
      .channel(`market-offers-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'market_offers', filter: `room_id=eq.${roomId}` },
        () => {
          qc.invalidateQueries({ queryKey: MARKET_OFFERS_KEY(roomId) });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, enabled, qc]);

  const create = useMutation({
    mutationFn: (input: CreateMarketOfferInput) => createMarketOffer(input),
    onSuccess: (offer) => {
      if (!roomId) return;
      qc.setQueryData<ChatMarketOffer[]>(MARKET_OFFERS_KEY(roomId), (prev) =>
        prev ? [offer, ...prev.filter((item) => item.id !== offer.id)] : [offer],
      );
    },
  });

  const cancel = useMutation({
    mutationFn: (offerId: string) => cancelMarketOffer(offerId),
    onSuccess: (offer) => {
      if (!roomId) return;
      qc.setQueryData<ChatMarketOffer[]>(MARKET_OFFERS_KEY(roomId), (prev) =>
        prev?.map((item) => (item.id === offer.id ? offer : item)) ?? [offer],
      );
    },
  });

  return {
    offers: query.data ?? [],
    isLoading: query.isLoading,
    create,
    cancel,
    refetch: query.refetch,
  };
}
