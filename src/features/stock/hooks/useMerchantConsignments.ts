import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface RemoteConsignment {
  id: string;
  relationshipId: string;
  senderMerchantId: string;
  receiverMerchantId: string;
  senderUserId: string;
  receiverUserId: string | null;
  qty: number;
  basePriceQAR: number;
  senderSharePct: number;
  trackerRef: string | null;
  status: 'open' | 'closed' | 'cancelled';
  createdAt: string;
  /** The other merchant's display name, from my point of view. */
  counterpartyName: string;
  iAmSender: boolean;
}

export interface RemoteConsignmentEvent {
  id: string;
  consignmentId: string;
  kind: 'sale' | 'return' | 'purchase' | 'settlement';
  qty: number;
  priceQAR: number | null;
  /** Cash amount for a settlement event; null for sale/return/purchase. */
  amountQAR: number | null;
  /** A replacement purchase can be funded from a confirmed sale's proceeds. */
  fundedFromSaleId: string | null;
  reportedBy: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
}

export interface ConnectedMerchant {
  relationshipId: string;
  merchantId: string;
  name: string;
}

// The consignment tables are newer than the generated types, so they are reached untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useMerchantConsignments() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;

  const query = useQuery({
    queryKey: ['merchant-consignments', uid],
    enabled: !!uid,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: cs, error } = await db.from('merchant_consignments').select('*').order('created_at', { ascending: false });
      if (error) {
        console.warn('[consignments] unavailable:', error.message);
        return { consignments: [] as RemoteConsignment[], events: [] as RemoteConsignmentEvent[] };
      }
      const rows = (cs || []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      const merchantIds = Array.from(new Set(rows.flatMap(r => [r.sender_merchant_id, r.receiver_merchant_id])));
      const { data: profiles } = merchantIds.length
        ? await supabase.from('merchant_profiles').select('merchant_id, display_name').in('merchant_id', merchantIds)
        : { data: [] };
      const names = new Map(((profiles || []) as { merchant_id: string; display_name: string | null }[]).map(p => [p.merchant_id, p.display_name || p.merchant_id]));
      const consignments: RemoteConsignment[] = rows.map(r => {
        const iAmSender = r.sender_user_id === uid;
        return {
          id: r.id,
          relationshipId: r.relationship_id,
          senderMerchantId: r.sender_merchant_id,
          receiverMerchantId: r.receiver_merchant_id,
          senderUserId: r.sender_user_id,
          receiverUserId: r.receiver_user_id,
          qty: Number(r.qty_usdt),
          basePriceQAR: Number(r.base_price_qar),
          senderSharePct: Number(r.sender_share_pct),
          trackerRef: r.tracker_ref,
          status: r.status,
          createdAt: r.created_at,
          iAmSender,
          counterpartyName: names.get(iAmSender ? r.receiver_merchant_id : r.sender_merchant_id) || '',
        };
      });
      const ids = consignments.map(c => c.id);
      const { data: ev } = ids.length
        ? await db.from('merchant_consignment_events').select('*').in('consignment_id', ids).order('created_at', { ascending: true })
        : { data: [] };
      const events: RemoteConsignmentEvent[] = ((ev || []) as Record<string, any>[]).map(e => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id: e.id,
        consignmentId: e.consignment_id,
        kind: e.kind,
        qty: Number(e.qty_usdt),
        priceQAR: e.price_qar == null ? null : Number(e.price_qar),
        amountQAR: e.amount_qar == null ? null : Number(e.amount_qar),
        fundedFromSaleId: e.funded_from_sale_id ?? null,
        reportedBy: e.reported_by,
        status: e.status,
        createdAt: e.created_at,
      }));
      return { consignments, events };
    },
  });

  useEffect(() => {
    if (!uid) return;
    const refresh = () => { void qc.invalidateQueries({ queryKey: ['merchant-consignments', uid] }); };
    const channel = supabase
      .channel(`merchant-consignments-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_consignments' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_consignment_events' }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [uid, qc]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['merchant-consignments', uid] });

  const create = useMutation({
    mutationFn: async (a: { relationshipId: string; qty: number; basePrice: number; senderSharePct: number; trackerRef: string; clientRequestId?: string }): Promise<string> => {
      const { data, error } = await db.rpc('create_merchant_consignment_v2', {
        p_relationship_id: a.relationshipId, p_qty: a.qty, p_base_price: a.basePrice,
        p_sender_share_pct: a.senderSharePct, p_tracker_ref: a.trackerRef,
        p_client_request_id: a.clientRequestId ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const report = useMutation({
    mutationFn: async (a: {
      consignmentId: string;
      kind: RemoteConsignmentEvent['kind'];
      qty: number;
      price?: number;
      amountQAR?: number;
      fundedFromSaleId?: string;
      clientRequestId?: string;
    }) => {
      const { error } = await db.rpc('report_consignment_event_v2', {
        p_consignment_id: a.consignmentId, p_kind: a.kind, p_qty: a.qty, p_price: a.price ?? null,
        p_amount_qar: a.amountQAR ?? null,
        p_funded_from_sale_id: a.fundedFromSaleId ?? null,
        p_client_request_id: a.clientRequestId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const respond = useMutation({
    mutationFn: async (a: { eventId: string; accept: boolean }) => {
      const { error } = await db.rpc('respond_consignment_event', { p_event_id: a.eventId, p_accept: a.accept });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { ...query, data: query.data ?? { consignments: [], events: [] }, create, report, respond };
}

/** Active merchant connections, so a consignment can be sent to a linked merchant. */
export function useConnectedMerchants() {
  return useQuery({
    queryKey: ['consignment-connected-merchants'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ConnectedMerchant[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: me } = await supabase.from('merchant_profiles').select('merchant_id').eq('user_id', user.id).maybeSingle();
      const myId = (me as { merchant_id?: string } | null)?.merchant_id;
      if (!myId) return [];
      const { data: rels } = await supabase
        .from('merchant_relationships')
        .select('id, merchant_a_id, merchant_b_id, status')
        .or(`merchant_a_id.eq.${myId},merchant_b_id.eq.${myId}`);
      const active = ((rels || []) as { id: string; merchant_a_id: string; merchant_b_id: string; status: string }[]).filter(r => r.status === 'active');
      const others = active.map(r => ({ relationshipId: r.id, merchantId: r.merchant_a_id === myId ? r.merchant_b_id : r.merchant_a_id }));
      if (!others.length) return [];
      const { data: profiles } = await supabase.from('merchant_profiles').select('merchant_id, display_name').in('merchant_id', others.map(o => o.merchantId));
      const names = new Map(((profiles || []) as { merchant_id: string; display_name: string | null }[]).map(p => [p.merchant_id, (p.display_name || '').trim()]));
      return others.map(o => ({ ...o, name: names.get(o.merchantId) || o.merchantId }));
    },
  });
}
