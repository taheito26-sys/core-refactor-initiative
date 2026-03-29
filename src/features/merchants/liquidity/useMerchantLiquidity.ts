import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import {
  aggregateLiquidityOverview,
  computePublishedExact,
  computePublishedRange,
  filterLiquidityEntries,
  isLiquidityStale,
  rankLiquidityEntries,
  type InternalLiquiditySnapshot,
  type LiquidityBoardEntry,
  type LiquidityFilters,
  type LiquidityPublishProfile,
} from './liquidity-model';

interface MerchantRelationship {
  id: string;
  merchant_a_id: string;
  merchant_b_id: string;
  status: string;
}

const defaultProfile = (merchantId: string): LiquidityPublishProfile => ({
  merchantId,
  publishCashEnabled: false,
  publishUsdtEnabled: false,
  publishedCashAmount: null,
  publishedUsdtAmount: null,
  cashPublishMode: 'status',
  usdtPublishMode: 'status',
  cashRangeMin: null,
  cashRangeMax: null,
  usdtRangeMin: null,
  usdtRangeMax: null,
  cashStatus: 'unavailable',
  usdtStatus: 'unavailable',
  reserveBufferCash: 0,
  reserveBufferUsdt: 0,
  visibilityScope: 'relationships',
  autoSyncEnabled: false,
  lastPublishedAt: null,
  expiresAt: null,
  status: 'active',
});

