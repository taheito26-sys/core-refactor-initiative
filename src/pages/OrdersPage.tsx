import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTrackerState } from '@/lib/useTrackerState';
import {
  fmtU, fmtP, fmtQ, fmtDate, getWACOP, inRange, rangeLabel, fmtDur, computeFIFO, uid,
  fmtPrice, fmtTotal,
  type TrackerState, type Trade, type Customer, type TradeCalcResult, type LinkedTradeStatus,
} from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import * as api from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { DEAL_TYPE_CONFIGS, calculateAllocation, calculateAgreementAllocation, isAgreementActive, getAgreementLabel } from '@/lib/deal-engine';
import { AGREEMENT_TEMPLATES, getTemplateRatioLabel, getDealShares, type AgreementTemplate } from '@/lib/deal-templates';
import { isSupportedDealType } from '@/types/domain';
import type { MerchantRelationship, MerchantDeal, ProfitShareAgreement, AllocationFamily } from '@/types/domain';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useSubmitCapitalTransfer } from '@/hooks/useCapitalTransfers';
import { useProfitShareAgreements, useApprovedAgreements } from '@/hooks/useProfitShareAgreements';
import { useCreateAllocations, calculateAllocationEconomics, type CreateAllocationInput } from '@/hooks/useOrderAllocations';
import { useIsMobile } from '@/hooks/use-mobile';
import { buildDealRowModel, parseDealMeta } from '@/features/orders/utils/dealRowModel';
import { applyOrderCashDeposit } from '@/features/orders/utils/cashDeposit';
import '@/styles/tracker.css';
import { focusElementBySelectors } from '@/lib/focus-target';

// ─── Multi-Merchant Allocation Row Type ──────────────────────────────
interface AllocationRow {
  id: string;
  relationshipId: string;
  merchantName: string;
  merchantId: string;
  family: AllocationFamily;
  agreementId: string | null;
  agreementLabel: string;
  allocatedUsdt: string;
  merchantCostPerUsdt: string;
  partnerSharePct: number;
  merchantSharePct: number;
  note: string;
}

const nowInput = () => new Date().toISOString().slice(0, 16);
const normalizeName = (v: string) => v.trim().toLowerCase();
function toInputFromTs(ts: number) { return new Date(ts).toISOString().slice(0, 16); }

