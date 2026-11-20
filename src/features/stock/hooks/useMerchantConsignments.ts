import { useEffect, useRef } from 'react';
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
  /** A profit ratio change waiting for an answer, and who proposed it. */
  pendingSharePct: number | null;
  pendingShareBy: string | null;
}

export interface RemoteConsignmentEvent {
  id: string;
  consignmentId: string;
  kind: 'sale' | 'return' | 'purchase' | 'settlement' | 'shortfall';
  qty: number;
  priceQAR: number | null;
  /** Cash amount for a settlement event; null for sale/return/purchase. */
  amountQAR: number | null;
  /** A replacement purchase can be funded from a confirmed sale's proceeds. */
  fundedFromSaleId: string | null;
  reportedBy: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
  /** The sender's share when this was reported; a later ratio change never re-prices it. */
  senderSharePct: number | null;
  /** Set when this report is a counter-proposal to an earlier one. */
  replacesEventId: string | null;
  /** A sale where the merchant keeps the USDT at the price: the whole profit is the sender's. */
  isBuyout: boolean;
}

export interface ConnectedMerchant {
  relationshipId: string;
  merchantId: string;
  name: string;
}

// The consignment tables are newer than the generated types, so they are reached untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

let channelSeq = 0;

export function useMerchantConsignments() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;
  // One channel per mounted copy: a repeated name returns the already-subscribed channel and adding listeners to it throws.
  const channelName = useRef(`merchant-consignments-${uid}-${(channelSeq += 1)}`);

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
          pendingSharePct: r.pending_share_pct == null ? null : Number(r.pending_share_pct),
          pendingShareBy: r.pending_share_by ?? null,
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
        senderSharePct: e.sender_share_pct == null ? null : Number(e.sender_share_pct),
        replacesEventId: e.replaces_event_id ?? null,
        isBuyout: !!e.is_buyout,
      }));
      return { consignments, events };
    },
  });

  useEffect(() => {
    if (!uid) return;
    const refresh = () => { void qc.invalidateQueries({ queryKey: ['merchant-consignments', uid] }); };
    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_consignments' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_consignment_events' }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [uid, qc]);

  const actions = useMerchantConsignmentActions();

  return { ...query, data: query.data ?? { consignments: [], events: [] }, ...actions };
}

/**
 * Send, report, answer, correct and cancel, without loading or watching the
 * list — for the places that only act (dialogs).
 */
export function useMerchantConsignmentActions() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;
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
      const { data, error } = await db.rpc('report_consignment_event_v2', {
        p_consignment_id: a.consignmentId, p_kind: a.kind, p_qty: a.qty, p_price: a.price ?? null,
        p_amount_qar: a.amountQAR ?? null,
        p_funded_from_sale_id: a.fundedFromSaleId ?? null,
        p_client_request_id: a.clientRequestId ?? null,
      });
      if (error) throw error;
      return data as string;
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

  const counter = useMutation({
    mutationFn: async (a: { eventId: string; qty: number; price?: number }): Promise<string> => {
      const { data, error } = await db.rpc('counter_consignment_event', { p_event_id: a.eventId, p_qty: a.qty, p_price: a.price ?? null });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
  const proposeShare = useMutation({
    mutationFn: async (a: { consignmentId: string; senderSharePct: number }) => {
      const { error } = await db.rpc('propose_consignment_share', { p_consignment_id: a.consignmentId, p_sender_share_pct: a.senderSharePct });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const respondShare = useMutation({
    mutationFn: async (a: { consignmentId: string; accept: boolean }) => {
      const { error } = await db.rpc('respond_consignment_share', { p_consignment_id: a.consignmentId, p_accept: a.accept });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const withdrawShare = useMutation({
    mutationFn: async (consignmentId: string) => {
      const { error } = await db.rpc('withdraw_consignment_share', { p_consignment_id: consignmentId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const buyout = useMutation({
    mutationFn: async (a: { consignmentId: string; qty: number; price: number; clientRequestId?: string }): Promise<string> => {
      const { data, error } = await db.rpc('report_consignment_buyout', {
        p_consignment_id: a.consignmentId, p_qty: a.qty, p_price: a.price, p_client_request_id: a.clientRequestId ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
  const shortfall = useMutation({
    mutationFn: async (a: { consignmentId: string; qty: number; clientRequestId?: string }): Promise<string> => {
      const { data, error } = await db.rpc('report_consignment_shortfall', {
        p_consignment_id: a.consignmentId, p_qty: a.qty, p_client_request_id: a.clientRequestId ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: async (consignmentId: string) => {
      const { error } = await db.rpc('cancel_merchant_consignment', { p_consignment_id: consignmentId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, report, respond, counter, proposeShare, respondShare, withdrawShare, cancel, buyout, shortfall };
}

/** Active merchant connections, so a consignment can be sent to a linked merchant. */
export function useConnectedMerchants() {
  const { user } = useAuth();
  const uid = user?.id;
  return useQuery({
    // The user is part of the key: otherwise a second login in the same tab
    // can show the previous user's connected merchants.
    queryKey: ['consignment-connected-merchants', uid],
    enabled: !!uid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ConnectedMerchant[]> => {
      if (!uid) return [];
      const { data: me } = await supabase.from('merchant_profiles').select('merchant_id').eq('user_id', uid).maybeSingle();
      const myId = (me as { merchant_id?: string } | null)?.merchant_id;
      if (!myId) return [];
      const { data: rels } = await supabase
        .from('merchant_relationships')
        .select('id, merchant_a_id, merchant_b_id, status, created_at')
        .or(`merchant_a_id.eq.${myId},merchant_b_id.eq.${myId}`)
        .order('created_at', { ascending: false });
      const active = ((rels || []) as { id: string; merchant_a_id: string; merchant_b_id: string; status: string }[]).filter(r => r.status === 'active');
      // Legacy data can contain more than one active row for the same pair.
      // Show the merchant once, using the newest relationship row.
      const byMerchant = new Map<string, { relationshipId: string; merchantId: string }>();
      for (const r of active) {
        const other = r.merchant_a_id === myId ? r.merchant_b_id : r.merchant_a_id;
        if (other && !byMerchant.has(other)) byMerchant.set(other, { relationshipId: r.id, merchantId: other });
      }
      const others = [...byMerchant.values()];
      if (!others.length) return [];
      const { data: profiles } = await supabase.from('merchant_profiles').select('merchant_id, display_name').in('merchant_id', others.map(o => o.merchantId));
      const names = new Map(((profiles || []) as { merchant_id: string; display_name: string | null }[]).map(p => [p.merchant_id, (p.display_name || '').trim()]));
      return others
        .map(o => ({ ...o, name: names.get(o.merchantId) || o.merchantId }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}