export function useMerchantLiquidity() {
  const { merchantProfile, userId } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['merchant-liquidity', merchantProfile?.merchant_id, userId],
    enabled: !!merchantProfile?.merchant_id && !!userId,
    queryFn: async () => {
      const myMerchantId = merchantProfile?.merchant_id as string;

      const [relationshipsRes, profilesRes, postingsRes, accountsRes, ledgerRes, allocationsRes] = await Promise.all([
        supabase
          .from('merchant_relationships')
          .select('id, merchant_a_id, merchant_b_id, status')
          .or(`merchant_a_id.eq.${myMerchantId},merchant_b_id.eq.${myMerchantId}`),
        supabase
          .from('merchant_profiles')
          .select('merchant_id, display_name, region'),
        supabase
          .from('merchant_liquidity_profiles')
          .select('*'),
        supabase
          .from('cash_accounts')
          .select('id, status')
          .eq('user_id', userId as string),
        supabase
          .from('cash_ledger')
          .select('account_id, direction, amount')
          .eq('user_id', userId as string),
        supabase
          .from('order_allocations')
          .select('allocated_usdt, status')
          .eq('merchant_id', myMerchantId),
      ]);

      if (relationshipsRes.error) throw relationshipsRes.error;
      if (profilesRes.error) throw profilesRes.error;
      const liquidityTableMissing = postingsRes.error?.code === '42P01';
      if (postingsRes.error && !liquidityTableMissing) throw postingsRes.error;

      const relationships = (relationshipsRes.data || []) as MerchantRelationship[];
      const profiles = profilesRes.data || [];
      const postings = ((liquidityTableMissing ? [] : postingsRes.data) || []) as any[];

      const profileMap = new Map(profiles.map((p: any) => [p.merchant_id, p]));
      const relByCounterparty = new Map<string, MerchantRelationship>();

      for (const rel of relationships) {
        const cp = rel.merchant_a_id === myMerchantId ? rel.merchant_b_id : rel.merchant_a_id;
        relByCounterparty.set(cp, rel);
      }

      const activeAccountIds = new Set(((accountsRes.error ? [] : accountsRes.data) || []).filter((a: any) => a.status === 'active').map((a: any) => a.id));
      const cashAvailable = ((ledgerRes.error ? [] : ledgerRes.data) || []).reduce((sum: number, row: any) => {
        if (!activeAccountIds.has(row.account_id)) return sum;
        const signed = row.direction === 'in' ? Number(row.amount || 0) : -Number(row.amount || 0);
        return sum + signed;
      }, 0);

      const reservedUsdt = ((allocationsRes.error ? [] : allocationsRes.data) || []).reduce((sum: number, row: any) => {
        if (row.status === 'void' || row.status === 'cancelled') return sum;
        return sum + Number(row.allocated_usdt || 0);
      }, 0);

      const internal: InternalLiquiditySnapshot = {
        cashAvailable: Math.max(0, cashAvailable),
        usdtAvailable: Math.max(0, reservedUsdt),
        reservedCash: 0,
        reservedUsdt,
      };

      const myPosting = postings.find((p) => p.merchant_id === myMerchantId);
      const profile: LiquidityPublishProfile = myPosting ? {
        merchantId: myPosting.merchant_id,
        publishCashEnabled: Boolean(myPosting.publish_cash_enabled),
        publishUsdtEnabled: Boolean(myPosting.publish_usdt_enabled),
        publishedCashAmount: myPosting.published_cash_amount == null ? null : Number(myPosting.published_cash_amount),
        publishedUsdtAmount: myPosting.published_usdt_amount == null ? null : Number(myPosting.published_usdt_amount),
        cashPublishMode: myPosting.cash_publish_mode,
        usdtPublishMode: myPosting.usdt_publish_mode,
        cashRangeMin: myPosting.cash_range_min == null ? null : Number(myPosting.cash_range_min),
        cashRangeMax: myPosting.cash_range_max == null ? null : Number(myPosting.cash_range_max),
        usdtRangeMin: myPosting.usdt_range_min == null ? null : Number(myPosting.usdt_range_min),
        usdtRangeMax: myPosting.usdt_range_max == null ? null : Number(myPosting.usdt_range_max),
        cashStatus: myPosting.cash_status,
        usdtStatus: myPosting.usdt_status,
        reserveBufferCash: Number(myPosting.reserve_buffer_cash || 0),
        reserveBufferUsdt: Number(myPosting.reserve_buffer_usdt || 0),
        visibilityScope: myPosting.visibility_scope,
        autoSyncEnabled: Boolean(myPosting.auto_sync_enabled),
        lastPublishedAt: myPosting.last_published_at,
        expiresAt: myPosting.expires_at,
        status: myPosting.status,
      } : defaultProfile(myMerchantId);

      const now = Date.now();

      const boardEntries: LiquidityBoardEntry[] = postings
        .filter((posting) => posting.status !== 'paused')
        .map((posting) => {
          const merchantId = posting.merchant_id as string;
          const rel = relByCounterparty.get(merchantId) || null;
          const profileRow = profileMap.get(merchantId);
          const updatedAt = posting.last_published_at || posting.updated_at || posting.created_at;
          const isMine = merchantId === myMerchantId;

          if (!isMine && posting.visibility_scope === 'relationships' && !rel) {
            return null;
          }

          const cashExact = computePublishedExact({
            exactAmount: posting.published_cash_amount,
            reserveBuffer: posting.reserve_buffer_cash,
            internalAvailable: isMine && posting.auto_sync_enabled ? internal.cashAvailable : undefined,
            reservedCommitments: posting.reserved_cash_commitments,
          });

          const usdtExact = computePublishedExact({
            exactAmount: posting.published_usdt_amount,
            reserveBuffer: posting.reserve_buffer_usdt,
            internalAvailable: isMine && posting.auto_sync_enabled ? internal.usdtAvailable : undefined,
            reservedCommitments: posting.reserved_usdt_commitments,
          });

          const cashRange = computePublishedRange({
            minAmount: posting.cash_range_min,
            maxAmount: posting.cash_range_max,
            reserveBuffer: posting.reserve_buffer_cash,
            internalAvailable: isMine && posting.auto_sync_enabled ? internal.cashAvailable : undefined,
            reservedCommitments: posting.reserved_cash_commitments,
          });

          const usdtRange = computePublishedRange({
            minAmount: posting.usdt_range_min,
            maxAmount: posting.usdt_range_max,
            reserveBuffer: posting.reserve_buffer_usdt,
            internalAvailable: isMine && posting.auto_sync_enabled ? internal.usdtAvailable : undefined,
            reservedCommitments: posting.reserved_usdt_commitments,
          });

          return {
            merchantId,
            relationshipId: rel?.id || null,
            merchantName: profileRow?.display_name || merchantId,
            relationshipStatus: rel?.status || (isMine ? 'active' : 'network'),
            region: profileRow?.region || null,
            cash: {
              enabled: Boolean(posting.publish_cash_enabled),
              mode: posting.cash_publish_mode,
              exactAmount: cashExact,
              rangeMin: cashRange.min,
              rangeMax: cashRange.max,
              status: posting.cash_status,
              reserveBuffer: Number(posting.reserve_buffer_cash || 0),
            },
            usdt: {
              enabled: Boolean(posting.publish_usdt_enabled),
              mode: posting.usdt_publish_mode,
              exactAmount: usdtExact,
              rangeMin: usdtRange.min,
              rangeMax: usdtRange.max,
              status: posting.usdt_status,
              reserveBuffer: Number(posting.reserve_buffer_usdt || 0),
            },
            updatedAt,
            expiresAt: posting.expires_at,
            isStale: isLiquidityStale(updatedAt, posting.expires_at, now),
          } as LiquidityBoardEntry;
        })
        .filter(Boolean) as LiquidityBoardEntry[];

      return {
        boardEntries,
        myProfile: profile,
        internal,
        relationships,
        liquidityTableMissing,
      };
    },
    staleTime: 20_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (input: LiquidityPublishProfile) => {
      if (!merchantProfile?.merchant_id || !userId) throw new Error('Missing merchant profile');
      const payload = {
        merchant_id: merchantProfile.merchant_id,
        user_id: userId,
        publish_cash_enabled: input.publishCashEnabled,
        publish_usdt_enabled: input.publishUsdtEnabled,
        published_cash_amount: input.publishedCashAmount,
        published_usdt_amount: input.publishedUsdtAmount,
        cash_publish_mode: input.cashPublishMode,
        usdt_publish_mode: input.usdtPublishMode,
        cash_range_min: input.cashRangeMin,
        cash_range_max: input.cashRangeMax,
        usdt_range_min: input.usdtRangeMin,
        usdt_range_max: input.usdtRangeMax,
        cash_status: input.cashStatus,
        usdt_status: input.usdtStatus,
        reserve_buffer_cash: input.reserveBufferCash,
        reserve_buffer_usdt: input.reserveBufferUsdt,
        visibility_scope: input.visibilityScope,
        auto_sync_enabled: input.autoSyncEnabled,
        last_published_at: new Date().toISOString(),
        expires_at: input.expiresAt,
        status: input.status,
      };

      const { error } = await supabase
        .from('merchant_liquidity_profiles')
        .upsert(payload, { onConflict: 'merchant_id' });

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-liquidity', merchantProfile?.merchant_id, userId] });
    },
  });

  const boardEntries = query.data?.boardEntries || [];

  const helpers = useMemo(() => {
    const defaultFilters: LiquidityFilters = {
      side: 'both',
      minAmount: 0,
      relationship: 'all',
      updatedRecentlyHours: null,
    };

    return {
      filter: (filters: LiquidityFilters = defaultFilters) => filterLiquidityEntries(boardEntries, filters),
      rank: (side: 'cash' | 'usdt', amount: number) => rankLiquidityEntries(boardEntries, side, amount),
      overview: aggregateLiquidityOverview(boardEntries),
    };
  }, [boardEntries]);

  return {
    ...query,
    boardEntries,
    myProfile: query.data?.myProfile,
    internal: query.data?.internal,
    relationships: query.data?.relationships || [],
    liquidityTableMissing: query.data?.liquidityTableMissing || false,
    saveProfile: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    ...helpers,
  };
}