export default function OrdersPage() {
  const { settings } = useTheme();
  const { userId, merchantProfile } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { state, derived, applyState } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
  });

  const [saleDate, setSaleDate] = useState(nowInput());
  const [saleEntryMode, setSaleEntryMode] = useState<'price_vol' | 'qty_total' | 'qty_price'>('price_vol');
  const [saleMode, setSaleMode] = useState<'USDT' | 'QAR'>('USDT');
  const [saleUsdtQty, setSaleUsdtQty] = useState('');
  const [saleAmount, setSaleAmount] = useState('');
  const [saleSell, setSaleSell] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerId, setBuyerId] = useState('');
  const [useStock, setUseStock] = useState(true);
  const [priceMode, setPriceMode] = useState<'fifo' | 'manual'>('fifo');
  const [manualBuyPrice, setManualBuyPrice] = useState('');
  const [saleFee, setSaleFee] = useState('');
  const [saleMessage, setSaleMessage] = useState('');
  const [cashDepositMode, setCashDepositMode] = useState<'none' | 'full' | 'partial'>('none');
  const [cashDepositAmount, setCashDepositAmount] = useState('');
  const [cashDepositAccountId, setCashDepositAccountId] = useState('');

  // Numeric-only handler: allows digits, one dot, and leading minus
  const numericOnly = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v === '' || /^-?\d*\.?\d*$/.test(v)) setter(v);
  };

  const [buyerMenuOpen, setBuyerMenuOpen] = useState(false);
  const [addBuyerOpen, setAddBuyerOpen] = useState(false);
  const [newBuyerName, setNewBuyerName] = useState('');
  const [newBuyerPhone, setNewBuyerPhone] = useState('');
  const [newBuyerTier, setNewBuyerTier] = useState('C');

  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editSell, setEditSell] = useState('');
  const [editBuyer, setEditBuyer] = useState('');
  const [editUsesStock, setEditUsesStock] = useState(true);
  const [editFee, setEditFee] = useState('0');
  const [editNote, setEditNote] = useState('');
  const [editCustomerId, setEditCustomerId] = useState('');

  // Link-to-partner state (for editing self orders)
  const [editLinkEnabled, setEditLinkEnabled] = useState(false);
  const [editLinkedRelId, setEditLinkedRelId] = useState('');
  const [editSelectedTemplateId, setEditSelectedTemplateId] = useState<string | null>(null);
  const [editSettleImmediately, setEditSettleImmediately] = useState(false);

  // ─── Merchant-Linked Trade (Trade-Centric) ────────────────────────
  const [relationships, setRelationships] = useState<MerchantRelationship[]>([]);
  const [allMerchantDeals, setAllMerchantDeals] = useState<MerchantDeal[]>([]);
  const [merchantOrderEnabled, setMerchantOrderEnabled] = useState(false);
  const [linkedRelId, setLinkedRelId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [settleImmediately, setSettleImmediately] = useState(false);
  const [activeTab, setActiveTab] = useState<'my' | 'incoming' | 'outgoing' | 'transfers'>('my');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));


  // Capital Transfer state
  const [transferDirection, setTransferDirection] = useState<'lender_to_operator' | 'operator_to_lender'>('lender_to_operator');
  const [transferCostBasis, setTransferCostBasis] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [allTransfers, setAllTransfers] = useState<any[]>([]);

  // Cancellation request dialog
  const [cancelTradeId, setCancelTradeId] = useState<string | null>(null);

  // ─── Multi-Merchant Allocation State ────────────────────────────────
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const { data: allAgreements = [] } = useProfitShareAgreements();
  const createAllocations = useCreateAllocations();

  // Sync saleAmount into first allocation's allocatedUsdt for sales_deal 50/50
  useEffect(() => {
    if (selectedTemplateId === 'sales_deal_family' && allocations.length > 0 && allocations[0].partnerSharePct === 50) {
      setAllocations(prev => prev.map((a, i) => i === 0 ? { ...a, allocatedUsdt: saleAmount || '' } : a));
    }
  }, [saleAmount]);

  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [editDealTitle, setEditDealTitle] = useState('');
  const [editDealAmount, setEditDealAmount] = useState('');
  const [editDealQty, setEditDealQty] = useState('');
  const [editDealSell, setEditDealSell] = useState('');
  const [editDealFee, setEditDealFee] = useState('0');
  const [editDealNote, setEditDealNote] = useState('');
  const [deleteDealConfirm, setDeleteDealConfirm] = useState<string | null>(null);


  const reloadMerchantData = useCallback(async () => {
    try {
      const myMerchantId = merchantProfile?.merchant_id;
      if (!myMerchantId) return;

      const [relsRes, dealsRes, profilesRes] = await Promise.all([
        supabase
          .from('merchant_relationships')
          .select('*')
          .eq('status', 'active')
          .or(`merchant_a_id.eq.${myMerchantId},merchant_b_id.eq.${myMerchantId}`),
        supabase.from('merchant_deals').select('*').order('created_at', { ascending: false }),
        supabase.from('merchant_profiles').select('merchant_id, display_name, nickname, merchant_code'),
      ]);

      const profileMap = new Map(
        (profilesRes.data || []).map(p => [p.merchant_id, p])
      );

      const enrichedRels = (relsRes.data || []).map(r => {
        const cpId = r.merchant_a_id === myMerchantId ? r.merchant_b_id : r.merchant_a_id;
        const cp = profileMap.get(cpId);
        return {
          ...r,
          counterparty: { display_name: cp?.display_name || cpId, nickname: cp?.nickname || '' },
          counterparty_name: cp?.display_name || cpId,
        } as any as MerchantRelationship;
      });

      setRelationships(enrichedRels);

      const enrichedDeals = (dealsRes.data || []).map(d => {
        const rel = enrichedRels.find(r => r.id === d.relationship_id);
        return { ...d, counterparty_name: (rel as any)?.counterparty_name || '—' } as any as MerchantDeal;
      });
      setAllMerchantDeals(enrichedDeals);

      // Fetch capital transfers across all relationships
      const transferResults = await Promise.all(
        (relsRes.data || []).map(r =>
          supabase.from('capital_transfers' as any).select('*').eq('relationship_id', r.id) as any
        )
      );
      const allTx = transferResults.flatMap(r => r.data || []);
      setAllTransfers(allTx.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch {
      // keep tracker usable
    }
  }, [merchantProfile?.merchant_id]);

  useEffect(() => { reloadMerchantData(); }, [reloadMerchantData]);

  // Real-time listeners for merchant_deals and merchant_approvals changes
  useEffect(() => {
    const dealsChannel = supabase
      .channel('merchant-deals-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'merchant_deals' },
        () => { reloadMerchantData(); }
      )
      .subscribe();

    const approvalsChannel = supabase
      .channel('merchant-approvals-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'merchant_approvals' },
        () => { reloadMerchantData(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(dealsChannel);
      supabase.removeChannel(approvalsChannel);
    };
  }, [reloadMerchantData]);

  useEffect(() => {
    const next: TrackerState = { ...state, range: settings.range, currency: settings.currency,
      settings: { ...state.settings, lowStockThreshold: settings.lowStockThreshold, priceAlertThreshold: settings.priceAlertThreshold }
    };
    applyState(next);
  }, [settings.range, settings.currency, settings.lowStockThreshold, settings.priceAlertThreshold]);

  const wacop = getWACOP(derived);
  useEffect(() => { if (!saleSell && wacop) setSaleSell(fmtP(wacop)); }, [wacop, saleSell]);

  const rLabel = rangeLabel(state.range);
  const query = (settings.searchQuery || '').trim().toLowerCase();

  const cancelledDealIds = useMemo(() => new Set(
    allMerchantDeals.filter(d => d.status === 'cancelled' || d.status === 'rejected' || (d.status as string) === 'voided').map(d => d.id)
  ), [allMerchantDeals]);
  const cancelledLocalTradeIds = useMemo(() => new Set(
    allMerchantDeals
      .filter(d => d.status === 'cancelled' || d.status === 'rejected' || (d.status as string) === 'voided')
      .map(d => parseDealMeta(d.notes).local_trade)
      .filter(Boolean)
  ), [allMerchantDeals]);

  // Sync: void local trades whose server-side deals are cancelled/rejected/voided
  // This ensures computeFIFO never consumes stock for dead deals
  useEffect(() => {
    if (cancelledLocalTradeIds.size === 0 && cancelledDealIds.size === 0) return;
    let changed = false;
    const nextTrades = state.trades.map(tr => {
      if (tr.voided) return tr; // already voided
      // Check by linkedDealId
      if (tr.linkedDealId && cancelledDealIds.has(tr.linkedDealId) && !tr.voided) {
        changed = true;
        return { ...tr, voided: true };
      }
      // Check by local_trade reference in cancelled deal notes
      if (cancelledLocalTradeIds.has(tr.id) && !tr.voided) {
        changed = true;
        return { ...tr, voided: true };
      }
      return tr;
    });
    if (changed) {
      applyState({ ...state, trades: nextTrades });
    }
  }, [cancelledDealIds, cancelledLocalTradeIds, state, applyState]);

  // Reconcile local linked trade approval status with server-authoritative merchant deal status
  useEffect(() => {
    if (!allMerchantDeals.length || !state.trades.length) return;

    const mapDealStatusToTradeStatus = (status?: string): LinkedTradeStatus | undefined => {
      switch (status) {
        case 'pending':
          return 'pending_approval';
        case 'approved':
          return 'approved';
        case 'rejected':
          return 'rejected';
        case 'cancelled':
        case 'voided':
          return 'cancelled';
        default:
          return undefined;
      }
    };

    const dealsById = new Map(allMerchantDeals.map((deal) => [deal.id, deal]));
    let changed = false;

    const nextTrades = state.trades.map((tr) => {
      if (!tr.linkedDealId) return tr;

      const linkedDeal = dealsById.get(tr.linkedDealId);
      if (!linkedDeal) return tr;

      const nextApprovalStatus = mapDealStatusToTradeStatus(linkedDeal.status);
      if (!nextApprovalStatus || tr.approvalStatus === nextApprovalStatus) return tr;

      changed = true;
      return {
        ...tr,
        approvalStatus: nextApprovalStatus,
      };
    });

    if (changed) {
      applyState({
        ...state,
        trades: nextTrades,
      });
    }
  }, [allMerchantDeals, state, applyState]);

  const allTrades = useMemo(() => [...state.trades].sort((a, b) => b.ts - a.ts), [state.trades]);
  const list = useMemo(() => allTrades.filter(t => {
    if (!inRange(t.ts, state.range)) return false;
    if (t.approvalStatus === 'cancelled' || t.voided) return false;
    if (t.linkedDealId && cancelledDealIds.has(t.linkedDealId)) return false;
    if (cancelledLocalTradeIds.has(t.id)) return false;
    if ((t.approvalStatus === 'pending_approval' || t.approvalStatus === 'approved' || t.approvalStatus === 'rejected') && !t.linkedDealId) {
      const matchedServerDeal = allMerchantDeals.some(d => parseDealMeta(d.notes).local_trade === t.id && d.created_by === userId && d.status !== 'cancelled' && (d.status as string) !== 'voided');
      if (!matchedServerDeal) return false;
    }
    return true;
  }), [allTrades, state.range, cancelledDealIds, cancelledLocalTradeIds, allMerchantDeals, userId]);
  const filtered = useMemo(() => {
    if (!query) return list;
    return list.filter(t => {
      const c = state.customers.find(x => x.id === t.customerId);
      return [fmtDate(t.ts), String(t.amountUSDT), String(t.sellPriceQAR), c?.name || ''].join(' ').toLowerCase().includes(query);
    });
  }, [list, query, state.customers]);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    const curMonthKey = new Date().toISOString().slice(0, 7);
    months.add(curMonthKey); // Always include current month

    filtered.forEach(t => {
      const d = new Date(t.ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.add(key);
    });
    allTransfers.forEach(tx => {
      const d = new Date(tx.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.add(key);
    });
    return Array.from(months).sort().reverse();
  }, [filtered, allTransfers]);

  const subFilteredMy = useMemo(() => {
    if (selectedMonth === 'all') return filtered;
    return filtered.filter(tr => {
      const d = new Date(tr.ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === selectedMonth;
    });
  }, [filtered, selectedMonth]);

  const subFilteredTransfers = useMemo(() => {
    if (selectedMonth === 'all') return allTransfers;
    return allTransfers.filter(tx => {
      const d = new Date(tx.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === selectedMonth;
    });
  }, [allTransfers, selectedMonth]);


  const myKpi = useMemo(() => {
    // Only trades in the selected month (or all)
    const activeList = subFilteredMy.filter(tr => !tr.agreementFamily && !tr.linkedDealId && !tr.linkedRelId);
    let qty = 0, vol = 0, netVal = 0;
    for (const tr of activeList) {
      const c = derived.tradeCalc.get(tr.id);
      qty += tr.amountUSDT;
      vol += tr.amountUSDT * tr.sellPriceQAR;
      if (c?.ok) {
        netVal += c.netQAR;
      } else if (tr.manualBuyPrice) {
        netVal += tr.amountUSDT * tr.sellPriceQAR - tr.amountUSDT * tr.manualBuyPrice - tr.feeQAR;
      }
    }
    return { count: activeList.length, qty, vol, net: netVal };
  }, [subFilteredMy, derived]);


  // URL-driven tab sync: read ?tab= and switch activeTab before focus
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['my', 'incoming', 'outgoing', 'transfers'].includes(tabParam)) {
      setActiveTab(tabParam as 'my' | 'incoming' | 'outgoing' | 'transfers');
      if (tabParam !== 'my') {
        setMerchantOrderEnabled(true);
        if (tabParam === 'transfers') {
          setSelectedTemplateId('capital_transfer');
        }
      }
    }
  }, [searchParams]);

  // Focus and highlight targeted row after tab switch + data load
  useEffect(() => {
    const focusOrderId = searchParams.get('focusOrderId');
    const focusDealId = searchParams.get('focusDealId');
    const focusSettlementId = searchParams.get('focusSettlementId');
    const focusTransferId = searchParams.get('focusTransferId');
    const targetId = focusOrderId || focusDealId || focusSettlementId || focusTransferId;
    if (!targetId) return;
    // Delay to let tab content render
    const timer = window.setTimeout(() => {
      const selectors = [
        `#order-${targetId}`, `[data-order-id="${targetId}"]`,
        `#deal-${targetId}`, `[data-deal-id="${targetId}"]`,
        `#settlement-${targetId}`, `[data-settlement-id="${targetId}"]`,
        `#transfer-${targetId}`, `[data-transfer-id="${targetId}"]`,
      ];
      const found = focusElementBySelectors(selectors, 'ring-2 ring-primary/60 transition-shadow');
      if (!found) {
        window.setTimeout(() => {
          focusElementBySelectors(selectors, 'ring-2 ring-primary/60 transition-shadow');
        }, 800);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchParams, activeTab, filtered.length, allMerchantDeals.length, allTransfers.length]);

  const isDealVisible = (d: any) => d.status !== 'cancelled' && d.status !== 'rejected' && d.status !== 'voided';
  // Incoming: deals created by OTHER merchants in my relationships
  const partnerMerchantDeals = useMemo(
    () => allMerchantDeals.filter(d => d.created_by !== userId && isDealVisible(d)),
    [allMerchantDeals, userId],
  );
  // Outgoing: deals I created (server-authoritative)
  const creatorMerchantDeals = useMemo(
    () => allMerchantDeals.filter(d => d.created_by === userId && isDealVisible(d)),
    [allMerchantDeals, userId],
  );
  const filteredIncomingMerchantDeals = useMemo(
    () => partnerMerchantDeals.filter(d => inRange(new Date(d.created_at).getTime(), state.range)),
    [partnerMerchantDeals, state.range],
  );
  const filteredOutgoingMerchantDeals = useMemo(
    () => creatorMerchantDeals.filter(d => inRange(new Date(d.created_at).getTime(), state.range)),
    [creatorMerchantDeals, state.range],
  );

  const subFilteredInDeals = useMemo(() => {
    if (selectedMonth === 'all') return filteredIncomingMerchantDeals;
    return filteredIncomingMerchantDeals.filter(d => {
      const date = new Date(d.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return key === selectedMonth;
    });
  }, [filteredIncomingMerchantDeals, selectedMonth]);

  const subFilteredOutDeals = useMemo(() => {
    if (selectedMonth === 'all') return filteredOutgoingMerchantDeals;
    return filteredOutgoingMerchantDeals.filter(d => {
      const date = new Date(d.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return key === selectedMonth;
    });
  }, [filteredOutgoingMerchantDeals, selectedMonth]);

  /** Resolve avg buy for a deal — use metadata first, fallback to local FIFO trade calc */
  const resolveDealAvgBuy = useCallback((deal: any, normalizedMeta?: Record<string, string>): number => {
    const meta = normalizedMeta ?? parseDealMeta(deal.notes);
    const metaAvg = Number(meta.avg_buy) || 0;
    if (metaAvg > 0) return metaAvg;
    // Fallback: find local trade linked to this deal and use FIFO calc
    const localTradeId = meta.local_trade;
    if (localTradeId && derived) {
      const c = derived.tradeCalc.get(localTradeId);
      if (c?.ok) return c.avgBuyQAR;
      // Check manual buy price on local trade
      const localTrade = state.trades.find(t => t.id === localTradeId);
      if (localTrade?.manualBuyPrice && localTrade.manualBuyPrice > 0) return localTrade.manualBuyPrice;
    }
    return 0;
  }, [derived, state.trades]);

  const filteredCustomers = useMemo(() => {
    const q = normalizeName(buyerName);
    if (!q) return state.customers;
    return state.customers.filter(c => normalizeName(c.name).includes(q) || c.phone.includes(buyerName));
  }, [buyerName, state.customers]);

  // Sale preview computation
  const salePreview = useMemo(() => {
    let sell: number, amountUSDT: number;
    const ts = new Date(saleDate).getTime();
    const fee = parseFloat(saleFee) || 0;

    if (saleEntryMode === 'qty_total') {
      // USDT + QAR → auto-calc sell price
      amountUSDT = Number(saleUsdtQty);
      const totalQar = Number(saleAmount);
      sell = amountUSDT > 0 ? totalQar / amountUSDT : 0;
    } else if (saleEntryMode === 'qty_price') {
      // USDT + Price → auto-calc total QAR
      amountUSDT = Number(saleUsdtQty);
      sell = Number(saleSell);
    } else {
      // price_vol: original mode
      sell = Number(saleSell);
      const raw = Number(saleAmount);
      amountUSDT = saleMode === 'USDT' ? raw : sell > 0 ? raw / sell : 0;
    }

    if (!(amountUSDT > 0) || !(sell > 0) || !Number.isFinite(ts)) return null;
    if (priceMode === 'manual') {
      const buyP = parseFloat(manualBuyPrice) || 0;
      const rev = amountUSDT * sell;
      const cost = amountUSDT * buyP;
      const net = rev - cost - fee;
      return { qty: amountUSDT, revenue: rev, avgBuy: buyP, cost, net };
    }
    const tmpTrade: Trade = { id: '__preview__', ts, inputMode: 'USDT', amountUSDT, sellPriceQAR: sell, feeQAR: fee, note: '', voided: false, usesStock: true, revisions: [], customerId: '' };
    const calc = computeFIFO(state.batches, [...state.trades, tmpTrade]).tradeCalc.get('__preview__');
    const rev = amountUSDT * sell;
    const cost = calc?.slices.reduce((s, x) => s + x.cost, 0) || 0;
    const net = calc?.ok ? rev - cost - fee : NaN;
    return { qty: amountUSDT, revenue: rev, avgBuy: calc?.ok ? calc.avgBuyQAR : NaN, cost: calc?.ok ? cost : NaN, net };
  }, [saleAmount, saleDate, saleEntryMode, saleMode, saleUsdtQty, saleSell, saleFee, priceMode, manualBuyPrice, state.batches, state.trades]);

  // Allocation preview for selected template
  const allocationPreview = useMemo(() => {
    if (!selectedTemplateId || !salePreview) return null;
    const tmpl = AGREEMENT_TEMPLATES.find(t => t.id === selectedTemplateId);
    if (!tmpl) return null;
    const partnerPct = tmpl.defaults.counterparty_share_pct ?? tmpl.defaults.partner_ratio ?? 0;
    const merchantPct = 100 - partnerPct;
    const rel = relationships.find(r => r.id === linkedRelId);

    if (tmpl.family === 'profit_share') {
      // Profit Share: based on net profit
      const base = Number.isFinite(salePreview.net) ? salePreview.net : 0;
      const partnerAmount = (base * partnerPct) / 100;
      const merchantAmount = base - partnerAmount;
      return {
        partnerPct, merchantPct, partnerAmount, merchantAmount,
        base, baseLabel: 'net_profit' as const,
        revenue: salePreview.revenue,
        fifoCost: Number.isFinite(salePreview.cost) ? salePreview.cost : null,
        counterpartyName: rel?.counterparty?.display_name || t('partner'),
      };
    } else {
      // Sales Deal: based on net profit (same as profit share)
      const base = Number.isFinite(salePreview.net) ? salePreview.net : 0;
      const partnerAmount = (base * partnerPct) / 100;
      const merchantAmount = base - partnerAmount;
      return {
        partnerPct, merchantPct, partnerAmount, merchantAmount,
        base, baseLabel: 'net_profit' as const,
        revenue: salePreview.revenue,
        fifoCost: Number.isFinite(salePreview.cost) ? salePreview.cost : null,
        counterpartyName: rel?.counterparty?.display_name || t('partner'),
      };
    }
  }, [selectedTemplateId, salePreview, linkedRelId, relationships, t]);

  const isCapitalTransfer = selectedTemplateId === 'capital_transfer';
  const submitCapitalTransfer = useSubmitCapitalTransfer();
  const mobileInputStyle = isMobile ? { fontSize: 15, minHeight: 38 } : undefined;
  const mobileActionStyle = isMobile ? { minHeight: 34, fontSize: 10, padding: '4px 6px' } : undefined;
  const mobileDialogContentStyle = isMobile
    ? {
        maxWidth: '96vw',
        width: '96vw',
        maxHeight: '92dvh',
        overflowY: 'auto' as const,
        borderRadius: 12,
        padding: 14,
        paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
      }
    : undefined;
  const mobileDialogFooterStyle = isMobile
    ? { gap: 8, flexDirection: 'column-reverse' as const, alignItems: 'stretch' as const }
    : undefined;

  const handleCapitalTransfer = async () => {
    if (!linkedRelId) { toast.error(t('selectPartnerFirst')); return; }
    if (!transferAmount) { toast.error(t('amountCostRequired')); return; }
    try {
      await submitCapitalTransfer.mutateAsync({
        relationship_id: linkedRelId,
        direction: transferDirection,
        amount: parseFloat(transferAmount),
        cost_basis: 0,
        note: transferNote || undefined,
      });
      toast.success(t('capitalTransferSubmitted') || 'Capital transfer submitted');
      setTransferAmount('');
      setTransferCostBasis('');
      setTransferNote('');
      setTransferDirection('lender_to_operator');
      setSelectedTemplateId(null);
      setMerchantOrderEnabled(false);
      reloadMerchantData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const ensureCustomer = (name: string, phone = '', tier = 'C') => {
    const nm = name.trim();
    if (!nm) return { id: '', customers: state.customers };
    const existing = state.customers.find(c => normalizeName(c.name) === normalizeName(nm));
    if (existing) return { id: existing.id, customers: state.customers };
    const nextCustomer: Customer = { id: uid(), name: nm, phone, tier, dailyLimitUSDT: 0, notes: '', createdAt: Date.now() };
    return { id: nextCustomer.id, customers: [...state.customers, nextCustomer] };
  };

  const addBuyerFromModal = () => {
    if (!newBuyerName.trim()) return;
    const created = ensureCustomer(newBuyerName, newBuyerPhone, newBuyerTier);
    if (!created.id) return;
    applyState({ ...state, customers: created.customers });
    setBuyerName(newBuyerName.trim());
    setBuyerId(created.id);
    setBuyerMenuOpen(false);
    setAddBuyerOpen(false);
    setNewBuyerName(''); setNewBuyerPhone(''); setNewBuyerTier('C');
  };

  // Helper: apply cash deposit to state if enabled
  const applyCashDeposit = (nextState: TrackerState, sell: number, amountUSDT: number): TrackerState => {
    return applyOrderCashDeposit({
      nextState,
      cashDepositMode,
      cashDepositAmountRaw: cashDepositAmount,
      cashDepositAccountId,
      sell,
      amountUSDT,
      note: `${t('saleProceeds')}: ${fmtU(amountUSDT)} USDT @ ${fmtP(sell)}`,
    });
  };

  // ─── ADD TRADE (Trade-Centric) ────────────────────────────────────
  const addTrade = async () => {
    // Capital transfers are handled separately via handleCapitalTransfer
    if (isCapitalTransfer) return;

    const ts = new Date(saleDate).getTime();
    let sell: number, amountUSDT: number;
    if (saleEntryMode === 'qty_total') {
      amountUSDT = Number(saleUsdtQty);
      const totalQar = Number(saleAmount);
      sell = amountUSDT > 0 ? totalQar / amountUSDT : 0;
    } else if (saleEntryMode === 'qty_price') {
      amountUSDT = Number(saleUsdtQty);
      sell = Number(saleSell);
    } else {
      sell = Number(saleSell);
      const raw = Number(saleAmount);
      amountUSDT = saleMode === 'USDT' ? raw : sell > 0 ? raw / sell : 0;
    }
    const errs: string[] = [];
    if (!Number.isFinite(ts)) errs.push(t('date'));
    if (!(sell > 0)) errs.push(t('sellPriceLabel'));
    if (!(amountUSDT > 0)) errs.push(t('quantity'));
    if (!(amountUSDT > 0)) errs.push(t('amountUsdt'));
    if (!buyerName.trim()) errs.push(t('buyerNameRequired'));
    if (errs.length) { setSaleMessage(`${t('fixFields')} ${errs.join(', ')}`); return; }

    // Merchant-linked validation
    const isNewAllocFlow = selectedTemplateId === 'profit_share_family' || selectedTemplateId === 'sales_deal_family';
    if (merchantOrderEnabled && !isNewAllocFlow && !linkedRelId) { setSaleMessage(`${t('fixFields')} ${t('relationship')}`); return; }
    if (merchantOrderEnabled && !selectedTemplateId) { setSaleMessage(`${t('fixFields')} ${t('agreementTypeRequired')}`); return; }

    // Multi-merchant allocation validation
    if (merchantOrderEnabled && isNewAllocFlow) {
      if (allocations.length === 0) { setSaleMessage(t('addAtLeastOneAlloc')); return; }
      const totalAllocated = allocations.reduce((s, a) => s + (parseFloat(a.allocatedUsdt) || 0), 0);
      if (Math.abs(totalAllocated - amountUSDT) > 0.01) {
        setSaleMessage(`${t('allocMismatch')}: ${t('allocMismatchDetail').replace('{0}', totalAllocated.toFixed(2)).replace('{1}', amountUSDT.toFixed(2))}`);
        return;
      }
      for (const alloc of allocations) {
        if (!alloc.relationshipId) { setSaleMessage(t('allocNeedsMerchant')); return; }
        if (alloc.family === 'profit_share' && !alloc.agreementId) {
          setSaleMessage(`${t('profitShareLabel')} ${alloc.merchantName || t('merchant')} ${t('allocNeedsAgreement')}`);
          return;
        }
        if (!(parseFloat(alloc.allocatedUsdt) > 0)) { setSaleMessage(t('allocNeedsUsdt')); return; }
        if (!(parseFloat(alloc.merchantCostPerUsdt) > 0)) { setSaleMessage(t('allocNeedsCost')); return; }
      }
    }

    let nextCustomers = state.customers;
    let customerId = buyerId;
    if (buyerName.trim()) {
      const ensured = ensureCustomer(buyerName);
      customerId = ensured.id;
      nextCustomers = ensured.customers;
    } else { customerId = ''; }

    // Build trade with agreement fields if merchant-linked
    const tmpl = selectedTemplateId ? AGREEMENT_TEMPLATES.find(t => t.id === selectedTemplateId) : null;
    const isNewAllocFlowActive = isNewAllocFlow && allocations.length > 0;

    const baseTrade: Trade = {
      id: uid(), ts, inputMode: saleEntryMode === 'price_vol' ? saleMode : 'USDT', amountUSDT, sellPriceQAR: sell, feeQAR: parseFloat(saleFee) || 0, note: '', voided: false, usesStock: useStock, revisions: [], customerId,
      manualBuyPrice: priceMode === 'manual' ? (parseFloat(manualBuyPrice) || 0) : undefined,
      linkedRelId: merchantOrderEnabled ? (isNewAllocFlowActive ? allocations[0]?.relationshipId : linkedRelId) || undefined : undefined,
      agreementFamily: isNewAllocFlowActive
        ? (selectedTemplateId === 'profit_share_family' ? 'profit_share' : 'sales_deal') as any
        : tmpl?.family as 'profit_share' | 'sales_deal' | 'capital_transfer' | undefined,
      agreementTemplateId: isNewAllocFlowActive ? undefined : tmpl?.id,
      partnerPct: isNewAllocFlowActive ? undefined : (tmpl ? (tmpl.defaults.counterparty_share_pct ?? tmpl.defaults.partner_ratio) : undefined),
      merchantPct: isNewAllocFlowActive ? undefined : (tmpl ? (tmpl.defaults.merchant_share_pct ?? tmpl.defaults.merchant_ratio) : undefined),
      approvalStatus: merchantOrderEnabled ? 'pending_approval' : undefined,
    };

    // ─── NEW: Multi-Merchant Allocation Flow ─────────────────────────
    if (merchantOrderEnabled && isNewAllocFlowActive) {
      try {
        const saleGroupId = crypto.randomUUID();
        const fee = parseFloat(saleFee) || 0;
        const customerName = buyerName.trim() || t('buyer');
        const c = computeFIFO(state.batches, [...state.trades, baseTrade]).tradeCalc.get(baseTrade.id);
        const fifoCost = c?.ok ? c.slices.reduce((s, x) => s + x.cost, 0) : 0;
        const avgBuy = priceMode === 'manual' ? (parseFloat(manualBuyPrice) || 0) : (c?.ok ? c.avgBuyQAR : 0);

        // Create a merchant_deals record for EACH allocation so it shows in partner's inbox
        const createdDealIds: string[] = [];
        for (const alloc of allocations) {
          const usdt = parseFloat(alloc.allocatedUsdt) || 0;
          const costPerUsdt = parseFloat(alloc.merchantCostPerUsdt) || 0;
          const familyLabel = alloc.family === 'profit_share' ? t('profitShareLabel') : t('salesDealLabel');
          const ratioStr = `${alloc.partnerSharePct}/${alloc.merchantSharePct}`;
          const title = `${familyLabel} · ${customerName} · ${ratioStr}`;

          const noteLines = [
            `template: ${alloc.family}_family`,
            `customer: ${customerName}`,
            `local_trade: ${baseTrade.id}`,
            `trade_date: ${new Date(ts).toISOString()}`,
            `quantity: ${usdt}`,
            `sell_price: ${sell}`,
            `fifo_cost: ${fifoCost}`,
            `avg_buy: ${avgBuy}`,
            `fee: ${fee}`,
            `merchant_cost: ${costPerUsdt}`,
            alloc.family === 'profit_share'
              ? `partner_ratio: ${alloc.partnerSharePct}, merchant_ratio: ${alloc.merchantSharePct}`
              : `counterparty_share: ${alloc.partnerSharePct}%, merchant_share: ${alloc.merchantSharePct}%`,
          ].join(' | ');

          const { data: dealData, error: dealError } = await supabase.from('merchant_deals').insert({
            relationship_id: alloc.relationshipId,
            deal_type: alloc.family === 'profit_share' ? 'partnership' : 'arbitrage',
            title,
            amount: usdt * sell,
            currency: 'USDT',
            status: 'pending',
            created_by: userId!,
            notes: noteLines,
            metadata: {
              quantity: usdt,
              sell_price: sell,
              avg_buy: avgBuy,
              fee,
              merchant_cost: costPerUsdt,
              partner_ratio: alloc.partnerSharePct,
              merchant_ratio: alloc.merchantSharePct,
            },
          }).select('id').single();

          if (dealError) throw dealError;
          if (dealData) createdDealIds.push(dealData.id);
        }

        // Now create allocation records linked to the deals
        const allocationInputs: CreateAllocationInput[] = allocations.map((alloc, idx) => {
          const usdt = parseFloat(alloc.allocatedUsdt) || 0;
          const costPerUsdt = parseFloat(alloc.merchantCostPerUsdt) || 0;
          const calc = calculateAllocationEconomics({
            allocatedUsdt: usdt,
            merchantCostPerUsdt: costPerUsdt,
            sellPrice: sell,
            totalFee: fee,
            totalUsdt: amountUSDT,
            family: alloc.family,
            partnerSharePct: alloc.partnerSharePct,
          });

          return {
            sale_group_id: saleGroupId,
            order_id: createdDealIds[idx] || baseTrade.id,
            relationship_id: alloc.relationshipId,
            merchant_id: alloc.merchantId,
            family: alloc.family,
            profit_share_agreement_id: alloc.agreementId || null,
            allocated_usdt: usdt,
            merchant_cost_per_usdt: costPerUsdt,
            sell_price: sell,
            fee_share: calc.feeShare,
            allocation_revenue: calc.revenue,
            allocation_cost: calc.cost,
            allocation_fee: calc.feeShare,
            allocation_net: calc.net,
            partner_share_pct: calc.partnerSharePct,
            merchant_share_pct: calc.merchantSharePct,
            partner_amount: calc.partnerAmount,
            merchant_amount: calc.merchantAmount,
            agreement_ratio_snapshot: alloc.agreementId ? `${alloc.partnerSharePct}/${alloc.merchantSharePct}` : null,
            deal_terms_snapshot: alloc.family === 'sales_deal' ? { partnerSharePct: alloc.partnerSharePct, merchantCostPerUsdt: costPerUsdt } : null,
            note: alloc.note || null,
          };
        });

        await createAllocations.mutateAsync(allocationInputs);

        // Save local trade with linked deal ID
        const persistedTrade: Trade = {
          ...baseTrade,
          linkedDealId: createdDealIds[0] || undefined,
        };
        const next: TrackerState = {
          ...state,
          customers: nextCustomers,
          trades: [...state.trades, persistedTrade],
          range: inRange(ts, state.range) ? state.range : 'all'
        };
        applyState(applyCashDeposit(next, sell, amountUSDT));
        await reloadMerchantData();
        toast.success(t('tradeSentForApproval'));

        // Reset
        setSaleAmount('');
        setMerchantOrderEnabled(false);
        setLinkedRelId('');
        setSelectedTemplateId(null);
        setAllocations([]);
        return;
      } catch (err: any) {
        console.error('Failed to create allocations:', err);
        toast.error(err.message || t('failedCreateAllocations'));
        return;
      }
    }

    // ─── Legacy: Single-merchant template flow ───────────────────────
    if (merchantOrderEnabled && tmpl) {
      // Create backend deal first so local outgoing state only exists when partner can actually receive it.
      try {
        const customerName = buyerName.trim() || t('buyer');
        const currency = saleMode === 'QAR' ? 'QAR' : 'USDT';
        const amount = Number(saleAmount) || 0;
        const sell = Number(saleSell) || 0;
        const fee = parseFloat(saleFee) || 0;

        const familyLabel = tmpl.family === 'profit_share' ? t('profitShareLabel') : t('salesDealLabel');
        const title = `${familyLabel} · ${customerName} · ${tmpl.ratioDisplay}`;

        // Store trade data in notes so partner can see qty/sell/cost
        const c = computeFIFO(state.batches, [...state.trades, baseTrade]).tradeCalc.get(baseTrade.id);
        const fifoCost = c?.ok ? c.slices.reduce((s, x) => s + x.cost, 0) : 0;
        const avgBuy = priceMode === 'manual' ? (parseFloat(manualBuyPrice) || 0) : (c?.ok ? c.avgBuyQAR : 0);

        const noteLines = [
          `template: ${tmpl.id}`,
          `customer: ${customerName}`,
          `local_trade: ${baseTrade.id}`,
          `trade_date: ${new Date(ts).toISOString()}`,
          `quantity: ${baseTrade.amountUSDT}`,
          `sell_price: ${sell}`,
          `fifo_cost: ${fifoCost}`,
          `avg_buy: ${avgBuy}`,
          `fee: ${fee}`,
          tmpl.dealType === 'partnership'
            ? `partner_ratio: ${tmpl.defaults.partner_ratio}, merchant_ratio: ${tmpl.defaults.merchant_ratio}`
            : `counterparty_share: ${tmpl.defaults.counterparty_share_pct}%, merchant_share: ${tmpl.defaults.merchant_share_pct}%`,
        ].join(' | ');

        const { data, error } = await supabase.from('merchant_deals').insert({
          relationship_id: linkedRelId,
          deal_type: tmpl.dealType as string,
          title,
          amount: baseTrade.amountUSDT * sell,
          currency,
          status: 'pending',
          created_by: userId!,
          notes: noteLines,
          metadata: {
            quantity: baseTrade.amountUSDT,
            sell_price: sell,
            avg_buy: avgBuy,
            fee,
            partner_ratio: tmpl.defaults.counterparty_share_pct ?? tmpl.defaults.partner_ratio ?? null,
            merchant_ratio: tmpl.defaults.merchant_share_pct ?? tmpl.defaults.merchant_ratio ?? null,
          },
        }).select('id').single();

        if (error) throw error;

        // Per-order settlement period creation
        const dealCadence = (tmpl as any)?.defaults?.settlement_period || 'monthly';
        if (dealCadence === 'per_order' && data?.id) {
          const partnerPct = (tmpl as any).defaults?.counterparty_share_pct ?? (tmpl as any).defaults?.partner_ratio ?? 0;
          const rev = baseTrade.amountUSDT * sell;
          const netProfit = rev - fifoCost - fee;
          const partnerAmt = netProfit * (partnerPct / 100);

          const { data: periodData } = await supabase.from('settlement_periods').insert({
            deal_id: data.id,
            relationship_id: linkedRelId,
            cadence: 'per_order',
            period_key: `order:${baseTrade.id}`,
            period_start: new Date(ts).toISOString(),
            period_end: new Date(ts).toISOString(),
            due_at: new Date(ts + 86400000).toISOString(),
            trade_count: 1,
            gross_volume: rev,
            total_cost: fifoCost,
            net_profit: netProfit,
            total_fees: fee,
            partner_amount: partnerAmt,
            merchant_amount: rev - partnerAmt,
            status: settleImmediately ? 'settled' : 'due',
            resolution: settleImmediately ? 'payout' : null,
            resolved_by: settleImmediately ? userId : null,
            resolved_at: settleImmediately ? new Date().toISOString() : null,
            settled_amount: settleImmediately ? partnerAmt : 0,
          } as any).select('id').single();

          if (settleImmediately && periodData?.id) {
            await supabase.from('merchant_settlements').insert({
              deal_id: data.id,
              relationship_id: linkedRelId,
              amount: partnerAmt,
              currency: 'USDT',
              settled_by: userId!,
              notes: `Immediate settlement for order ${baseTrade.id}`,
              status: 'pending',
            } as any);
          }
        }

        const persistedTrade: Trade = {
          ...baseTrade,
          linkedDealId: data?.id,
        };
        const next: TrackerState = {
          ...state,
          customers: nextCustomers,
          trades: [...state.trades, persistedTrade],
          range: inRange(ts, state.range) ? state.range : 'all'
        };
        applyState(applyCashDeposit(next, sell, baseTrade.amountUSDT));

        await reloadMerchantData();
        toast.success(t('tradeSentForApproval'));
      } catch (err: any) {
        console.error('Failed to create deal:', err);
        toast.error(err.message || t('failedCreateDeal'));
      }
    } else {
      const next: TrackerState = {
        ...state,
        customers: nextCustomers,
        trades: [...state.trades, baseTrade],
        range: inRange(ts, state.range) ? state.range : 'all'
      };
      applyState(applyCashDeposit(next, sell, baseTrade.amountUSDT));
      setSaleMessage(t('tradeLogged'));
    }

    // Reset form
    setSaleAmount('');
    setMerchantOrderEnabled(false);
    setLinkedRelId('');
    setSelectedTemplateId(null);
    setAllocations([]);
    setCashDepositMode('none');
    setCashDepositAmount('');
    setCashDepositAccountId('');
  };

  const exportCsv = () => {
    const rows = filtered.map(t => {
      const c = derived.tradeCalc.get(t.id);
      const revenue = t.amountUSDT * t.sellPriceQAR;
      const cost = c?.slices.reduce((s, x) => s + x.cost, 0) || 0;
      let net = c?.ok ? revenue - cost - t.feeQAR : NaN;
      const linked = !!(t.agreementFamily || t.linkedDealId || t.linkedRelId);
      if (linked && t.merchantPct && Number.isFinite(net)) net = net * (t.merchantPct / 100);
      return [new Date(t.ts).toISOString(), t.amountUSDT, t.sellPriceQAR, revenue, Number.isFinite(cost) ? cost : '', Number.isFinite(net) ? net : ''].join(',');
    });
    const csv = `Date,Qty USDT,Sell QAR,Revenue QAR,Cost QAR,Net QAR\n${rows.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  };

  const openEdit = (id: string) => {
    const tr = state.trades.find(x => x.id === id);
    if (!tr) return;
    // Allow editing approved trades — will trigger re-approval
    const cn = state.customers.find(c => c.id === tr.customerId)?.name || '';
    setEditingTradeId(id);
    setEditDate(toInputFromTs(tr.ts));
    setEditQty(String(tr.amountUSDT));
    setEditSell(String(tr.sellPriceQAR));
    setEditBuyer(cn);
    setEditUsesStock(tr.usesStock);
    setEditFee(String(tr.feeQAR ?? 0));
    setEditNote(tr.note ?? '');
    setEditCustomerId(tr.customerId ?? '');
    // Reset link-to-partner state
    setEditLinkEnabled(false);
    setEditLinkedRelId('');
    setEditSelectedTemplateId(null);
    setEditSettleImmediately(false);
  };

  const saveTradeEdit = async () => {
    if (!editingTradeId) return;
    const ts = new Date(editDate).getTime();
    const qty = Number(editQty);
    const sell = Number(editSell);
    const fee = Number(editFee) || 0;
    if (!Number.isFinite(ts) || !(qty > 0) || !(sell > 0)) return;

    const existingTrade = state.trades.find(t => t.id === editingTradeId);
    if (!existingTrade) return;

    // Build base updated fields
    let updatedFields: Partial<Trade> = {
      ts, amountUSDT: qty, sellPriceQAR: sell, feeQAR: fee, note: editNote,
      customerId: editCustomerId, usesStock: editUsesStock,
    };

    // ── Handle linking to partner deal ──
    if (editLinkEnabled && editLinkedRelId && editSelectedTemplateId) {
      const tmpl = AGREEMENT_TEMPLATES.find(t => t.id === editSelectedTemplateId);
      if (!tmpl) { toast.error(t('invalidTemplate')); return; }

      try {
        const customerName = state.customers.find(c => c.id === editCustomerId)?.name || t('buyer');
        const rev = qty * sell;

        const tempCalc = computeFIFO(state.batches, state.trades);
        const calc = tempCalc.tradeCalc.get(editingTradeId);
        const fifoCost = calc?.ok ? calc.slices.reduce((s, x) => s + x.cost, 0) : 0;
        const avgBuy = calc?.ok ? calc.avgBuyQAR : 0;

        const familyLabel = tmpl.family === 'profit_share' ? t('profitShareLabel') : t('salesDealLabel');
        const title = `${familyLabel} · ${customerName} · ${tmpl.ratioDisplay}`;

          const noteLines = [
            `template: ${tmpl.id}`,
            `customer: ${customerName}`,
            `local_trade: ${editingTradeId}`,
            `trade_date: ${new Date(ts).toISOString()}`,
            `quantity: ${qty}`,
          `sell_price: ${sell}`,
          `fifo_cost: ${fifoCost}`,
          `avg_buy: ${avgBuy}`,
          `fee: ${fee}`,
          tmpl.dealType === 'partnership'
            ? `partner_ratio: ${tmpl.defaults.partner_ratio}, merchant_ratio: ${tmpl.defaults.merchant_ratio}`
            : `counterparty_share: ${tmpl.defaults.counterparty_share_pct}%, merchant_share: ${tmpl.defaults.merchant_share_pct}%`,
        ].join(' | ');

        const { data: dealData, error: dealError } = await supabase.from('merchant_deals').insert({
          relationship_id: editLinkedRelId,
          deal_type: tmpl.dealType as string,
          title,
          amount: rev,
          currency: 'QAR',
          status: 'pending',
          created_by: userId!,
          notes: noteLines,
          metadata: {
            quantity: qty,
            sell_price: sell,
            avg_buy: avgBuy,
            fee,
            partner_ratio: tmpl.defaults.counterparty_share_pct ?? tmpl.defaults.partner_ratio ?? null,
            merchant_ratio: tmpl.defaults.merchant_share_pct ?? tmpl.defaults.merchant_ratio ?? null,
          },
        }).select('id').single();

        if (dealError) throw dealError;

        const partnerPct = tmpl.defaults.counterparty_share_pct ?? tmpl.defaults.partner_ratio ?? 0;
        updatedFields = {
          ...updatedFields,
          linkedRelId: editLinkedRelId,
          linkedDealId: dealData?.id,
          agreementFamily: tmpl.family as 'profit_share' | 'sales_deal',
          agreementTemplateId: tmpl.id,
          partnerPct,
          merchantPct: 100 - partnerPct,
          approvalStatus: 'pending_approval' as LinkedTradeStatus,
        };

        // Create settlement period for per_order deals
        const dealCadence = tmpl.defaults.settlement_period || 'monthly';
        if (dealCadence === 'per_order' && dealData?.id) {
          const netProfit = rev - fifoCost - fee;
          const partnerAmt = tmpl.family === 'profit_share'
            ? netProfit * (partnerPct / 100)
            : rev * (partnerPct / 100);

          const { data: periodData } = await supabase.from('settlement_periods').insert({
            deal_id: dealData.id,
            relationship_id: editLinkedRelId,
            cadence: 'per_order',
            period_key: `order:${editingTradeId}`,
            period_start: new Date(ts).toISOString(),
            period_end: new Date(ts).toISOString(),
            due_at: new Date(ts + 86400000).toISOString(),
            trade_count: 1,
            gross_volume: rev,
            total_cost: fifoCost,
            net_profit: netProfit,
            total_fees: fee,
            partner_amount: partnerAmt,
            merchant_amount: rev - partnerAmt,
            status: editSettleImmediately ? 'settled' : 'due',
            resolution: editSettleImmediately ? 'payout' : null,
            resolved_by: editSettleImmediately ? userId : null,
            resolved_at: editSettleImmediately ? new Date().toISOString() : null,
            settled_amount: editSettleImmediately ? partnerAmt : 0,
          } as any).select('id').single();

          if (editSettleImmediately && periodData?.id) {
            await supabase.from('merchant_settlements').insert({
              deal_id: dealData.id,
              relationship_id: editLinkedRelId,
              amount: partnerAmt,
              currency: 'USDT',
              settled_by: userId!,
              notes: `Immediate settlement for linked order ${editingTradeId}`,
              status: 'pending',
            } as any);
          }
        }

        toast.success(t('orderLinkedToPartner') || 'Order linked to partner deal');
        reloadMerchantData();
      } catch (err: any) {
        toast.error(err.message);
        return; // Don't save local trade if deal creation failed
      }
    }

    const nextTrades = state.trades.map(tr => {
      if (tr.id !== editingTradeId) return tr;
      return {
        ...tr,
        ...updatedFields,
        revisions: [{ at: Date.now(), before: { ts: tr.ts, amountUSDT: tr.amountUSDT, sellPriceQAR: tr.sellPriceQAR, customerId: tr.customerId, usesStock: tr.usesStock, feeQAR: tr.feeQAR, note: tr.note } }, ...tr.revisions].slice(0, 20),
      };
    });
    applyState({ ...state, trades: nextTrades });

    // Propagate edits to linked server deal and trigger re-approval
    if (existingTrade.linkedDealId && !editLinkEnabled) {
      try {
        const existingDeal = allMerchantDeals.find(d => d.id === existingTrade.linkedDealId);
        const oldMeta = parseDealMeta(existingDeal?.notes);
        const updatedCalc = computeFIFO(state.batches, nextTrades).tradeCalc.get(editingTradeId!);
        const updatedAvgBuy = updatedCalc?.ok ? updatedCalc.avgBuyQAR : (existingTrade.manualBuyPrice || Number(oldMeta.avg_buy) || 0);
        const updatedFifoCost = updatedCalc?.ok ? updatedCalc.slices.reduce((s: number, x: any) => s + x.cost, 0) : 0;
        const preservedKeys = ['template', 'customer', 'local_trade', 'merchant_cost', 'partner_ratio', 'merchant_ratio', 'counterparty_share', 'merchant_share'];
        const preserved = preservedKeys
          .filter(k => oldMeta[k] != null)
          .map(k => `${k}: ${oldMeta[k]}`);
        const dealNoteLines = [
          ...preserved,
          `trade_date: ${new Date(ts).toISOString()}`,
          `quantity: ${qty}`,
          `sell_price: ${sell}`,
          `fifo_cost: ${updatedFifoCost}`,
          `avg_buy: ${updatedAvgBuy}`,
          `fee: ${fee}`,
        ].join(' | ');
        await supabase.from('merchant_deals').update({
          amount: qty * sell,
          notes: dealNoteLines,
          status: 'pending',
        }).eq('id', existingTrade.linkedDealId);
        const resetTrades = nextTrades.map(tr =>
          tr.id === editingTradeId ? { ...tr, approvalStatus: 'pending_approval' as LinkedTradeStatus } : tr
        );
        applyState({ ...state, trades: resetTrades });
        await reloadMerchantData();
        // Invalidate dashboard deal KPIs so they reflect the updated quantities immediately
        void queryClient.invalidateQueries({ queryKey: ['dashboard-merchant-deals'] });
        toast.success(t('dealUpdatedReapproval'));
      } catch (err: any) {
        console.error('Failed to update linked deal:', err);
      }
    }

    setEditingTradeId(null);
  };

  const deleteTrade = () => {
    if (!editingTradeId) return;
    const tr = state.trades.find(x => x.id === editingTradeId);
    if (tr?.approvalStatus === 'approved') {
      toast.error(t('cannotDeleteApprovedTrade'));
      return;
    }
    // Mark as voided instead of removing — preserves audit trail and releases FIFO stock
    const nextTrades = state.trades.map(t =>
      t.id === editingTradeId ? { ...t, voided: true, approvalStatus: 'cancelled' as LinkedTradeStatus } : t
    );
    applyState({ ...state, trades: nextTrades });
    setEditingTradeId(null);
  };

  // ─── Cancel / Cancellation Request ────────────────────────────────
  const handleCancelTrade = async (tradeId: string) => {
    const tr = state.trades.find(x => x.id === tradeId);
    if (!tr) return;

    // If trade has a linked deal, cancel on server
    if (tr.linkedDealId) {
      try {
        const { error } = await supabase.from('merchant_deals').update({ status: 'cancelled' }).eq('id', tr.linkedDealId);
        if (error) throw error;
        await reloadMerchantData();
        toast.success(t('tradeCancelled'));
      } catch (err: any) { toast.error(err.message); return; }
    }

    // Also update local trade state — set voided so FIFO releases stock
    const nextTrades = state.trades.map(t =>
      t.id === tradeId ? { ...t, voided: true, approvalStatus: 'cancelled' as LinkedTradeStatus } : t
    );
    applyState({ ...state, trades: nextTrades });
    if (!tr.linkedDealId) toast.success(t('tradeCancelled'));
  };

  const submitCancellationRequest = async () => {
    if (!cancelTradeId) return;
    const tr = state.trades.find(x => x.id === cancelTradeId);
    if (tr?.linkedDealId) {
      try {
        const { error } = await supabase.from('merchant_deals').update({ status: 'cancelled' }).eq('id', tr.linkedDealId);
        if (error) throw error;
        await reloadMerchantData();
      } catch (err: any) { toast.error(err.message); setCancelTradeId(null); return; }
    }
    // Set voided so FIFO releases stock
    const nextTrades = state.trades.map(t =>
      t.id === cancelTradeId ? { ...t, voided: true, approvalStatus: 'cancelled' as LinkedTradeStatus } : t
    );
    applyState({ ...state, trades: nextTrades });
    setCancelTradeId(null);
    toast.success(t('tradeCancelled'));
  };

  // Server-side approve/reject for incoming merchant deals
  const approveIncomingDeal = async (dealId: string) => {
    try {
      const { error } = await supabase.from('merchant_deals').update({ status: 'approved' }).eq('id', dealId);
      if (error) throw error;
      await reloadMerchantData();
      toast.success(t('tradeApproved'));
    } catch (err: any) { toast.error(err.message); }
  };

  const rejectIncomingDeal = async (dealId: string) => {
    try {
      const { error } = await supabase.from('merchant_deals').update({ status: 'rejected' }).eq('id', dealId);
      if (error) throw error;
      await reloadMerchantData();
      toast.success(t('tradeRejected'));
    } catch (err: any) { toast.error(err.message); }
  };

  // ─── Merchant Deal Edit/Delete Handlers ───────────────────────────
  const openDealEdit = (deal: MerchantDeal) => {
    setEditingDealId(deal.id);
    setEditDealTitle(deal.title || '');
    setEditDealAmount(String(deal.amount || 0));
    const meta = parseDealMeta(deal.notes);
    setEditDealQty(meta.quantity || String(deal.amount || ''));
    setEditDealSell(meta.sell_price || '');
    setEditDealFee(meta.fee || '0');
    setEditDealNote(meta.note || '');
  };

  const saveDealEdit = async () => {
    if (!editingDealId) return;
    const qty = Number(editDealQty);
    const sell = Number(editDealSell);
    const fee = Number(editDealFee) || 0;
    if (!(qty > 0) || !(sell > 0)) { toast.error(t('fixFields') + ' ' + t('qty') + ', ' + t('sell')); return; }
    try {
      // Preserve immutable fields from existing notes (avg_buy, customer, local_trade, trade_date, etc.)
      // Only overwrite the editable numeric fields.
      const deal = allMerchantDeals.find(d => d.id === editingDealId);
      const existing = parseDealMeta(deal?.notes);
      const preserved = [
        existing.avg_buy ? `avg_buy: ${existing.avg_buy}` : null,
        existing.customer ? `customer: ${existing.customer}` : null,
        existing.local_trade ? `local_trade: ${existing.local_trade}` : null,
        existing.trade_date ? `trade_date: ${existing.trade_date}` : null,
        existing.template ? `template: ${existing.template}` : null,
        existing.counterparty_share ? `counterparty_share: ${existing.counterparty_share}` : null,
        existing.partner_ratio ? `partner_ratio: ${existing.partner_ratio}` : null,
        existing.merchant_ratio ? `merchant_ratio: ${existing.merchant_ratio}` : null,
        existing.merchant_share ? `merchant_share: ${existing.merchant_share}` : null,
        existing.counterparty_share_pct ? `counterparty_share_pct: ${existing.counterparty_share_pct}` : null,
        existing.merchant_share_pct ? `merchant_share_pct: ${existing.merchant_share_pct}` : null,
      ].filter(Boolean).join(' | ');
      // Use canonical key names (quantity/sell_price) so all readers work correctly
      const editedFields = `quantity: ${qty} | sell_price: ${sell} | fee: ${fee} | note: ${editDealNote}`;
      const metaNote = [preserved, editedFields].filter(Boolean).join(' | ');
      const { error } = await supabase.from('merchant_deals').update({
        title: editDealTitle,
        amount: qty * sell,
        notes: metaNote,
        status: 'pending',
      }).eq('id', editingDealId);
      if (error) throw error;
      // Purge stale order_allocations so the dashboard recalculates from updated notes.
      // Allocation records store the OLD qty/sell values and won't auto-update otherwise.
      await supabase.from('order_allocations').delete().eq('order_id', editingDealId);
      await reloadMerchantData();
      void queryClient.invalidateQueries({ queryKey: ['dashboard-merchant-deals'] });
      setEditingDealId(null);
      toast.success(t('saveCorrection'));
    } catch (err: any) { toast.error(err.message); }
  };

  const deleteDeal = async (dealId: string) => {
    try {
      const { error } = await supabase.from('merchant_deals').update({ status: 'cancelled' }).eq('id', dealId);
      if (error) throw error;
      await reloadMerchantData();
      setDeleteDealConfirm(null);
      setEditingDealId(null);
      toast.success(t('dealCancelled'));
    } catch (err: any) { toast.error(err.message); }
  };

  const renderDetail = (tr: Trade, c?: TradeCalcResult) => {
    const ok = !!c?.ok;
    const revenue = tr.amountUSDT * tr.sellPriceQAR;
    const cost = c?.slices.reduce((s, sl) => s + sl.cost, 0) || 0;
    const net = ok ? revenue - cost - tr.feeQAR : NaN;
    const slicesWithBatch = (c?.slices || []).map(sl => {
      const b = state.batches.find(x => x.id === sl.batchId);
      return { ...sl, source: b?.source || '—', price: b?.buyPriceQAR || 0, ts: b?.ts || tr.ts, pct: b && b.initialUSDT > 0 ? (sl.qty / b.initialUSDT) * 100 : 0 };
    });
    const cycleMs = slicesWithBatch.length ? tr.ts - Math.min(...slicesWithBatch.map(s => s.ts)) : null;
    return (
      <div className="tradeDetail">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          <span className="pill">{new Date(tr.ts).toLocaleString()}</span>
          {ok && <span className="pill">{t('avgBuy')} {fmtP(c!.avgBuyQAR)}</span>}
          <span className="pill">{t('revenue')} {fmtQ(revenue)}</span>
          <span className="pill">{t('fee')} {fmtQ(tr.feeQAR)}</span>
          {ok && <span className="pill">{t('cost')} {fmtQ(cost)}</span>}
          <span className={`pill ${Number.isFinite(net) ? (net >= 0 ? 'good' : 'bad') : ''}`}>{t('net')} {Number.isFinite(net) ? `${net >= 0 ? '+' : ''}${fmtQ(net)}` : '—'}</span>
          {cycleMs !== null && <span className="cycle-badge">{t('cycle')} {fmtDur(cycleMs)}</span>}
        </div>
        {/* Show partner allocation for merchant-linked trades */}
        {tr.agreementFamily && tr.partnerPct != null && ok && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ padding: '4px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--good) 10%, transparent)', fontSize: 10 }}>
              📊 {t('merchantNetProfit')}: <strong style={{ color: 'var(--good)' }}>
                {fmtQ(Number.isFinite(net) ? net * (tr.merchantPct! / 100) : 0)}
              </strong>
            </div>
            <div style={{ padding: '4px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--bad) 10%, transparent)', fontSize: 10 }}>
              🤝 {t('partnerNetProfit')}: <strong style={{ color: 'var(--bad)' }}>
                {fmtQ(Number.isFinite(net) ? net * (tr.partnerPct! / 100) : 0)}
              </strong>
            </div>
          </div>
        )}
        <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5 }}>{t('fifoSlices')}</div>
        {ok && slicesWithBatch.length ? slicesWithBatch.map(sl => (
          <div key={`${tr.id}-${sl.batchId}-${sl.qty}`} className="muted" style={{ fontSize: 10, margin: '2px 0' }}>
            {sl.source} · <span className="mono">{fmtU(sl.qty)}</span> @ <span className="mono">{fmtP(sl.price)}</span> <span className="cycle-badge">{sl.pct.toFixed(1)}{t('ofBatch')}</span>
          </div>
        )) : <div className="msg">{t('noSlices')}</div>}
      </div>
    );
  };

  // ─── Helper styles for tables ───
  const thStyle = (right?: boolean): React.CSSProperties => ({
    padding: '7px 10px', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase',
    fontWeight: 800, letterSpacing: '.3px', whiteSpace: 'nowrap',
    textAlign: right ? 'right' : 'left',
  });
  const tdStyle = (right?: boolean): React.CSSProperties => ({
    padding: '9px 10px', fontSize: 11,
    textAlign: right ? 'right' : 'left',
    borderTop: '1px solid color-mix(in srgb, var(--line) 55%, transparent)',
  });
  const renderMargin = (margin: number) => {
    const pct = Number.isFinite(margin) ? Math.min(1, Math.abs(margin) / 0.05) : 0;
    return Number.isFinite(margin) ? (
      <td style={tdStyle()}>
        <div className={`prog ${margin < 0 ? 'neg' : ''}`} style={{ maxWidth: 70 }}><span style={{ width: `${(pct * 100).toFixed(0)}%` }} /></div>
        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{(margin * 100).toFixed(2)}%</div>
      </td>
    ) : <td style={tdStyle()}><span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span></td>;
  };

  const getApprovalStatusBadge = (status?: LinkedTradeStatus) => {
    if (!status) return null;
    const colors: Record<LinkedTradeStatus, { bg: string; color: string; label: string }> = {
      pending_approval: { bg: 'color-mix(in srgb, var(--warn) 15%, transparent)', color: 'var(--warn)', label: t('pendingApprovalStatus') },
      approved: { bg: 'color-mix(in srgb, var(--good) 15%, transparent)', color: 'var(--good)', label: t('approvedStatus') },
      rejected: { bg: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)', label: t('rejectedStatus') },
      cancellation_pending: { bg: 'color-mix(in srgb, var(--warn) 15%, transparent)', color: 'var(--warn)', label: t('cancellationPendingStatus') },
      cancelled: { bg: 'color-mix(in srgb, var(--muted) 15%, transparent)', color: 'var(--muted)', label: t('cancelledStatus') },
    };
    const s = colors[status];
    return <span className="pill" style={{ fontSize: 8, background: s.bg, color: s.color, fontWeight: 700 }}>{s.label}</span>;
  };

  // ─── KPI computations ───

  const outKpi = useMemo(() => {
    let vol = 0, netVal = 0;
    for (const deal of filteredOutgoingMerchantDeals) {
      const row = buildDealRowModel({ deal, perspective: 'outgoing', locale: t.isRTL ? 'ar' : 'en', resolveAvgBuy: resolveDealAvgBuy });
      vol += row.volume;
      netVal += row.myNet ?? 0;
    }
    return { count: filteredOutgoingMerchantDeals.length, vol, net: netVal };
  }, [filteredOutgoingMerchantDeals, resolveDealAvgBuy, t.isRTL]);

  const renderMyOrderMobileCard = useCallback((tr: Trade) => {
    const c = derived.tradeCalc.get(tr.id);
    const ok = !!c?.ok;
    const rev = tr.amountUSDT * tr.sellPriceQAR;
    const isMerchantLinked = !!(tr.agreementFamily || tr.linkedDealId || tr.linkedRelId);
    const rawNet = ok ? c!.netQAR : (tr.manualBuyPrice ? rev - tr.amountUSDT * tr.manualBuyPrice - tr.feeQAR : NaN);
    const net = isMerchantLinked && tr.merchantPct && Number.isFinite(rawNet) ? rawNet * (tr.merchantPct / 100) : rawNet;
    const cn = state.customers.find(x => x.id === tr.customerId)?.name || '—';
    const linkedRel = isMerchantLinked ? relationships.find(r => r.id === tr.linkedRelId) : null;

    return (
      <div key={`mobile-trade-${tr.id}`} className="previewBox" style={{ padding: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono">{fmtDate(tr.ts)}</span>
            <span className="pill" style={{ fontSize: 9, color: isMerchantLinked ? 'var(--brand)' : 'var(--muted)' }}>
              {isMerchantLinked ? '🤝 Linked' : '👤 Trade'}
            </span>
            {getApprovalStatusBadge(tr.approvalStatus as LinkedTradeStatus | undefined)}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span className="muted">{t('buyer')}</span>
            <strong style={{ fontSize: 11, textAlign: 'right' }}>{cn}</strong>
          </div>
          {isMerchantLinked && linkedRel && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span className="muted">{t('merchant')}</span>
              <strong style={{ fontSize: 11, textAlign: 'right' }}>{linkedRel.counterparty?.display_name || '—'}</strong>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
            <div className="panel" style={{ padding: 6 }}>
              <div className="muted" style={{ fontSize: 9 }}>{t('qty')}</div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{fmtU(tr.amountUSDT)}</div>
            </div>
            <div className="panel" style={{ padding: 6 }}>
              <div className="muted" style={{ fontSize: 9 }}>{t('sell')}</div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{fmtP(tr.sellPriceQAR)}</div>
            </div>
            <div className="panel" style={{ padding: 6 }}>
              <div className="muted" style={{ fontSize: 9 }}>{t('volume')}</div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{fmtQ(rev)}</div>
            </div>
            <div className="panel" style={{ padding: 6 }}>
              <div className="muted" style={{ fontSize: 9 }}>{t('avgBuy')}</div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{ok ? fmtP(c!.avgBuyQAR) : '—'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span className="muted">{t('net')}</span>
            <span style={{ color: Number.isFinite(net) ? (net >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)', fontWeight: 700, fontSize: 11 }}>
              {Number.isFinite(net) ? `${net >= 0 ? '+' : ''}${fmtQ(net)}` : '—'}
            </span>
          </div>
        </div>
      </div>
    );
  }, [derived.tradeCalc, relationships, state.customers, t]);

  const renderOrdersMobileCard = useCallback((deal: MerchantDeal, perspective: 'incoming' | 'outgoing') => {
    const rel = relationships.find(r => r.id === deal.relationship_id);
    const row = buildDealRowModel({ deal, perspective, locale: t.isRTL ? 'ar' : 'en', resolveAvgBuy: resolveDealAvgBuy });
    const merchantName = rel?.counterparty?.display_name || '—';

    const statusColors: Record<string, { bg: string; color: string }> = {
      pending: { bg: 'color-mix(in srgb, var(--warn) 15%, transparent)', color: 'var(--warn)' },
      approved: { bg: 'color-mix(in srgb, var(--good) 15%, transparent)', color: 'var(--good)' },
      rejected: { bg: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)' },
      cancelled: { bg: 'color-mix(in srgb, var(--muted) 15%, transparent)', color: 'var(--muted)' },
    };
    const sc = statusColors[deal.status] || statusColors.pending;
    const marginLabel = row.margin != null && row.margin !== 0 ? `${(row.margin * 100).toFixed(2)}% ${t('marginLabel')}` : '—';

    return (
      <div key={`mobile-${deal.id}`} id={`deal-${deal.id}`} data-deal-id={deal.id} className="previewBox" style={{ padding: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono">{row.dateLabel}</span>
            <span className="pill" style={{ fontSize: 9, background: sc.bg, color: sc.color, fontWeight: 700 }}>{deal.status}</span>
            <span className="pill" style={{ fontSize: 9, color: 'var(--brand)' }}>{row.familyIcon} {row.familyLabel}</span>
            {row.splitLabel && <span className="pill" style={{ fontSize: 9, color: 'var(--brand)' }}>{row.splitLabel}</span>}
          </div>
          {row.margin != null && <span className="pill" style={{ fontSize: 9 }}>{marginLabel}</span>}
        </div>

        <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span className="muted">{t('merchant')}</span>
            <strong style={{ fontSize: 11, textAlign: 'right' }}>{merchantName}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span className="muted">{t('buyer')}</span>
            <strong style={{ fontSize: 11, textAlign: 'right' }}>{row.buyer || '—'}</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
            <div className="panel" style={{ padding: 6 }}>
              <div className="muted" style={{ fontSize: 9 }}>{t('qty')}</div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{fmtU(row.quantity)}</div>
            </div>
            <div className="panel" style={{ padding: 6 }}>
              <div className="muted" style={{ fontSize: 9 }}>{t('avgBuy')}</div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{row.hasAvgBuy ? fmtP(row.avgBuy) : '—'}</div>
            </div>
            <div className="panel" style={{ padding: 6 }}>
              <div className="muted" style={{ fontSize: 9 }}>{t('sell')}</div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{row.sellPrice > 0 ? fmtP(row.sellPrice) : '—'}</div>
            </div>
            <div className="panel" style={{ padding: 6 }}>
              <div className="muted" style={{ fontSize: 9 }}>{t('volume')}</div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{fmtQ(row.volume)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span className="muted">{t('net')}</span>
            {!row.hasAvgBuy ? (
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
            ) : row.myPct != null && row.fullNet != null && row.myNet != null && row.fullNet !== row.myNet ? (
              <span style={{ color: row.myNet >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700, fontSize: 11 }}>
                {row.myNet >= 0 ? '+' : ''}{fmtQ(row.myNet)} <span style={{ fontSize: 9, opacity: 0.7 }}>({t('myCut')})</span>
              </span>
            ) : (
              <span style={{ color: (row.myNet ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700, fontSize: 11 }}>
                {row.myNet != null && row.myNet !== 0 ? `${row.myNet >= 0 ? '+' : ''}${fmtQ(row.myNet)}` : '—'}
              </span>
            )}
          </div>
        </div>

        <div className="actionsRow" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          {perspective === 'incoming' && deal.status === 'pending' && (
            <>
              <button className="rowBtn" style={{ color: 'var(--good)', fontWeight: 700, minHeight: 40 }} onClick={() => approveIncomingDeal(deal.id)}>{t('approve')}</button>
              <button className="rowBtn" style={{ color: 'var(--bad)', minHeight: 40 }} onClick={() => rejectIncomingDeal(deal.id)}>{t('reject')}</button>
            </>
          )}
          {perspective === 'incoming' && deal.status === 'approved' && (
            <span className="pill" style={{ fontSize: 10, background: 'color-mix(in srgb, var(--good) 15%, transparent)', color: 'var(--good)', fontWeight: 700, gridColumn: '1 / -1', textAlign: 'center' }}>✅ {t('approvedStatus')}</span>
          )}
          {perspective === 'incoming' && deal.status === 'rejected' && (
            <span className="pill" style={{ fontSize: 10, background: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)', fontWeight: 700, gridColumn: '1 / -1', textAlign: 'center' }}>❌ {t('rejectedStatus')}</span>
          )}

          {perspective === 'outgoing' && deal.status === 'pending' && (
            <>
              <button className="rowBtn" onClick={() => openDealEdit(deal)} style={{ minHeight: 40 }}>{t('edit')}</button>
              <button className="rowBtn" style={{ color: 'var(--bad)', minHeight: 40 }} onClick={() => setDeleteDealConfirm(deal.id)}>{t('cancel')}</button>
            </>
          )}
          {perspective === 'outgoing' && deal.status === 'approved' && (
            <button className="rowBtn" style={{ color: 'var(--bad)', minHeight: 40, gridColumn: '1 / -1' }} onClick={() => setDeleteDealConfirm(deal.id)}>{t('cancel')}</button>
          )}
        </div>
      </div>
    );
  }, [relationships, t, resolveDealAvgBuy, approveIncomingDeal, rejectIncomingDeal, openDealEdit]);

  const inKpi = useMemo(() => {
    let vol = 0, netVal = 0;
    for (const deal of filteredIncomingMerchantDeals) {
      const row = buildDealRowModel({ deal, perspective: 'incoming', locale: t.isRTL ? 'ar' : 'en', resolveAvgBuy: resolveDealAvgBuy });
      vol += row.volume;
      netVal += row.myNet ?? 0;
    }
    return { count: filteredIncomingMerchantDeals.length, vol, net: netVal };
  }, [filteredIncomingMerchantDeals, resolveDealAvgBuy, t.isRTL]);

  const renderKpiBar = (kpi: { count: number; qty?: number; vol: number; net: number }) => (
    <div style={{ display: 'flex', gap: 16, padding: '8px 12px', background: 'color-mix(in srgb, var(--brand) 5%, transparent)', borderRadius: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>{t('count').toUpperCase()}</div><div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{kpi.count}</div></div>
      {kpi.qty != null && <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>USDT {t('qty').toUpperCase()}</div><div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtU(kpi.qty)}</div></div>}
      <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>{t('volume').toUpperCase()}</div><div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtQ(kpi.vol)}</div></div>
      <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>{t('net').toUpperCase()} P&L</div><div className="mono" style={{ fontSize: 13, fontWeight: 700, color: kpi.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>{kpi.net >= 0 ? '+' : ''}{fmtQ(kpi.net)}</div></div>
    </div>
  );

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: '100%' }}>

      {/* ─── TAB BAR ─── */}
      <div className="orders-tab-bar">
        <button
          onClick={() => { setActiveTab('my'); setMerchantOrderEnabled(false); }}
          className={`orders-tab-btn ${activeTab === 'my' ? 'active' : ''}`}
        >
          👤 {t('myOrders')}
        </button>
        <button
          onClick={() => { setActiveTab('incoming'); setMerchantOrderEnabled(true); setLinkedRelId(''); setSelectedTemplateId(null); setSaleAmount(''); }}
          className={`orders-tab-btn ${activeTab === 'incoming' ? 'active' : ''}`}
        >
          📥 {t('incomingOrders')}
        </button>
        <button
          onClick={() => { setActiveTab('outgoing'); setMerchantOrderEnabled(true); setLinkedRelId(''); setSelectedTemplateId(null); setSaleAmount(''); }}
          className={`orders-tab-btn ${activeTab === 'outgoing' ? 'active' : ''}`}
        >
          📤 {t('outgoingOrders')}
        </button>
        <button
          onClick={() => { 
            setActiveTab('transfers'); 
            setMerchantOrderEnabled(true); 
            setSelectedTemplateId('capital_transfer'); 
          }}
          className={`orders-tab-btn ${activeTab === 'transfers' ? 'active' : ''}`}
        >
          💸 {t('usdtTransfers')}
        </button>
      </div>

      <div className="twoColPage orders-two-col">

        {/* ═══════════ LEFT PANEL ═══════════ */}
        <div>

          {/* ── MY ORDERS TAB ── */}
          {activeTab === 'my' && (
            <>
              <div 
                className="orders-tab-bar" 
                style={{ 
                  marginBottom: 8, 
                  background: 'transparent', 
                  border: 'none', 
                  padding: 0, 
                  gap: 8,
                  boxShadow: 'none'
                }}
              >
                <button
                  onClick={() => setSelectedMonth('all')}
                  className={`orders-tab-btn ${selectedMonth === 'all' ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
                >
                  {t('allMonths')}
                </button>
                {availableMonths.map(m => {
                  const [y, mm] = m.split('-');
                  const label = new Date(parseInt(y), parseInt(mm) - 1).toLocaleString(t.lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', year: '2-digit' });
                  return (
                    <button
                      key={m}
                      onClick={() => setSelectedMonth(m)}
                      className={`orders-tab-btn ${selectedMonth === m ? 'active' : ''}`}
                      style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {renderKpiBar({ count: myKpi.count, qty: myKpi.qty, vol: myKpi.vol, net: myKpi.net })}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{t('trades')}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('fifoCostBasisMargin')}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className="pill">{rLabel}</span>
                  <button className="btn secondary" onClick={exportCsv}>CSV</button>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 4h10M7 8h10M7 12h10M7 16h10M7 20h10" /></svg>
                  <div className="empty-t">{t('noTradesYet')}</div>
                  <div className="empty-s">{t('addBatchThenSale')}</div>
                </div>
              ) : isMobile ? (
                <div style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }}>
                  {subFilteredMy.map((tr) => renderMyOrderMobileCard(tr))}
                </div>
              ) : (
                <div className="tableWrap ledgerWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('date')}</th><th>{t('type')}</th><th>{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r hide-mobile">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r hide-mobile">{t('volume')}</th><th className="r">{t('net')}</th><th className="hide-mobile">{t('margin')}</th><th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subFilteredMy.map(tr => {
                        const c = derived.tradeCalc.get(tr.id);
                        const ok = !!c?.ok;
                        const rev = tr.amountUSDT * tr.sellPriceQAR;
                        const isMerchantLinked = !!(tr.agreementFamily || tr.linkedDealId || tr.linkedRelId);
                        const rawNet = ok ? c!.netQAR : (tr.manualBuyPrice ? rev - tr.amountUSDT * tr.manualBuyPrice - tr.feeQAR : NaN);
                        const net = isMerchantLinked && tr.merchantPct && Number.isFinite(rawNet) ? rawNet * (tr.merchantPct / 100) : rawNet;
                        const margin = Number.isFinite(net) && rev > 0 ? net / rev : NaN;
                        const pct = Number.isFinite(margin) ? Math.min(1, Math.abs(margin) / 0.05) : 0;
                        const cn = state.customers.find(x => x.id === tr.customerId)?.name || '';
                        const linkedRel = isMerchantLinked ? relationships.find(r => r.id === tr.linkedRelId) : null;
                        return (
                          <React.Fragment key={tr.id}>
                            <tr id={`order-${tr.id}`} data-order-id={tr.id} style={isMerchantLinked ? { background: 'color-mix(in srgb, var(--brand) 4%, transparent)' } : undefined}>
                            <td>
                              <span className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(tr.ts)}</span>
                              {!ok && <span className="pill bad" style={{ fontSize: 9, marginLeft: 4 }}>!</span>}
                            </td>
                            <td style={{ textAlign: 'center', fontSize: 16 }}>
                              {isMerchantLinked ? '🤝' : '👤'}
                            </td>
                            <td>{cn ? <span className="tradeBuyerChip" title={cn} style={{ maxWidth: 130 }}>{cn}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                            <td className="mono r">{fmtU(tr.amountUSDT)}</td>
                            <td className="mono r hide-mobile">{ok ? fmtP(c!.avgBuyQAR) : '—'}</td>
                            <td className="mono r">{fmtP(tr.sellPriceQAR)}</td>
                            <td className="mono r hide-mobile">{fmtQ(rev)}</td>
                            <td className="mono r" style={{ color: Number.isFinite(net) ? (net >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)', fontWeight: 700 }}>{Number.isFinite(net) ? (net >= 0 ? '+' : '') + fmtQ(net) : '—'}</td>
                            <td className="hide-mobile">
                              <div className={`prog ${Number.isFinite(margin) && margin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(pct * 100).toFixed(0)}%` }} /></div>
                              <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{Number.isFinite(margin) ? `${(margin * 100).toFixed(2)}% ${t('marginLabel')}` : '—'}</div>
                            </td>
                            <td>
                              <div className="actionsRow">
                                <button className="rowBtn" onClick={() => setDetailsOpen(prev => ({ ...prev, [tr.id]: !prev[tr.id] }))}>
                                  {detailsOpen[tr.id] ? t('hideDetails') : t('details')}
                                </button>
                                {(!tr.approvalStatus || tr.approvalStatus === 'pending_approval') && (
                                  <button className="rowBtn" onClick={() => openEdit(tr.id)}>{t('edit')}</button>
                                )}
                                {tr.approvalStatus === 'pending_approval' && (
                                  <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => handleCancelTrade(tr.id)}>{t('cancel')}</button>
                                )}
                                {tr.approvalStatus === 'approved' && (
                                  <button className="rowBtn" style={{ color: 'var(--warn)' }} onClick={() => handleCancelTrade(tr.id)}>{t('requestCancellation')}</button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {detailsOpen[tr.id] && (
                            <tr>
                              <td colSpan={10} style={{ padding: 0 }}>
                                {renderDetail(tr, c)}
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── INCOMING ORDERS TAB ── */}
          {activeTab === 'incoming' && (
            <>
              <div 
                className="orders-tab-bar" 
                style={{ 
                  marginBottom: 8, 
                  background: 'transparent', 
                  border: 'none', 
                  padding: 0, 
                  gap: 8,
                  boxShadow: 'none'
                }}
              >
                <button
                  onClick={() => setSelectedMonth('all')}
                  className={`orders-tab-btn ${selectedMonth === 'all' ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
                >
                  {t('allMonths')}
                </button>
                {availableMonths.map(m => {
                  const [y, mm] = m.split('-');
                  const label = new Date(parseInt(y), parseInt(mm) - 1).toLocaleString(t.lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', year: '2-digit' });
                  return (
                    <button
                      key={m}
                      onClick={() => setSelectedMonth(m)}
                      className={`orders-tab-btn ${selectedMonth === m ? 'active' : ''}`}
                      style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {renderKpiBar({ count: inKpi.count, vol: inKpi.vol, net: inKpi.net })}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>📥 {t('incomingOrders')}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('partnerTradesAwaitingApproval')}</div>
                </div>
                <span className="pill">{subFilteredInDeals.length} {t('trades')}</span>
              </div>

              {subFilteredInDeals.length === 0 ? (
                <div className="empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 4h10M7 8h10M7 12h10M7 16h10M7 20h10" /></svg>
                  <div className="empty-t">{t('noIncomingTrades')}</div>
                  <div className="empty-s">{t('incomingTradesDesc')}</div>
                </div>
              ) : isMobile ? (
                <div style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }}>
                  {subFilteredInDeals.map((deal) => renderOrdersMobileCard(deal, 'incoming'))}
                </div>
              ) : (
                <div className="tableWrap ledgerWrap">
                  <table>
                    <thead>
                      <tr>
                        {/* Identical header columns as Outgoing tab */}
                        <th>{t('date')}</th><th>{t('merchant')}</th><th className="hide-mobile">{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r hide-mobile">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r hide-mobile">{t('volume')}</th><th className="r">{t('net')}</th><th className="hide-mobile">{t('margin')}</th><th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subFilteredInDeals.map(deal => {
                        const rel = relationships.find(r => r.id === deal.relationship_id);
                        const row = buildDealRowModel({ deal, perspective: 'incoming', locale: t.isRTL ? 'ar' : 'en', resolveAvgBuy: resolveDealAvgBuy });
                        const marginPct = row.margin != null ? Math.min(1, Math.abs(row.margin) / 0.05) : 0;
                        const merchantName = rel?.counterparty?.display_name || '—';

                        // Same status colour map as Outgoing
                        const statusColors: Record<string, { bg: string; color: string }> = {
                          pending: { bg: 'color-mix(in srgb, var(--warn) 15%, transparent)', color: 'var(--warn)' },
                          approved: { bg: 'color-mix(in srgb, var(--good) 15%, transparent)', color: 'var(--good)' },
                          rejected: { bg: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)' },
                          cancelled: { bg: 'color-mix(in srgb, var(--muted) 15%, transparent)', color: 'var(--muted)' },
                        };
                        const sc = statusColors[deal.status] || statusColors.pending;

                        return (
                          <tr key={deal.id} id={`deal-${deal.id}`} data-deal-id={deal.id}>
                            {/* DATE cell — identical layout to Outgoing: date + status pill + deal-type pill + split pill */}
                            <td>
                              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span className="mono">{row.dateLabel}</span>
                                <span className="pill" style={{ fontSize: 8, background: sc.bg, color: sc.color, fontWeight: 700 }}>{deal.status}</span>
                                <span className="pill" style={{ fontSize: 8, color: 'var(--brand)' }}>{row.familyIcon} {row.familyLabel}</span>
                                {row.splitLabel && <span className="pill" style={{ fontSize: 8, color: 'var(--brand)' }}>{row.splitLabel}</span>}
                              </div>
                            </td>
                            {/* MERCHANT — counterparty who created the deal */}
                            <td>{merchantName !== '—' ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{merchantName}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                            {/* BUYER — same customer field stored in deal notes */}
                            <td className="hide-mobile">{row.buyer ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{row.buyer}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                            <td className="mono r">{fmtU(row.quantity)}</td>
                            <td className="mono r hide-mobile">{row.hasAvgBuy ? fmtP(row.avgBuy) : '—'}</td>
                            <td className="mono r">{row.sellPrice > 0 ? fmtP(row.sellPrice) : '—'}</td>
                            <td className="mono r hide-mobile">{fmtQ(row.volume)}</td>
                            {/* NET — same dual display as Outgoing: crossed-out full net + "my cut" */}
                            <td className="mono r">
                              {!row.hasAvgBuy ? (
                                <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>
                              ) : row.myPct != null && row.fullNet != null && row.myNet != null && row.fullNet !== row.myNet ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                                  <span style={{ color: 'var(--muted)', fontSize: 9, textDecoration: 'line-through' }}>
                                    {row.fullNet >= 0 ? '+' : ''}{fmtQ(row.fullNet)}
                                  </span>
                                  <span style={{ color: row.myNet >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                                     {row.myNet >= 0 ? '+' : ''}{fmtQ(row.myNet)} <span style={{ fontSize: 8, opacity: 0.7 }}>{t('myCut')}</span>
                                  </span>
                                </div>
                              ) : (
                                <span style={{ color: (row.myNet ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                                  {row.myNet != null && row.myNet !== 0 ? `${row.myNet >= 0 ? '+' : ''}${fmtQ(row.myNet)}` : '—'}
                                </span>
                              )}
                            </td>
                            <td className="hide-mobile">
                              <div className={`prog ${row.margin != null && row.margin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(marginPct * 100).toFixed(0)}%` }} /></div>
                              <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{row.margin != null && row.margin !== 0 ? `${(row.margin * 100).toFixed(2)}% ${t('marginLabel')}` : '—'}</div>
                            </td>
                            <td>
                              <div className="actionsRow">
                                {deal.status === 'pending' && (
                                  <>
                                    <button className="rowBtn" style={{ color: 'var(--good)', fontWeight: 700 }} onClick={() => approveIncomingDeal(deal.id)}>{t('approve')}</button>
                                    <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => rejectIncomingDeal(deal.id)}>{t('reject')}</button>
                                  </>
                                )}
                                {deal.status === 'approved' && (
                                  <span className="pill" style={{ fontSize: 8, background: 'color-mix(in srgb, var(--good) 15%, transparent)', color: 'var(--good)', fontWeight: 700 }}>✅ {t('approvedStatus')}</span>
                                )}
                                {deal.status === 'rejected' && (
                                  <span className="pill" style={{ fontSize: 8, background: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)', fontWeight: 700 }}>❌ {t('rejectedStatus')}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── OUTGOING ORDERS TAB (Server-Only) ── */}
          {activeTab === 'outgoing' && (
            <>
              <div 
                className="orders-tab-bar" 
                style={{ 
                  marginBottom: 8, 
                  background: 'transparent', 
                  border: 'none', 
                  padding: 0, 
                  gap: 8,
                  boxShadow: 'none'
                }}
              >
                <button
                  onClick={() => setSelectedMonth('all')}
                  className={`orders-tab-btn ${selectedMonth === 'all' ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
                >
                  {t('allMonths')}
                </button>
                {availableMonths.map(m => {
                  const [y, mm] = m.split('-');
                  const label = new Date(parseInt(y), parseInt(mm) - 1).toLocaleString(t.lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', year: '2-digit' });
                  return (
                    <button
                      key={m}
                      onClick={() => setSelectedMonth(m)}
                      className={`orders-tab-btn ${selectedMonth === m ? 'active' : ''}`}
                      style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {renderKpiBar({ count: outKpi.count, vol: outKpi.vol, net: outKpi.net })}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>📤 {t('outgoingOrders')}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('yourMerchantLinkedTrades')}</div>
                </div>
                <span className="pill">{subFilteredOutDeals.length} {t('trades')}</span>
              </div>

              {subFilteredOutDeals.length === 0 ? (
                <div className="empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 4h10M7 8h10M7 12h10M7 16h10M7 20h10" /></svg>
                  <div className="empty-t">{t('noOutgoingTrades')}</div>
                  <div className="empty-s">{t('outgoingTradesDesc')}</div>
                </div>
              ) : isMobile ? (
                <div style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }}>
                  {subFilteredOutDeals.map((deal) => renderOrdersMobileCard(deal, 'outgoing'))}
                </div>
              ) : (
                <div className="tableWrap ledgerWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('date')}</th><th>{t('merchant')}</th><th className="hide-mobile">{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r hide-mobile">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r hide-mobile">{t('volume')}</th><th className="r">{t('net')}</th><th className="hide-mobile">{t('margin')}</th><th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subFilteredOutDeals.map(deal => {
                        const rel = relationships.find(r => r.id === deal.relationship_id);
                        const row = buildDealRowModel({ deal, perspective: 'outgoing', locale: t.isRTL ? 'ar' : 'en', resolveAvgBuy: resolveDealAvgBuy });
                        const marginPct = row.margin != null ? Math.min(1, Math.abs(row.margin) / 0.05) : 0;
                        const merchantName = rel?.counterparty?.display_name || '—';

                        const statusColors: Record<string, { bg: string; color: string }> = {
                          pending: { bg: 'color-mix(in srgb, var(--warn) 15%, transparent)', color: 'var(--warn)' },
                          approved: { bg: 'color-mix(in srgb, var(--good) 15%, transparent)', color: 'var(--good)' },
                          rejected: { bg: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)' },
                          cancelled: { bg: 'color-mix(in srgb, var(--muted) 15%, transparent)', color: 'var(--muted)' },
                        };
                        const sc = statusColors[deal.status] || statusColors.pending;

                        return (
                          <tr key={`deal-${deal.id}`} id={`deal-${deal.id}`} data-deal-id={deal.id}>
                            <td>
                              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span className="mono">{row.dateLabel}</span>
                                <span className="pill" style={{ fontSize: 8, background: sc.bg, color: sc.color, fontWeight: 700 }}>{deal.status}</span>
                                <span className="pill" style={{ fontSize: 8, color: 'var(--brand)' }}>{row.familyIcon} {row.familyLabel}</span>
                                {row.splitLabel && <span className="pill" style={{ fontSize: 8, color: 'var(--brand)' }}>{row.splitLabel}</span>}
                              </div>
                            </td>
                            <td>{merchantName !== '—' ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{merchantName}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                            <td className="hide-mobile">{row.buyer ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{row.buyer}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                            <td className="mono r">{fmtU(row.quantity)}</td>
                            <td className="mono r hide-mobile">{row.hasAvgBuy ? fmtP(row.avgBuy) : '—'}</td>
                            <td className="mono r">{row.sellPrice > 0 ? fmtP(row.sellPrice) : '—'}</td>
                            <td className="mono r hide-mobile">{fmtQ(row.volume)}</td>
                            <td className="mono r">
                              {!row.hasAvgBuy ? (
                                <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>
                              ) : row.myPct != null && row.fullNet != null && row.myNet != null && row.fullNet !== row.myNet ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                                  <span style={{ color: 'var(--muted)', fontSize: 9, textDecoration: 'line-through' }}>
                                    {row.fullNet >= 0 ? '+' : ''}{fmtQ(row.fullNet)}
                                  </span>
                                  <span style={{ color: row.myNet >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                                    {row.myNet >= 0 ? '+' : ''}{fmtQ(row.myNet)} <span style={{ fontSize: 8, opacity: 0.7 }}>{t('myCut')}</span>
                                  </span>
                                </div>
                              ) : (
                                <span style={{ color: (row.myNet ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                                  {row.myNet != null && row.myNet !== 0 ? `${row.myNet >= 0 ? '+' : ''}${fmtQ(row.myNet)}` : '—'}
                                </span>
                              )}
                            </td>
                            <td className="hide-mobile">
                              <div className={`prog ${row.margin != null && row.margin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(marginPct * 100).toFixed(0)}%` }} /></div>
                              <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{row.margin != null && row.margin !== 0 ? `${(row.margin * 100).toFixed(2)}% ${t('marginLabel')}` : '—'}</div>
                            </td>
                            <td>
                              <div className="actionsRow">
                                {deal.status === 'pending' && (
                                  <>
                                    <button className="rowBtn" onClick={() => openDealEdit(deal)}>{t('edit')}</button>
                                    <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => setDeleteDealConfirm(deal.id)}>{t('cancel')}</button>
                                  </>
                                )}
                                {deal.status === 'approved' && (
                                  <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => setDeleteDealConfirm(deal.id)}>{t('cancel')}</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── USDT TRANSFERS TAB ── */}
          {activeTab === 'transfers' && (
            <>
              <div 
                className="orders-tab-bar" 
                style={{ 
                  marginBottom: 8, 
                  background: 'transparent', 
                  border: 'none', 
                  padding: 0, 
                  gap: 8,
                  boxShadow: 'none'
                }}
              >
                <button
                  onClick={() => setSelectedMonth('all')}
                  className={`orders-tab-btn ${selectedMonth === 'all' ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
                >
                  {t('allMonths')}
                </button>
                {availableMonths.map(m => {
                  const [y, mm] = m.split('-');
                  const label = new Date(parseInt(y), parseInt(mm) - 1).toLocaleString(t.lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', year: '2-digit' });
                  return (
                    <button
                      key={m}
                      onClick={() => setSelectedMonth(m)}
                      className={`orders-tab-btn ${selectedMonth === m ? 'active' : ''}`}
                      style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="tableHeader" style={{ marginBottom: 12 }}>
                <div>
                  <div className="title">💸 {t('usdtTransfers')}</div>
                  <div className="subtitle">{t('capitalTransfersDesc')}</div>
                </div>
              </div>

              {subFilteredTransfers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)', background: 'var(--panel)', borderRadius: 12 }}>
                  <div style={{ fontSize: 24, marginBottom: 12 }}>💸</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--t1)', marginBottom: 4 }}>{t('noTransfers')}</div>
                  <div style={{ fontSize: 11 }}>{t('createTransferDesc')}</div>
                </div>
              ) : isMobile ? (
                <div style={{ display: 'grid', gap: 8, paddingBottom: 80 }}>
                  {subFilteredTransfers.map((tx: any) => {
                    const rel = relationships.find(r => r.id === tx.relationship_id);
                    const isIn = tx.direction === 'lender_to_operator';
                    return (
                      <div key={tx.id} id={`transfer-${tx.id}`} data-transfer-id={tx.id} className="previewBox" style={{ padding: 12, background: 'var(--panel)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(tx.created_at).toLocaleDateString()}</span>
                          <span className={`pill ${isIn ? 'good' : 'warn'}`} style={{ fontSize: 10, padding: '2px 8px' }}>
                            {isIn ? '💸 ' + t('capitalIn') : '↩️ ' + t('capitalReturn')}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span className="muted" style={{ fontSize: 10 }}>{t('merchant')}</span>
                            <strong style={{ fontSize: 11, textAlign: 'right' }}>{rel?.counterparty?.display_name || '—'}</strong>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                            <div className="panel" style={{ padding: 8, background: 'var(--bg)', borderRadius: 6 }}>
                              <div className="muted" style={{ fontSize: 9, marginBottom: 2 }}>USDT</div>
                              <div className="mono" style={{ fontWeight: 700, fontSize: 13, color: isIn ? 'var(--good)' : 'var(--bad)' }}>
                                {isIn ? '+' : '−'}{fmtU(tx.amount)}
                              </div>
                            </div>
                            <div className="panel" style={{ padding: 8, background: 'var(--bg)', borderRadius: 6 }}>
                              <div className="muted" style={{ fontSize: 9, marginBottom: 2 }}>{t('costBasisQar')}</div>
                              <div className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{fmtP(tx.cost_basis)}</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 4, borderTop: '1px solid var(--line)' }}>
                            <span className="muted" style={{ fontSize: 10 }}>{t('totalCostQar')}</span>
                            <strong className="mono" style={{ fontSize: 11 }}>{fmtQ(tx.total_cost)}</strong>
                          </div>
                          {tx.note && (
                            <div style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic', background: 'var(--panel2)', padding: '4px 8px', borderRadius: 4 }}>
                              {tx.note}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('date')}</th>
                        <th>{t('direction')}</th>
                        <th>{t('merchant')}</th>
                        <th className="r">USDT {t('amount')}</th>
                        <th className="r">{t('costBasisQar')}</th>
                        <th className="r">{t('totalCostQar')}</th>
                        <th>{t('notes')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subFilteredTransfers.map((tx: any) => {
                        const rel = relationships.find(r => r.id === tx.relationship_id);
                        const isIn = tx.direction === 'lender_to_operator';
                        return (
                          <tr key={tx.id} id={`transfer-${tx.id}`} data-transfer-id={tx.id}>
                            <td className="mono" style={{ fontSize: 10 }}>
                              {new Date(tx.created_at).toLocaleDateString()}
                            </td>
                            <td>
                              <span className={`pill ${isIn ? 'good' : 'warn'}`} style={{ fontSize: 9 }}>
                                {isIn ? '💸 ' + t('capitalIn') : '↩️ ' + t('capitalReturn')}
                              </span>
                            </td>
                            <td style={{ fontSize: 11, fontWeight: 600 }}>
                              {rel?.counterparty?.display_name || '—'}
                            </td>
                            <td className="mono r" style={{ fontWeight: 700, color: isIn ? 'var(--good)' : 'var(--bad)', fontSize: 12 }}>
                              {isIn ? '+' : '−'}{fmtU(tx.amount)}
                            </td>
                            <td className="mono r" style={{ fontSize: 10, color: 'var(--muted)' }}>
                              {fmtP(tx.cost_basis)}
                            </td>
                            <td className="mono r" style={{ fontSize: 11, fontWeight: 600 }}>
                              {fmtQ(tx.total_cost)}
                            </td>
                            <td style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tx.note || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

        </div>

        {/* ═══════════ RIGHT PANEL ═══════════ */}
        <div>

          {/* ── MY ORDERS: New Sale Form ── */}
          {activeTab === 'my' && (
            <div className="formPanel salePanel">
              <div className="hdr">{t('newSale')}</div>
              <div className="inner" style={isMobile ? { paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))' } : undefined}>
                {/* Normal sale form — hidden when Capital Transfer is selected */}
                {!isCapitalTransfer && (<>

                {/* Price mode toggle: FIFO vs Manual */}
                <div className="bannerRow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="bLbl">{t('avPrice')}</span>
                    <span className="bVal">{priceMode === 'fifo' && wacop ? fmtP(wacop) : '—'}</span>
                  </div>
                  <div className="modeToggle" style={{ fontSize: 9 }}>
                     <button type="button" className={priceMode === 'fifo' ? 'active' : ''} onClick={() => { setPriceMode('fifo'); setUseStock(true); }} style={mobileActionStyle}>{t('fifoLabel')}</button>
                     <button type="button" className={priceMode === 'manual' ? 'active' : ''} onClick={() => { setPriceMode('manual'); setUseStock(false); }} style={mobileActionStyle}>{t('manualLabel')}</button>
                  </div>
                </div>

                <div className="field2">
                  <div className="lbl">{t('dateTime')}</div>
                  <div className="inputBox"><input type="datetime-local" value={saleDate} onChange={e => setSaleDate(e.target.value)} style={mobileInputStyle} /></div>
                </div>

                <div className="field2">
                  <div className="lbl">{t('inputMode')}</div>
                  <div className="modeToggle">
                    <button className={saleEntryMode === 'price_vol' ? 'active' : ''} type="button" onClick={() => setSaleEntryMode('price_vol')} style={mobileActionStyle}>{t('entryModePriceVol')}</button>
                    <button className={saleEntryMode === 'qty_total' ? 'active' : ''} type="button" onClick={() => setSaleEntryMode('qty_total')} style={mobileActionStyle}>{t('entryModeUsdtQar')}</button>
                    <button className={saleEntryMode === 'qty_price' ? 'active' : ''} type="button" onClick={() => setSaleEntryMode('qty_price')} style={mobileActionStyle}>{t('entryModeUsdtPrice')}</button>
                  </div>
                </div>

                {saleEntryMode === 'price_vol' && (
                  <div className="g2tight">
                    <div className="field2">
                      <div className="lbl">{saleMode === 'USDT' ? t('quantity') : t('amountQar')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="0.00" value={saleAmount} onChange={numericOnly(setSaleAmount)} style={mobileInputStyle} /></div>
                      <div className="modeToggle" style={{ marginTop: 4, fontSize: 9 }}>
                        <button className={saleMode === 'USDT' ? 'active' : ''} type="button" onClick={() => setSaleMode('USDT')} style={mobileActionStyle}>USDT</button>
                        <button className={saleMode === 'QAR' ? 'active' : ''} type="button" onClick={() => setSaleMode('QAR')} style={mobileActionStyle}>QAR</button>
                      </div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('sellPriceLabel')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder={wacop ? fmtP(wacop) : '0.00'} value={saleSell} onChange={numericOnly(setSaleSell)} style={mobileInputStyle} /></div>
                    </div>
                  </div>
                )}

                {saleEntryMode === 'qty_total' && (
                  <div className="g2tight">
                    <div className="field2">
                      <div className="lbl">{t('totalUsdtSold')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="0.00" value={saleUsdtQty} onChange={numericOnly(setSaleUsdtQty)} style={mobileInputStyle} /></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('totalQarReceived')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="0.00" value={saleAmount} onChange={numericOnly(setSaleAmount)} style={mobileInputStyle} /></div>
                      {Number(saleUsdtQty) > 0 && Number(saleAmount) > 0 && (
                        <div style={{ fontSize: 9, color: 'var(--good)', marginTop: 2 }}>
                          {t('autoCalcSellPrice')}: {fmtPrice(Number(saleAmount) / Number(saleUsdtQty))} QAR/USDT
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {saleEntryMode === 'qty_price' && (
                  <div className="g2tight">
                    <div className="field2">
                      <div className="lbl">{t('totalUsdtSold')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="0.00" value={saleUsdtQty} onChange={numericOnly(setSaleUsdtQty)} style={mobileInputStyle} /></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('sellPriceLabel')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder={wacop ? fmtP(wacop) : '0.00'} value={saleSell} onChange={numericOnly(setSaleSell)} style={mobileInputStyle} /></div>
                      {Number(saleUsdtQty) > 0 && Number(saleSell) > 0 && (
                        <div style={{ fontSize: 9, color: 'var(--good)', marginTop: 2 }}>
                          {t('autoCalcTotalQar')}: {fmtTotal(Number(saleUsdtQty) * Number(saleSell))} QAR
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {priceMode === 'manual' && (
                  <div className="g2tight">
                    <div className="field2">
                      <div className="lbl">{t('buyPrice')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="0.00" value={manualBuyPrice} onChange={numericOnly(setManualBuyPrice)} style={mobileInputStyle} /></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('feeQarLabel') || 'Fee (QAR)'}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="0" value={saleFee} onChange={numericOnly(setSaleFee)} style={mobileInputStyle} /></div>
                    </div>
                  </div>
                )}

                {priceMode === 'fifo' && (
                  <div className="field2">
                    <div className="lbl">{t('feeQarLabel') || 'Fee (QAR)'}</div>
                    <div className="inputBox"><input inputMode="decimal" placeholder="0" value={saleFee} onChange={numericOnly(setSaleFee)} style={mobileInputStyle} /></div>
                  </div>
                )}

                <div className="field2">
                  <div className="lbl">{t('buyerName')} <span style={{ color: 'var(--bad)', fontWeight: 700 }}>*</span></div>
                  <div className="lookupShell">
                    <div className="inputBox lookupBox" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input placeholder={t('searchOrTypeBuyer')} autoComplete="off" value={buyerName}
                        onFocus={() => setBuyerMenuOpen(true)}
                        onChange={e => { setBuyerName(e.target.value); setBuyerId(''); setBuyerMenuOpen(true); }}
                        onBlur={() => window.setTimeout(() => setBuyerMenuOpen(false), 150)}
                        style={isMobile ? { flex: 1, paddingRight: 0, fontSize: 16, minHeight: 40 } : { flex: 1, paddingRight: 0 }}
                      />
                      <button className="sideAction" title={t('buyer')} type="button" onClick={() => setBuyerMenuOpen(v => !v)} style={isMobile ? { minWidth: 40, minHeight: 40 } : undefined}>⌄</button>
                      <button className="sideAction" title={t('addBuyerTitle')} type="button" onClick={() => { setNewBuyerName(buyerName); setAddBuyerOpen(v => !v); }} style={isMobile ? { minWidth: 40, minHeight: 40 } : undefined}>+</button>
                    </div>
                    {buyerMenuOpen && (
                      <div className="lookupMenu" style={isMobile ? { maxHeight: 220 } : undefined}>
                        {filteredCustomers.length ? filteredCustomers.map(c => (
                          <button key={c.id} className="lookupItem" type="button" onClick={() => { setBuyerName(c.name); setBuyerId(c.id); setBuyerMenuOpen(false); }} style={isMobile ? { minHeight: 44 } : undefined}>
                            <span>{c.name}</span><span className="lookupMeta">{c.phone || c.tier}</span>
                          </button>
                        )) : <div className="lookupItem" style={{ cursor: 'default' }}><span>{t('noBuyersYet')}</span></div>}
                      </div>
                    )}
                  </div>
                </div>

                {addBuyerOpen && (
                  <div className="previewBox" style={{ marginTop: 2 }}>
                    <div className="pt">{t('addBuyerTitle')}</div>
                    <div className="g2tight" style={{ marginBottom: 6 }}>
                      <div className="field2"><div className="lbl">{t('name')}</div><div className="inputBox"><input value={newBuyerName} onChange={e => setNewBuyerName(e.target.value)} placeholder={t('buyerNamePlaceholder')} style={mobileInputStyle} /></div></div>
                      <div className="field2"><div className="lbl">{t('phone')}</div><div className="inputBox"><input value={newBuyerPhone} onChange={e => setNewBuyerPhone(e.target.value)} placeholder="+974 ..." style={mobileInputStyle} /></div></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('tier')}</div>
                      <div className="modeToggle">{['A', 'B', 'C', 'D'].map(tier => (<button key={tier} type="button" className={newBuyerTier === tier ? 'active' : ''} onClick={() => setNewBuyerTier(tier)} style={mobileActionStyle}>{tier}</button>))}</div>
                    </div>
                    <div className="formActions"><button className="btn secondary" onClick={() => setAddBuyerOpen(false)} style={mobileActionStyle}>{t('cancel')}</button><button className="btn" onClick={addBuyerFromModal} style={mobileActionStyle}>{t('addBuyerTitle')}</button></div>
                  </div>
                )}

                </>)}

                {/* ─── MERCHANT-LINKED TRADE (NEW: MULTI-MERCHANT ALLOCATION) ─── */}
                <div className="previewBox" style={{ marginTop: 6, borderColor: merchantOrderEnabled ? 'var(--brand)' : undefined }}>
                  <div className="pt" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    🤝 {t('linkToPartner')}
                    <span style={{ fontSize: 9, color: 'var(--muted)' }}>{t('optional')}</span>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, cursor: 'pointer', color: 'var(--muted)', marginBottom: merchantOrderEnabled ? 8 : 0 }}>
                    <input
                      type="checkbox"
                      checked={merchantOrderEnabled}
                      onChange={e => {
                        const nextEnabled = e.target.checked;
                        setMerchantOrderEnabled(nextEnabled);
                        if (!nextEnabled) {
                          setSettleImmediately(false);
                          setLinkedRelId('');
                          setSelectedTemplateId(null);
                          setAllocations([]);
                        }
                      }}
                      style={{ accentColor: 'var(--brand)' }}
                    /> {t('isThisSaleLinked')}
                  </label>
                  {merchantOrderEnabled && (
                    <>
                      {/* ─── Step 1: Select Partner (Merchant) ─── */}
                      <div className="field2" style={{ marginBottom: 6 }}>
                        <div className="lbl">{t('selectPartner')} <span style={{ color: 'var(--bad)', fontWeight: 700 }}>*</span></div>
                        <select
                          value={linkedRelId}
                          onChange={e => {
                            setLinkedRelId(e.target.value);
                            setSelectedTemplateId(null);
                            setAllocations([]);
                          }}
                          style={{ width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                        >
                          <option value="">{t('noneSelected')}</option>
                          {relationships.map(r => (
                            <option key={r.id} value={r.id}>{r.counterparty?.display_name || r.id}</option>
                          ))}
                        </select>
                      </div>

                      {/* ─── Step 2: Deal Family (only after merchant selected) ─── */}
                      {linkedRelId && (() => {
                        const selectedRel = relationships.find(r => r.id === linkedRelId);
                        const cpName = selectedRel?.counterparty?.display_name || (selectedRel as any)?.counterparty_name || t('partner');
                        const cpId = selectedRel ? (selectedRel.merchant_a_id === merchantProfile?.merchant_id ? selectedRel.merchant_b_id : selectedRel.merchant_a_id) : '';
                        const relApprovedAgreements = allAgreements.filter(a =>
                          a.relationship_id === linkedRelId && a.status === 'approved' && isAgreementActive(a)
                        );

                        return (
                          <>
                            <div className="field2" style={{ marginBottom: 6 }}>
                              <div className="lbl">{t('dealFamilyLabel')} <span style={{ color: 'var(--bad)', fontWeight: 700 }}>*</span></div>
                              <select
                                value={selectedTemplateId || ''}
                                onChange={e => {
                                  const val = e.target.value || null;
                                  setSelectedTemplateId(val);
                                  setAllocations([]);
                                  // Auto-create allocation row for profit_share/sales_deal
                                  if (val === 'profit_share_family' || val === 'sales_deal_family') {
                                    setAllocations([{
                                      id: `alloc_${Date.now()}`,
                                      relationshipId: linkedRelId,
                                      merchantName: cpName,
                                      merchantId: cpId,
                                      family: val === 'profit_share_family' ? 'profit_share' : 'sales_deal',
                                      agreementId: null,
                                      agreementLabel: '',
                                      allocatedUsdt: saleAmount || '',
                                      merchantCostPerUsdt: '',
                                      partnerSharePct: 0,
                                      merchantSharePct: 0,
                                      note: '',
                                    }]);
                                  }
                                }}
                                style={{ width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                              >
                                <option value="">{t('selectDealFamily')}</option>
                                <option value="profit_share_family">🤝 {t('profitShareRequiresAgreement')} {relApprovedAgreements.length > 0 ? `(${relApprovedAgreements.length})` : ''}</option>
                                <option value="sales_deal_family">📊 {t('salesDealNoApproval')}</option>
                                <option value="capital_transfer">💸 {t('capitalTransferFamily')}</option>
                              </select>
                            </div>

                            {/* ─── Profit Share: Show approved agreements for this merchant ─── */}
                            {selectedTemplateId === 'profit_share_family' && (
                              <div style={{ marginTop: 4 }}>
                                <div style={{
                                  padding: '6px 10px', borderRadius: 4, fontSize: 9, lineHeight: 1.4, marginBottom: 8,
                                  background: 'color-mix(in srgb, var(--brand) 6%, transparent)',
                                  border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)',
                                  color: 'var(--muted)',
                                }}>
                                  <strong style={{ color: 'var(--brand)' }}>{t('profitShare')}:</strong> {t('profitShareInfoBanner')}
                                </div>

                                {relApprovedAgreements.length === 0 ? (
                                  <div style={{ fontSize: 10, color: 'var(--bad)', padding: '8px 10px', borderRadius: 6, background: 'color-mix(in srgb, var(--bad) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 15%, transparent)' }}>
                                    ⚠️ {t('noApprovedAgreement')} <strong>{cpName}</strong>. {t('createInWorkspaceFirst')}
                                  </div>
                                ) : (
                                  <>
                                    <div className="field2" style={{ marginBottom: 4 }}>
                                      <div className="lbl" style={{ fontSize: 9 }}>{t('approvedAgreement')} <span style={{ color: 'var(--bad)' }}>*</span></div>
                                      <select
                                        value={allocations[0]?.agreementId || ''}
                                        onChange={e => {
                                          const agr = relApprovedAgreements.find(a => a.id === e.target.value);
                                          setAllocations(prev => {
                                            const base = prev[0] || {
                                              id: `alloc_${Date.now()}`, relationshipId: linkedRelId, merchantName: cpName, merchantId: cpId,
                                              family: 'profit_share' as const, allocatedUsdt: saleAmount || '', merchantCostPerUsdt: '', note: '',
                                            };
                                            return [{
                                              ...base,
                                              agreementId: agr?.id || null,
                                              agreementLabel: agr ? getAgreementLabel(agr) : '',
                                              partnerSharePct: agr?.partner_ratio || 0,
                                              merchantSharePct: agr?.merchant_ratio || 0,
                                            }];
                                          });
                                        }}
                                        style={{ width: '100%', padding: '4px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                                      >
                                        <option value="">{t('selectAgreement')}</option>
                                        {relApprovedAgreements.map(agr => (
                                          <option key={agr.id} value={agr.id}>
                                            🤝 {agr.partner_ratio}/{agr.merchant_ratio} — {agr.settlement_cadence}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    {allocations[0]?.agreementId && (
                                      <div style={{ fontSize: 9, color: 'var(--brand)', marginTop: 2, fontWeight: 600, marginBottom: 6 }}>
                                        {t('lockedRatio')} {allocations[0].partnerSharePct}% / {t('youShare')} {allocations[0].merchantSharePct}%
                                      </div>
                                    )}
                                  </>
                                )}

                                {/* USDT & Cost fields for the allocation */}
                                {allocations[0]?.agreementId && (
                                  <div className="g2tight" style={{ marginTop: 6 }}>
                                    <div className="field2">
                                      <div className="lbl" style={{ fontSize: 9 }}>USDT {t('quantity')}</div>
                                      <div className="inputBox" style={{ padding: '3px 6px' }}>
                                        <input
                                          type="text" placeholder="0"
                                          value={allocations[0]?.allocatedUsdt || ''}
                                          onChange={e => {
                                            if (e.target.value === '' || /^-?\d*\.?\d*$/.test(e.target.value))
                                              setAllocations(prev => prev.map((a, i) => i === 0 ? { ...a, allocatedUsdt: e.target.value } : a));
                                          }}
                                          style={{ fontSize: 10 }}
                                        />
                                      </div>
                                    </div>
                                    <div className="field2">
                                      <div className="lbl" style={{ fontSize: 9 }}>{t('costBasisQar')}</div>
                                      <div className="inputBox" style={{ padding: '3px 6px' }}>
                                        <input
                                          type="text" placeholder="3.65"
                                          value={allocations[0]?.merchantCostPerUsdt || ''}
                                          onChange={e => {
                                            if (e.target.value === '' || /^-?\d*\.?\d*$/.test(e.target.value))
                                              setAllocations(prev => prev.map((a, i) => i === 0 ? { ...a, merchantCostPerUsdt: e.target.value } : a));
                                          }}
                                          style={{ fontSize: 10 }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* ─── Sales Deal: Template presets + multi-merchant ─── */}
                            {selectedTemplateId === 'sales_deal_family' && (
                              <div style={{ marginTop: 4 }}>
                                <div style={{
                                  padding: '6px 10px', borderRadius: 4, fontSize: 9, lineHeight: 1.4, marginBottom: 8,
                                  background: 'color-mix(in srgb, var(--good) 6%, transparent)',
                                  border: '1px solid color-mix(in srgb, var(--good) 15%, transparent)',
                                  color: 'var(--muted)',
                                }}>
                                  <strong style={{ color: 'var(--good)' }}>{t('salesDeal')}:</strong> {t('salesDealInfoBanner')}
                                </div>

                                {/* Template presets */}
                                <div className="lbl" style={{ fontSize: 9, marginBottom: 4 }}>{t('quickTemplate')}</div>
                                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                                   <button type="button" className="btn secondary" style={{ fontSize: 9, padding: '4px 10px', flex: 1, border: allocations[0]?.partnerSharePct === 50 ? '1.5px solid var(--brand)' : undefined }}
                                     onClick={() => setAllocations(prev => prev.map((a, i) => i === 0 ? { ...a, partnerSharePct: 50, merchantSharePct: 50, allocatedUsdt: saleAmount || a.allocatedUsdt } : a))}>{t('equalSplit')}
                                  </button>
                                  <button type="button" className="btn secondary" style={{ fontSize: 9, padding: '4px 10px', flex: 1, border: allocations.length > 1 ? '1.5px solid var(--brand)' : undefined }}
                                    onClick={() => {
                                      if (allocations.length <= 1) {
                                        // Add a second merchant row
                                        setAllocations(prev => [...prev, {
                                          id: `alloc_${Date.now()}`,
                                          relationshipId: '',
                                          merchantName: '',
                                          merchantId: '',
                                          family: 'sales_deal',
                                          agreementId: null,
                                          agreementLabel: '',
                                          allocatedUsdt: '',
                                          merchantCostPerUsdt: '',
                                          partnerSharePct: 0,
                                          merchantSharePct: 0,
                                          note: '',
                                        }]);
                                      }
                                     }}>
                                     {t('customMultiMerchant')}
                                  </button>
                                </div>

                                {/* Allocation rows */}
                                {allocations.map((alloc, idx) => (
                                  <div key={alloc.id} style={{
                                    padding: '8px 10px', borderRadius: 6, marginBottom: 6,
                                    background: 'color-mix(in srgb, var(--good) 4%, transparent)',
                                    border: '1px solid color-mix(in srgb, var(--good) 12%, transparent)',
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--good)' }}>
                                        {idx === 0 ? `📊 ${cpName}` : `📊 ${t('merchantN')} ${idx + 1}`}
                                      </span>
                                      {idx > 0 && (
                                        <button type="button" style={{ fontSize: 9, color: 'var(--bad)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                                          onClick={() => setAllocations(prev => prev.filter((_, i) => i !== idx))}>
                                          {t('removeMerchant')}
                                        </button>
                                      )}
                                    </div>

                                    {/* Merchant selector for additional allocations */}
                                    {idx > 0 && (
                                      <div className="field2" style={{ marginBottom: 4 }}>
                                        <div className="lbl" style={{ fontSize: 9 }}>{t('merchantN')}</div>
                                        <select
                                          value={alloc.relationshipId}
                                          onChange={e => {
                                            const rel = relationships.find(r => r.id === e.target.value);
                                            const relCpId = rel ? (rel.merchant_a_id === merchantProfile?.merchant_id ? rel.merchant_b_id : rel.merchant_a_id) : '';
                                            setAllocations(prev => prev.map((a, i) => i === idx ? {
                                              ...a,
                                              relationshipId: e.target.value,
                                              merchantName: rel?.counterparty?.display_name || '',
                                              merchantId: relCpId,
                                            } : a));
                                          }}
                                          style={{ width: '100%', padding: '4px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                                        >
                                          <option value="">{t('selectMerchantPlaceholder')}</option>
                                          {relationships.filter(r => r.id !== linkedRelId).map(r => (
                                            <option key={r.id} value={r.id}>{r.counterparty?.display_name || r.id}</option>
                                          ))}
                                        </select>
                                      </div>
                                    )}

                                    <div className="g2tight" style={{ marginBottom: 4 }}>
                                      <div className="field2">
                                        <div className="lbl" style={{ fontSize: 9 }}>{t('allocPartnerSharePct')}</div>
                                        <div className="inputBox" style={{ padding: '3px 6px' }}>
                                          <input
                                            type="number" min="0" max="100" placeholder="50"
                                            value={alloc.partnerSharePct || ''}
                                            onChange={e => {
                                              const pct = Number(e.target.value) || 0;
                                              setAllocations(prev => prev.map((a, i) => i === idx ? { ...a, partnerSharePct: pct, merchantSharePct: 100 - pct } : a));
                                            }}
                                            style={{ fontSize: 10 }}
                                          />
                                        </div>
                                      </div>
                                      <div className="field2">
                                        <div className="lbl" style={{ fontSize: 9 }}>{t('allocYourSharePct')}</div>
                                        <div className="inputBox" style={{ padding: '3px 6px' }}>
                                          <input type="number" disabled value={100 - (alloc.partnerSharePct || 0)} style={{ fontSize: 10, opacity: 0.6 }} />
                                        </div>
                                      </div>
                                    </div>

                                    <div className="g2tight" style={{ marginTop: 4 }}>
                                      <div className="field2">
                                        <div className="lbl" style={{ fontSize: 9 }}>USDT {t('quantity')}</div>
                                        <div className="inputBox" style={{ padding: '3px 6px' }}>
                                          <input
                                            type="text" placeholder="0"
                                            value={alloc.allocatedUsdt}
                                            onChange={e => {
                                              if (e.target.value === '' || /^-?\d*\.?\d*$/.test(e.target.value))
                                                setAllocations(prev => prev.map((a, i) => i === idx ? { ...a, allocatedUsdt: e.target.value } : a));
                                            }}
                                            style={{ fontSize: 10 }}
                                          />
                                        </div>
                                      </div>
                                      <div className="field2">
                                        <div className="lbl" style={{ fontSize: 9 }}>{t('costBasisQar')}</div>
                                        <div className="inputBox" style={{ padding: '3px 6px' }}>
                                          <input
                                            type="text" placeholder="3.65"
                                            value={alloc.merchantCostPerUsdt}
                                            onChange={e => {
                                              if (e.target.value === '' || /^-?\d*\.?\d*$/.test(e.target.value))
                                                setAllocations(prev => prev.map((a, i) => i === idx ? { ...a, merchantCostPerUsdt: e.target.value } : a));
                                            }}
                                            style={{ fontSize: 10 }}
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    <div className="field2" style={{ marginTop: 4 }}>
                                      <div className="lbl" style={{ fontSize: 9 }}>{t('noteOptional')}</div>
                                      <div className="inputBox" style={{ padding: '3px 6px' }}>
                                        <input
                                          value={alloc.note}
                                          onChange={e => setAllocations(prev => prev.map((a, i) => i === idx ? { ...a, note: e.target.value } : a))}
                                          placeholder={t('optionalNotePlaceholder')}
                                          style={{ fontSize: 10 }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ))}

                                {/* Add more merchants button */}
                                {allocations.length > 1 && (
                                  <button type="button" className="btn secondary" style={{ fontSize: 9, padding: '4px 10px', width: '100%', marginBottom: 4 }}
                                    onClick={() => setAllocations(prev => [...prev, {
                                      id: `alloc_${Date.now()}`,
                                      relationshipId: '',
                                      merchantName: '',
                                      merchantId: '',
                                      family: 'sales_deal',
                                      agreementId: null,
                                      agreementLabel: '',
                                      allocatedUsdt: '',
                                      merchantCostPerUsdt: '',
                                      partnerSharePct: 0,
                                      merchantSharePct: 0,
                                      note: '',
                                    }])}>
                                    {t('addAnotherMerchant')}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* ─── Capital Transfer ─── */}
                            {isCapitalTransfer && (
                              <div style={{ marginTop: 8 }}>
                                {(() => {
                                  const myName = merchantProfile?.display_name || t('you') || 'You';
                                  return (
                                    <div className="field2" style={{ marginBottom: 6 }}>
                                      <div className="lbl">{t('direction')}</div>
                                      <select
                                        value={transferDirection}
                                        onChange={e => setTransferDirection(e.target.value as any)}
                                        style={{ width: '100%', padding: isMobile ? '9px 10px' : '4px 6px', fontSize: isMobile ? 13 : 11, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)', minHeight: isMobile ? 44 : undefined }}
                                      >
                                        <option value="lender_to_operator">💸 {cpName} → {myName}</option>
                                        <option value="operator_to_lender">↩️ {myName} → {cpName}</option>
                                      </select>
                                    </div>
                                  );
                                })()}
                                <div className="field2">
                                  <div className="lbl">USDT {t('amount')}</div>
                                  <div className="inputBox">
                                    <input type="number" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder="0" style={mobileInputStyle} />
                                  </div>
                                </div>
                                <div className="field2" style={{ marginTop: 6 }}>
                                  <div className="lbl">{t('noteOptional')}</div>
                                  <div className="inputBox">
                                    <input value={transferNote} onChange={e => setTransferNote(e.target.value)} placeholder={t('noteOptional')} style={mobileInputStyle} />
                                  </div>
                                </div>
                                <button className="btn" style={{ marginTop: 8, width: '100%', minHeight: isMobile ? 44 : undefined, fontSize: isMobile ? 13 : undefined }} onClick={handleCapitalTransfer} disabled={submitCapitalTransfer.isPending}>
                                  💸 {t('submitTransfer')}
                                </button>
                              </div>
                            )}

                            {/* ─── Live Preview for PS/SD ─── */}
                            {(selectedTemplateId === 'profit_share_family' || selectedTemplateId === 'sales_deal_family') && allocations.length > 0 && salePreview && (() => {
                              const alloc = allocations[0];
                              const usdt = parseFloat(alloc.allocatedUsdt) || 0;
                              const costPerUsdt = parseFloat(alloc.merchantCostPerUsdt) || (salePreview?.avgBuy ?? 0);
                              const sellP = Number(saleSell) || 0;
                              const totalFee = parseFloat(saleFee) || 0;

                              if (!(usdt > 0) || !(sellP > 0)) return null;

                              const calc = calculateAllocationEconomics({
                                allocatedUsdt: usdt,
                                merchantCostPerUsdt: costPerUsdt,
                                sellPrice: sellP,
                                totalFee,
                                totalUsdt: salePreview.qty,
                                family: alloc.family,
                                partnerSharePct: alloc.partnerSharePct,
                              });

                              return (
                                <div style={{
                                  padding: '8px 10px', borderRadius: 6, marginTop: 8,
                                  background: 'color-mix(in srgb, var(--brand) 8%, transparent)',
                                  border: '1px solid color-mix(in srgb, var(--good) 30%, transparent)',
                                }}>
                                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--brand)', marginBottom: 4 }}>
                                    {t('allocSummary')}
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                                    <span className="muted">{t('allocRev')}:</span>
                                    <strong className="mono">{fmtQ(calc.revenue)}</strong>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                                    <span className="muted">{t('allocNet')}:</span>
                                    <strong className="mono" style={{ color: calc.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>{calc.net >= 0 ? '+' : ''}{fmtQ(calc.net)}</strong>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                                    <span className="muted" style={{ color: 'var(--good)' }}>📊 {t('youShare')} ({alloc.merchantSharePct}%):</span>
                                    <strong className="mono" style={{ color: 'var(--good)' }}>{fmtQ(calc.merchantAmount)}</strong>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                                    <span className="muted" style={{ color: 'var(--bad)' }}>🛡️ {cpName} ({alloc.partnerSharePct}%):</span>
                                    <strong className="mono" style={{ color: 'var(--bad)' }}>{fmtQ(calc.partnerAmount)}</strong>
                                  </div>
                                </div>
                              );
                            })()}
                          </>
                        );
                      })()}
                    </>
                  )}
                </div>

                {/* The sections below are hidden when Capital Transfer is selected */}
                {!isCapitalTransfer && (<>

                {/* Settle immediately option (Sales Deal + per_order cadence only) */}
                {merchantOrderEnabled && (() => {
                  const tmpl = AGREEMENT_TEMPLATES.find(t => t.id === selectedTemplateId);
                  if (!tmpl || tmpl.family !== 'sales_deal') return null;
                  return (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 10, color: 'var(--muted)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={settleImmediately}
                        onChange={e => setSettleImmediately(e.target.checked)}
                        style={{ accentColor: 'var(--brand)' }}
                      />
                      {t('settleThisTradeNow')}
                    </label>
                  );
                })()}

                {/* Allocation Preview - enhanced with icons when partner linked */}
                {allocationPreview && (
                  <div style={{ background: 'color-mix(in srgb, var(--brand) 8%, transparent)', borderRadius: 4, padding: '6px 8px', marginTop: 4 }}>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--brand)', marginBottom: 3 }}>{t('estimatedAllocation')}</div>
                    <div className="prev-row"><span className="muted">{t('estSaleAmount')}</span><strong style={{ fontSize: 10 }}>{fmtQ(allocationPreview.revenue)}</strong></div>
                    {allocationPreview.fifoCost != null && <div className="prev-row"><span className="muted">{t('estFifoCost')}</span><strong style={{ fontSize: 10 }}>{fmtQ(allocationPreview.fifoCost)}</strong></div>}
                    {allocationPreview.baseLabel === 'net_profit' && (
                      <div className="prev-row"><span className="muted">{t('estNetProfit')}</span><strong style={{ fontSize: 10, color: allocationPreview.base >= 0 ? 'var(--good)' : 'var(--bad)' }}>{allocationPreview.base >= 0 ? '+' : ''}{fmtQ(allocationPreview.base)}</strong></div>
                    )}
                    {/* Iconic profit split summary */}
                    <div style={{ borderTop: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)', paddingTop: 5, marginTop: 4 }}>
                      <div className="prev-row"><span style={{ fontWeight: 700, color: 'var(--good)', fontSize: 10 }}>📊 {t('merchantNetProfit')}</span><strong style={{ color: 'var(--good)', fontSize: 11 }}>{fmtQ(allocationPreview.merchantAmount)}</strong></div>
                      <div className="prev-row"><span style={{ fontWeight: 700, color: 'var(--bad)', fontSize: 10 }}>🛡️ {t('partnerNetProfit')} ({allocationPreview.counterpartyName})</span><strong style={{ color: 'var(--bad)', fontSize: 11 }}>{fmtQ(allocationPreview.partnerAmount)}</strong></div>
                    </div>
                    <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 3 }}>{t('tradeWillBeSentForApproval')}</div>
                  </div>
                )}

                {/* Live Preview */}
                {(
                <div className="previewBox" style={isMobile ? { padding: 12 } : undefined}>
                  <div className="pt">{t('livePreview')}</div>
                  {!salePreview ? <div className="muted" style={{ fontSize: 11 }}>{t('enterDetails')}</div> : (
                    <>
                      {Number.isFinite(salePreview.avgBuy) && <div className="prev-row"><span className="muted">{t('avgBuy')}</span><strong style={{ color: 'var(--bad)' }}>{fmtP(salePreview.avgBuy)} QAR</strong></div>}
                      <div className="prev-row"><span className="muted">{t('qty')}</span><strong>{fmtU(salePreview.qty)} USDT</strong></div>
                      <div className="prev-row"><span className="muted">{t('revenue')}</span><strong>{fmtQ(salePreview.revenue)}</strong></div>
                      <div className="prev-row"><span className="muted">{t('costFifo')}</span><strong>{Number.isFinite(salePreview.cost) ? fmtQ(salePreview.cost) : '—'}</strong></div>
                      <div className="prev-row" style={{ borderTop: '1px solid color-mix(in srgb,var(--brand) 20%,transparent)', paddingTop: 5 }}>
                        <span className="muted">{t('net')}</span>
                        <strong style={{ color: Number.isFinite(salePreview.net) ? (salePreview.net >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)' }}>
                          {Number.isFinite(salePreview.net) ? `${salePreview.net >= 0 ? '+' : ''}${fmtQ(salePreview.net)}` : '—'}
                        </strong>
                      </div>
                    </>
                  )}
                </div>
                )}

                {/* Cash Deposit Option */}
                {salePreview && salePreview.revenue > 0 && (
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'color-mix(in srgb, var(--good) 6%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--good) 20%, transparent)',
                    marginBottom: 6,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--good)', marginBottom: 6 }}>{t('addSaleProceedsToCash')}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(['none', 'full', 'partial'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => {
                            setCashDepositMode(mode);
                            if (mode === 'full') setCashDepositAmount(String(Math.round(salePreview.revenue * 100) / 100));
                            if (mode === 'none') { setCashDepositAmount(''); setCashDepositAccountId(''); }
                            if (mode !== 'none' && !cashDepositAccountId) {
                              const first = state.cashAccounts?.find(a => a.status === 'active');
                              if (first) setCashDepositAccountId(first.id);
                            }
                          }}
                          style={{
                            padding: isMobile ? '8px 10px' : '4px 10px',
                            borderRadius: 6,
                            fontSize: isMobile ? 11 : 10,
                            fontWeight: 600,
                            cursor: 'pointer',
                            minHeight: isMobile ? 40 : undefined,
                            border: cashDepositMode === mode
                              ? '1.5px solid var(--good)'
                              : '1px solid var(--line)',
                            background: cashDepositMode === mode
                              ? 'color-mix(in srgb, var(--good) 15%, transparent)'
                              : 'var(--panel2)',
                            color: cashDepositMode === mode ? 'var(--good)' : 'var(--t2)',
                          }}
                        >
                          {mode === 'none' ? t('dontAdd') : mode === 'full' ? `${t('fullAmount')} (${fmtQ(salePreview.revenue)})` : t('customAmount')}
                        </button>
                      ))}
                    </div>
                    {cashDepositMode === 'partial' && (
                      <div style={{ marginTop: 6 }}>
                        <div className="inputBox" style={{ maxWidth: isMobile ? '100%' : 180 }}>
                          <input
                            inputMode="decimal"
                            placeholder={t('amountInQar')}
                            value={cashDepositAmount}
                            onChange={numericOnly(setCashDepositAmount)}
                            style={mobileInputStyle}
                          />
                        </div>
                        {parseFloat(cashDepositAmount) > salePreview.revenue && (
                          <div style={{ fontSize: 9, color: 'var(--warn)', marginTop: 2 }}>{t('amountExceedsSaleRevenue')}</div>
                        )}
                      </div>
                    )}
                    {cashDepositMode !== 'none' && (state.cashAccounts?.filter(a => a.status === 'active').length ?? 0) > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t2)', marginBottom: 4 }}>{t('depositTo')}</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {state.cashAccounts!.filter(a => a.status === 'active').map(acc => {
                            const isSelected = cashDepositAccountId === acc.id;
                            const typeIcon = acc.type === 'hand' ? '💵' : acc.type === 'bank' ? '🏦' : '🔐';
                            const bal = (state.cashLedger || [])
                              .filter(e => e.accountId === acc.id)
                              .reduce((s, e) => s + (e.direction === 'in' ? e.amount : -e.amount), 0);
                            return (
                              <button
                                key={acc.id}
                                onClick={() => setCashDepositAccountId(acc.id)}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: 8,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  border: isSelected ? '1.5px solid var(--good)' : '1px solid var(--line)',
                                  background: isSelected ? 'color-mix(in srgb, var(--good) 12%, transparent)' : 'var(--panel2)',
                                  color: isSelected ? 'var(--good)' : 'var(--t2)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'flex-start',
                                  gap: 2,
                                  minWidth: 90,
                                }}
                              >
                                <span style={isMobile ? { fontSize: 11 } : undefined}>{typeIcon} {acc.name}</span>
                                <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted)' }}>{fmtQ(bal)}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {cashDepositMode !== 'none' && (
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>
                        {(() => {
                          const selectedAcc = state.cashAccounts?.find(a => a.id === cashDepositAccountId);
                          if (selectedAcc) {
                            const bal = (state.cashLedger || [])
                              .filter(e => e.accountId === selectedAcc.id)
                              .reduce((s, e) => s + (e.direction === 'in' ? e.amount : -e.amount), 0);
                            const deposit = parseFloat(cashDepositAmount) || 0;
                            return `${selectedAcc.name}: ${fmtQ(bal)} → ${fmtQ(bal + deposit)}`;
                          }
                          return `${t('cashBalanceLbl')}: ${fmtQ(state.cashQAR || 0)} → ${fmtQ((state.cashQAR || 0) + (parseFloat(cashDepositAmount) || 0))} QAR`;
                        })()}
                      </div>
                    )}
                  </div>
                )}

                <div
                  className="formActions"
                  style={isMobile ? { position: 'sticky', bottom: 0, background: 'var(--panel)', paddingTop: 8, paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))', zIndex: 20 } : undefined}
                >
                  <button className="btn" onClick={addTrade} style={isMobile ? { width: '100%', minHeight: 40, fontSize: 12 } : undefined}>
                    {merchantOrderEnabled ? t('sendForApproval') : t('addTrade')}
                  </button>
                </div>
                <div className={`msg ${saleMessage.includes(t('fixFields')) ? 'bad' : ''}`}>{saleMessage}</div>

                </>)}
              </div>
            </div>
          )}

          {/* ── INCOMING: Partner trade details ── */}
          {activeTab === 'incoming' && (
            <div className="formPanel salePanel">
              <div className="hdr">📥 {t('approvalInbox')}</div>
              <div className="inner">
                {subFilteredInDeals.length === 0 ? (
                  <div className="muted" style={{ fontSize: 11, textAlign: 'center', padding: 20 }}>{t('noIncomingTrades')}</div>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                    <p>{t('incomingTradesHelp')}</p>
                    <div style={{ marginTop: 12 }}>
                      {filteredIncomingMerchantDeals.filter(d => d.status === 'pending').map(deal => {
                        const cfg = DEAL_TYPE_CONFIGS[deal.deal_type];
                        const rel = relationships.find(r => r.id === deal.relationship_id);
                        const { partnerPct } = getDealShares(deal);
                        return (
                          <div key={deal.id} className="previewBox" style={{ marginBottom: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontWeight: 600, fontSize: 11 }}>{cfg?.icon} {deal.title}</span>
                                <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                                  {rel?.counterparty?.display_name || '—'} · {partnerPct != null ? `${partnerPct}%/${100 - partnerPct}%` : '—'}
                                </div>
                              </div>
                              <div className="mono" style={{ fontWeight: 700, fontSize: 12 }}>{fmtTotal(deal.amount)} {deal.currency}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                              <button className="btn" style={{ fontSize: 10, padding: '4px 12px' }} onClick={() => approveIncomingDeal(deal.id)}>{t('approve')}</button>
                              <button className="btn secondary" style={{ fontSize: 10, padding: '4px 12px', color: 'var(--bad)' }} onClick={() => rejectIncomingDeal(deal.id)}>{t('reject')}</button>
                            </div>
                          </div>
                        );
                      })}
                      {filteredIncomingMerchantDeals.filter(d => d.status === 'pending').length === 0 && (
                        <div style={{ textAlign: 'center', padding: 12, color: 'var(--muted)' }}>{t('noPendingApprovals')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── OUTGOING: Summary ── */}
          {activeTab === 'outgoing' && (
            <div className="formPanel salePanel">
              <div className="hdr">📤 {t('outgoingTradesSummary')}</div>
              <div className="inner">
                <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 12 }}>
                  <p>{t('outgoingTradesHelp')}</p>
                </div>
                {filteredOutgoingMerchantDeals.filter(d => d.status === 'pending').length > 0 && (
                  <div className="previewBox" style={{ borderColor: 'var(--warn)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn)', marginBottom: 4 }}>⏳ {t('pendingApprovalCount').replace('{n}', String(filteredOutgoingMerchantDeals.filter(d => d.status === 'pending').length))}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('awaitingPartnerApproval')}</div>
                  </div>
                )}
                {filteredOutgoingMerchantDeals.filter(d => d.status === 'approved').length > 0 && (
                  <div className="previewBox" style={{ borderColor: 'var(--good)', marginTop: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--good)', marginBottom: 4 }}>✅ {filteredOutgoingMerchantDeals.filter(d => d.status === 'approved').length} {t('approvedTrades')}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('permanentSharedRecords')}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── USDT TRANSFERS PANEL: New Transfer Form ── */}
          {activeTab === 'transfers' && (
            <div className="formPanel salePanel">
              <div className="hdr">💸 {t('submitTransfer')}</div>
              <div className="inner" style={isMobile ? { paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))' } : undefined}>
                
                <div className="previewBox" style={{ marginTop: 6, borderColor: 'var(--brand)', background: 'color-mix(in srgb, var(--brand) 4%, transparent)' }}>
                  <div className="pt" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    🧡 {t('linkToPartner')}
                    <span style={{ fontSize: 9, color: 'var(--muted)' }}>{t('optional')}</span>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', fontSize: 11, fontWeight: 600, color: 'var(--brand)', cursor: 'default' }}>
                    <input
                      type="checkbox"
                      checked={true}
                      readOnly
                      style={{ accentColor: 'var(--brand)', width: 14, height: 14 }}
                    />
                    {t('isThisSaleLinked')}
                  </label>

                  <div className="field2" style={{ marginBottom: 10 }}>
                    <div className="lbl" style={{ color: 'var(--brand)', fontWeight: 700 }}>{t('selectPartner')} <span style={{ color: 'var(--bad)' }}>*</span></div>
                    <select
                      value={linkedRelId}
                      onChange={e => setLinkedRelId(e.target.value)}
                      style={{ width: '100%', padding: isMobile ? '10px 12px' : '6px 10px', fontSize: isMobile ? 14 : 12, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)', minHeight: isMobile ? 44 : undefined }}
                    >
                      <option value="">{t('noneSelected')}</option>
                      {relationships.map(r => (
                        <option key={r.id} value={r.id}>{r.counterparty?.display_name || r.id}</option>
                      ))}
                    </select>
                  </div>

                  <div className="field2" style={{ marginBottom: 12 }}>
                    <div className="lbl" style={{ color: 'var(--brand)', fontWeight: 700 }}>{t('agreementType')} <span style={{ color: 'var(--bad)' }}>*</span></div>
                    <div style={{ position: 'relative' }}>
                      <select
                        value="capital_transfer"
                        disabled
                        style={{ width: '100%', padding: isMobile ? '10px 12px' : '6px 10px', fontSize: isMobile ? 14 : 12, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--t1)', minHeight: isMobile ? 44 : undefined, appearance: 'none' }}
                      >
                        <option value="capital_transfer">💸 {t('capitalTransfer')} (0/0)</option>
                      </select>
                      <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--muted)' }}>🔒</div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid color-mix(in srgb, var(--brand) 20%, transparent)', paddingTop: 12, marginTop: 4 }}>
                    {(() => {
                      const rel = relationships.find(r => r.id === linkedRelId);
                      const cpName = rel?.counterparty?.display_name || t('partner');
                      const myName = merchantProfile?.display_name || t('you') || 'You';
                      return (
                        <div className="field2" style={{ marginBottom: 8 }}>
                          <div className="lbl" style={{ fontWeight: 700, color: 'var(--brand)' }}>{t('direction')}</div>
                          <select
                            value={transferDirection}
                            onChange={e => setTransferDirection(e.target.value as any)}
                            style={{ width: '100%', padding: isMobile ? '9px 10px' : '6px 10px', fontSize: isMobile ? 13 : 11, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)', minHeight: isMobile ? 44 : undefined }}
                          >
                            <option value="lender_to_operator">💸 {cpName} → {myName}</option>
                            <option value="operator_to_lender">↩️ {myName} → {cpName}</option>
                          </select>
                        </div>
                      );
                    })()}
                    
                    <div className="field2" style={{ marginBottom: 8 }}>
                      <div className="lbl" style={{ fontWeight: 700, color: 'var(--brand)' }}>USDT {t('amount')}</div>
                      <div className="inputBox">
                        <input
                          type="number"
                          value={transferAmount}
                          onChange={e => setTransferAmount(e.target.value)}
                          placeholder="0"
                          style={mobileInputStyle}
                        />
                      </div>
                    </div>

                    <div className="field2" style={{ marginBottom: 12 }}>
                      <div className="lbl" style={{ fontWeight: 700, color: 'var(--brand)' }}>{t('noteOptional')}</div>
                      <div className="inputBox">
                        <input
                          value={transferNote}
                          onChange={e => setTransferNote(e.target.value)}
                          placeholder={t('noteOptional')}
                          style={mobileInputStyle}
                        />
                      </div>
                    </div>

                    <div className="formActions" style={{ marginTop: 16 }}>
                      <button
                        className="btn"
                        style={{ width: '100%', background: 'var(--brand)', color: '#000', fontWeight: 800, minHeight: isMobile ? 48 : 40, fontSize: isMobile ? 14 : 12 }}
                        onClick={handleCapitalTransfer}
                        disabled={submitCapitalTransfer.isPending}
                      >
                        💸 {t('submitTransfer')}
                      </button>
                    </div>
                    {submitCapitalTransfer.isPending && <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>{t('saving')}</div>}
                  </div>
                </div>
                
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ─── EDIT TRADE DIALOG ─── */}
      {(() => {
        const editingTrade = editingTradeId ? state.trades.find(x => x.id === editingTradeId) : null;
        const editCalc = editingTradeId ? derived.tradeCalc.get(editingTradeId) : null;
        const currentVolume = editingTrade ? editingTrade.amountUSDT * editingTrade.sellPriceQAR : 0;
        const currentNet = editCalc?.ok ? editCalc.netQAR : null;
        const isApproved = editingTrade?.approvalStatus === 'approved';
        return (
          <Dialog open={!!editingTradeId} onOpenChange={open => !open && setEditingTradeId(null)}>
            <DialogContent className="tracker-root" style={{ maxWidth: 500, background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--good) 25%, var(--line))', borderRadius: 12, padding: 24, gap: 0, ...mobileDialogContentStyle }}>
              <DialogHeader style={{ marginBottom: 14 }}>
                <DialogTitle style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('correctTradeTitle')}</DialogTitle>
              </DialogHeader>

              {isApproved && (
                <div style={{ background: 'color-mix(in srgb, var(--bad) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 28%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--bad)', marginBottom: 14, lineHeight: 1.5 }}>
                  {t('cannotEditApprovedTrade')}
                </div>
              )}

              {!isApproved && (
                <div style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--warn)', marginBottom: 14, lineHeight: 1.5 }}>
                  {t('editInPlaceWarning')}
                </div>
              )}

              {editingTrade && (
                <div style={{ background: 'color-mix(in srgb, var(--good) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 25%, transparent)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                  <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.7px', textTransform: 'uppercase', color: 'var(--good)', marginBottom: 8 }}>{t('currentStatsLabel')}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                     <span style={{ fontSize: 12, color: 'var(--text)' }}>{t('volumeLabel')}</span>
                    <strong style={{ fontFamily: 'var(--lt-font-mono)', fontSize: 13, color: 'var(--text)' }}>{fmtQ(currentVolume)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span style={{ fontSize: 12, color: 'var(--text)' }}>{t('netLabel')}</span>
                    <strong style={{ fontFamily: 'var(--lt-font-mono)', fontSize: 13, color: currentNet != null ? (currentNet >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)' }}>
                      {currentNet != null ? `${currentNet >= 0 ? '+' : ''}${fmtQ(currentNet)}` : '—'}
                    </strong>
                  </div>
                </div>
              )}

              <div className="field2" style={{ marginBottom: 10 }}>
                <div className="lbl">{t('dateTime')}</div>
                <div className="inputBox"><input type="datetime-local" value={editDate} onChange={e => setEditDate(e.target.value)} disabled={isApproved} style={mobileInputStyle} /></div>
              </div>

              <div className="field2" style={{ marginBottom: 10 }}>
                <div className="lbl">{t('buyerLabel')}</div>
                <select value={editCustomerId} onChange={e => setEditCustomerId(e.target.value)} disabled={isApproved}
                  style={{ width: '100%', padding: '8px 32px 8px 10px', fontSize: isMobile ? 14 : 12, minHeight: isMobile ? 44 : undefined, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', appearance: 'none', cursor: 'pointer', outline: 'none' }}
                >
                  <option value="">{t('noCustomerSelected')}</option>
                  {state.customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>
                  ))}
                </select>
              </div>

              <div className="g2tight" style={{ marginBottom: 10 }}>
                <div className="field2">
                  <div className="lbl">{t('qtyUsdt')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editQty} onChange={numericOnly(setEditQty)} disabled={isApproved} style={mobileInputStyle} /></div>
                </div>
                <div className="field2">
                  <div className="lbl">{t('sellPriceQar')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editSell} onChange={numericOnly(setEditSell)} disabled={isApproved} style={mobileInputStyle} /></div>
                </div>
              </div>

              <div className="g2tight" style={{ marginBottom: 10 }}>
                <div className="field2">
                  <div className="lbl">{t('feeQarLabel')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editFee} onChange={numericOnly(setEditFee)} disabled={isApproved} style={mobileInputStyle} /></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6, gap: 10 }}>
                  <input type="checkbox" id="editUsesStockChk" checked={editUsesStock} onChange={e => setEditUsesStock(e.target.checked)} disabled={isApproved} style={{ accentColor: 'var(--good)', width: 15, height: 15, cursor: 'pointer', flexShrink: 0, marginBottom: 2 }} />
                  <label htmlFor="editUsesStockChk" style={{ cursor: 'pointer', lineHeight: 1.3 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{t('useFifoStock')}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>{t('deductFromInventory')}</div>
                  </label>
                </div>
              </div>

              <div className="field2" style={{ marginBottom: 16 }}>
                <div className="lbl">{t('note')}</div>
                <div className="inputBox" style={{ padding: 0 }}>
                  <textarea
                    value={editNote}
                    onChange={e => setEditNote(e.target.value)}
                    rows={2}
                    disabled={isApproved}
                    style={{ width: '100%', padding: '7px 10px', resize: 'none', background: 'transparent', border: 'none', color: 'var(--text)', fontSize: isMobile ? 14 : 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Already linked indicator */}
              {editingTrade && (editingTrade.agreementFamily || editingTrade.linkedDealId) && (
                <div style={{
                  marginBottom: 16, padding: '8px 12px', borderRadius: 8,
                  background: 'color-mix(in srgb, var(--brand) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--brand) 25%, transparent)',
                  fontSize: 10, color: 'var(--brand)',
                }}>
                  🤝 {t('alreadyLinkedToPartner')}
                  {editingTrade.agreementFamily && (
                    <span style={{ marginLeft: 8 }}>
                      ({editingTrade.agreementFamily === 'profit_share' ? t('profitShareLabel') : t('salesDealLabel')}
                      {editingTrade.partnerPct != null ? ` · ${editingTrade.partnerPct}/${editingTrade.merchantPct}` : ''})
                    </span>
                  )}
                </div>
              )}

              {/* Link to Partner — only for self orders, not approved */}
              {editingTrade && !editingTrade.agreementFamily && !editingTrade.linkedDealId && !editingTrade.linkedRelId && !isApproved && (
                <div style={{
                  marginBottom: 16, padding: 10, borderRadius: 8,
                  border: editLinkEnabled ? '1px solid var(--brand)' : '1px solid var(--line)',
                  background: editLinkEnabled ? 'color-mix(in srgb, var(--brand) 4%, transparent)' : 'transparent',
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, cursor: 'pointer', color: 'var(--muted)', marginBottom: editLinkEnabled ? 10 : 0 }}>
                    <input
                      type="checkbox"
                      checked={editLinkEnabled}
                      onChange={e => {
                        setEditLinkEnabled(e.target.checked);
                        if (!e.target.checked) {
                          setEditLinkedRelId('');
                          setEditSelectedTemplateId(null);
                          setEditSettleImmediately(false);
                        }
                      }}
                      style={{ accentColor: 'var(--brand)' }}
                    />
                    🤝 {t('linkExistingOrderToPartner')}
                  </label>

                  {editLinkEnabled && (
                    <>
                      {/* Step 1: Select partner */}
                      <div className="field2" style={{ marginBottom: 6 }}>
                        <div className="lbl">{t('selectPartner')}</div>
                        <select
                          value={editLinkedRelId}
                          onChange={e => { setEditLinkedRelId(e.target.value); setEditSelectedTemplateId(null); }}
                          style={{ width: '100%', padding: '4px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                        >
                          <option value="">{t('noneSelected')}</option>
                          {relationships.map(r => (
                            <option key={r.id} value={r.id}>{r.counterparty?.display_name || r.id}</option>
                          ))}
                        </select>
                      </div>

                      {/* Step 2: Select order type */}
                      {editLinkedRelId && (
                        <div style={{ marginTop: 4 }}>
                          <div className="lbl" style={{ marginBottom: 4 }}>{t('agreementType')} <span style={{ color: 'var(--bad)', fontWeight: 700 }}>*</span></div>
                          <select
                            value={editSelectedTemplateId || ''}
                            onChange={e => setEditSelectedTemplateId(e.target.value || null)}
                            style={{ width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                          >
                            <option value="">{t('selectAgreementType')}</option>
                            {AGREEMENT_TEMPLATES.filter(tmpl => tmpl.family !== 'capital_transfer').map(tmpl => (
                              <option key={tmpl.id} value={tmpl.id}>
                                {tmpl.icon} {tmpl.label[t.lang as 'en' | 'ar']} ({tmpl.ratioDisplay})
                              </option>
                            ))}
                          </select>

                          {/* Template details + allocation preview */}
                          {editSelectedTemplateId && (() => {
                            const tmpl = AGREEMENT_TEMPLATES.find(tmpl => tmpl.id === editSelectedTemplateId);
                            if (!tmpl) return null;
                            const accentVar = tmpl.accent === 'brand' ? 'var(--brand)' : 'var(--good)';
                            const qty = Number(editQty) || 0;
                            const sell = Number(editSell) || 0;
                            const rev = qty * sell;
                            const editCalcPreview = derived.tradeCalc.get(editingTradeId!);
                            const fifoCost = editCalcPreview?.ok ? editCalcPreview.slices.reduce((s, x) => s + x.cost, 0) : 0;
                            const netProfit = rev - fifoCost - (Number(editFee) || 0);
                            const partnerPct = tmpl.defaults.counterparty_share_pct ?? tmpl.defaults.partner_ratio ?? 0;
                            const base = tmpl.family === 'profit_share' ? netProfit : rev;
                            const partnerAmt = base * (partnerPct / 100);
                            const merchantAmt = base - partnerAmt;
                            return (
                              <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 6, background: `color-mix(in srgb, ${accentVar} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${accentVar} 30%, transparent)` }}>
                                <div style={{ fontSize: 10, color: accentVar, fontWeight: 600, marginBottom: 3 }}>
                                  {getTemplateRatioLabel(tmpl, t.lang as 'en' | 'ar')}
                                </div>
                                <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.4 }}>{tmpl.helperText[t.lang as 'en' | 'ar']}</div>
                                {rev > 0 && (
                                  <div style={{ marginTop: 6, fontSize: 10 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span className="muted">{t('partnerShare')}:</span>
                                      <span className="mono" style={{ fontWeight: 700 }}>{fmtQ(partnerAmt)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span className="muted">{t('merchantShareDist')}:</span>
                                      <span className="mono" style={{ fontWeight: 700 }}>{fmtQ(merchantAmt)}</span>
                                    </div>
                                  </div>
                                )}
                                <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>
                                  {t('tradeWillBeSentForApproval')}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Settle immediately (Sales Deal only) */}
                          {editSelectedTemplateId && (() => {
                            const tmpl = AGREEMENT_TEMPLATES.find(tmpl => tmpl.id === editSelectedTemplateId);
                            if (!tmpl || tmpl.family !== 'sales_deal') return null;
                            return (
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 10, color: 'var(--muted)', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={editSettleImmediately}
                                  onChange={e => setEditSettleImmediately(e.target.checked)}
                                  style={{ accentColor: 'var(--brand)' }}
                                />
                                {t('settleThisTradeNow')}
                              </label>
                            );
                          })()}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <DialogFooter style={{ gap: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', ...mobileDialogFooterStyle }}>
                {!isApproved && (
                  <button
                    onClick={deleteTrade}
                    style={{ padding: '7px 12px', borderRadius: 6, background: 'color-mix(in srgb, var(--bad) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)', color: 'var(--bad)', fontWeight: 600, fontSize: 11, cursor: 'pointer', minHeight: isMobile ? 42 : undefined, width: isMobile ? '100%' : undefined }}
                  >
                    {t('delete')}
                  </button>
                )}
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', width: isMobile ? '100%' : undefined }}>
                  <button className="btn secondary" style={{ minWidth: 80, minHeight: isMobile ? 42 : undefined, width: isMobile ? '100%' : undefined }} onClick={() => setEditingTradeId(null)}>{t('cancel')}</button>
                  {!isApproved && (
                    <button
                      onClick={saveTradeEdit}
                      style={{ minWidth: 130, padding: '9px 18px', borderRadius: 6, background: 'var(--good)', color: '#000', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer', minHeight: isMobile ? 42 : undefined, width: isMobile ? '100%' : undefined }}
                    >
                      {t('saveCorrection')}
                    </button>
                  )}
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ─── CANCELLATION REQUEST DIALOG ─── */}
      <Dialog open={!!cancelTradeId} onOpenChange={open => !open && setCancelTradeId(null)}>
        <DialogContent className="tracker-root" style={{ maxWidth: 420, background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--warn) 25%, var(--line))', borderRadius: 12, padding: 24, gap: 0, ...mobileDialogContentStyle }}>
          <DialogHeader style={{ marginBottom: 14 }}>
            <DialogTitle style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('requestCancellationTitle')}</DialogTitle>
          </DialogHeader>
          <div style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--warn)', marginBottom: 14, lineHeight: 1.5 }}>
            {t('cancellationRequestExplainer')}
          </div>
          <DialogFooter style={{ gap: 8, flexDirection: 'row', justifyContent: 'flex-end', ...mobileDialogFooterStyle }}>
            <button className="btn secondary" onClick={() => setCancelTradeId(null)} style={isMobile ? { minHeight: 42, width: '100%' } : undefined}>{t('cancel')}</button>
            <button
              onClick={submitCancellationRequest}
              style={{ padding: '9px 18px', borderRadius: 6, background: 'var(--warn)', color: '#000', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer', minHeight: isMobile ? 42 : undefined, width: isMobile ? '100%' : undefined }}
            >
              {t('submitCancellationRequest')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MERCHANT DEAL EDIT DIALOG ─── */}
      {(() => {
        const editingDeal = editingDealId ? allMerchantDeals.find(d => d.id === editingDealId) : null;
        if (!editingDeal) return null;
        const dealVol = Number(editDealQty) * Number(editDealSell);
        const dealCost = Number(parseDealMeta(editingDeal.notes).fifo_cost) || 0;
        const dealNet = dealVol - dealCost - Number(editDealFee);
        return (
          <Dialog open={!!editingDealId} onOpenChange={open => !open && setEditingDealId(null)}>
            <DialogContent className="tracker-root" style={{ maxWidth: 500, background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--good) 25%, var(--line))', borderRadius: 12, padding: 24, gap: 0, ...mobileDialogContentStyle }}>
              <DialogHeader style={{ marginBottom: 14 }}>
                <DialogTitle style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('correctTradeTitle')}</DialogTitle>
              </DialogHeader>

              <div style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--warn)', marginBottom: 14, lineHeight: 1.5 }}>
                {t('editInPlaceWarning')}
              </div>

              <div style={{ background: 'color-mix(in srgb, var(--good) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 25%, transparent)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.7px', textTransform: 'uppercase', color: 'var(--good)', marginBottom: 8 }}>{t('currentStatsLabel')}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: 'var(--text)' }}>{t('volumeLabel')}</span>
                  <strong style={{ fontFamily: 'var(--lt-font-mono)', fontSize: 13, color: 'var(--text)' }}>{fmtQ(Number.isFinite(dealVol) ? dealVol : 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text)' }}>{t('netLabel')}</span>
                  <strong style={{ fontFamily: 'var(--lt-font-mono)', fontSize: 13, color: Number.isFinite(dealNet) ? (dealNet >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)' }}>
                    {Number.isFinite(dealNet) ? `${dealNet >= 0 ? '+' : ''}${fmtQ(dealNet)}` : '—'}
                  </strong>
                </div>
              </div>

              <div className="g2tight" style={{ marginBottom: 10 }}>
                <div className="field2">
                  <div className="lbl">{t('qtyUsdt')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editDealQty} onChange={numericOnly(setEditDealQty)} style={mobileInputStyle} /></div>
                </div>
                <div className="field2">
                  <div className="lbl">{t('sellPriceQar')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editDealSell} onChange={numericOnly(setEditDealSell)} style={mobileInputStyle} /></div>
                </div>
              </div>

              <div className="field2" style={{ marginBottom: 10 }}>
                <div className="lbl">{t('feeQarLabel')}</div>
                <div className="inputBox"><input inputMode="decimal" value={editDealFee} onChange={numericOnly(setEditDealFee)} style={mobileInputStyle} /></div>
              </div>

              <div className="field2" style={{ marginBottom: 16 }}>
                <div className="lbl">{t('note')}</div>
                <div className="inputBox" style={{ padding: 0 }}>
                  <textarea
                    value={editDealNote}
                    onChange={e => setEditDealNote(e.target.value)}
                    rows={2}
                    style={{ width: '100%', padding: '7px 10px', resize: 'none', background: 'transparent', border: 'none', color: 'var(--text)', fontSize: isMobile ? 14 : 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <DialogFooter style={{ gap: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', ...mobileDialogFooterStyle }}>
                <button
                  onClick={() => setDeleteDealConfirm(editingDealId)}
                  style={{ padding: '7px 12px', borderRadius: 6, background: 'color-mix(in srgb, var(--bad) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)', color: 'var(--bad)', fontWeight: 600, fontSize: 11, cursor: 'pointer', minHeight: isMobile ? 42 : undefined, width: isMobile ? '100%' : undefined }}
                >
                  {t('delete')}
                </button>
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', width: isMobile ? '100%' : undefined }}>
                  <button className="btn secondary" style={{ minWidth: 80, minHeight: isMobile ? 42 : undefined, width: isMobile ? '100%' : undefined }} onClick={() => setEditingDealId(null)}>{t('cancel')}</button>
                  <button
                    onClick={saveDealEdit}
                    style={{ minWidth: 130, padding: '9px 18px', borderRadius: 6, background: 'var(--good)', color: '#000', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer', minHeight: isMobile ? 42 : undefined, width: isMobile ? '100%' : undefined }}
                  >
                    {t('saveCorrection')}
                  </button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ─── DELETE DEAL CONFIRMATION DIALOG ─── */}
      <Dialog open={!!deleteDealConfirm} onOpenChange={open => !open && setDeleteDealConfirm(null)}>
        <DialogContent className="tracker-root" style={{ maxWidth: 420, background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--bad) 25%, var(--line))', borderRadius: 12, padding: 24, gap: 0, ...mobileDialogContentStyle }}>
          <DialogHeader style={{ marginBottom: 14 }}>
            <DialogTitle style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('confirmDeleteDeal')}</DialogTitle>
          </DialogHeader>
          <div style={{ background: 'color-mix(in srgb, var(--bad) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 28%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--bad)', marginBottom: 14, lineHeight: 1.5 }}>
            {t('deleteDealWarning')}
          </div>
          <DialogFooter style={{ gap: 8, flexDirection: 'row', justifyContent: 'flex-end', ...mobileDialogFooterStyle }}>
            <button className="btn secondary" onClick={() => setDeleteDealConfirm(null)} style={isMobile ? { minHeight: 42, width: '100%' } : undefined}>{t('cancel')}</button>
            <button
              onClick={() => deleteDealConfirm && deleteDeal(deleteDealConfirm)}
              style={{ padding: '9px 18px', borderRadius: 6, background: 'var(--bad)', color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer', minHeight: isMobile ? 42 : undefined, width: isMobile ? '100%' : undefined }}
            >
              {t('delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
