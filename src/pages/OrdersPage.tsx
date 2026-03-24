import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { AGREEMENT_TEMPLATES, getTemplateRatioLabel, getAgreementFamilyLabel, getDealShares, type AgreementTemplate } from '@/lib/deal-templates';
import { isSupportedDealType } from '@/types/domain';
import type { MerchantRelationship, MerchantDeal, ProfitShareAgreement, AllocationFamily } from '@/types/domain';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useSubmitCapitalTransfer } from '@/hooks/useCapitalTransfers';
import { useProfitShareAgreements, useApprovedAgreements } from '@/hooks/useProfitShareAgreements';
import { useCreateAllocations, calculateAllocationEconomics, type CreateAllocationInput } from '@/hooks/useOrderAllocations';
import '@/styles/tracker.css';

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

/** Parse pipe-separated key:value metadata from deal.notes */
function parseDealMeta(notes: string | null | undefined): Record<string, string> {
  if (!notes) return {};
  const meta: Record<string, string> = {};
  notes.split('|').forEach(seg => {
    const idx = seg.indexOf(':');
    if (idx > 0) {
      const key = seg.slice(0, idx).trim();
      const val = seg.slice(idx + 1).trim();
      meta[key] = val;
    }
  });
  return meta;
}

export default function OrdersPage() {
  const { settings } = useTheme();
  const { userId, merchantProfile } = useAuth();
  const t = useT();
  const navigate = useNavigate();

  const { state, derived, applyState } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
  });

  const [saleDate, setSaleDate] = useState(nowInput());
  const [saleMode, setSaleMode] = useState<'USDT' | 'QAR'>('USDT');
  const [saleAmount, setSaleAmount] = useState('');
  const [saleSell, setSaleSell] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerId, setBuyerId] = useState('');
  const [useStock, setUseStock] = useState(true);
  const [priceMode, setPriceMode] = useState<'fifo' | 'manual'>('fifo');
  const [manualBuyPrice, setManualBuyPrice] = useState('');
  const [saleFee, setSaleFee] = useState('');
  const [saleMessage, setSaleMessage] = useState('');

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

  // ─── Merchant Deal Edit (for incoming/outgoing API deals) ─────────
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
    allMerchantDeals.filter(d => d.status === 'cancelled' || (d.status as string) === 'voided').map(d => d.id)
  ), [allMerchantDeals]);
  const cancelledLocalTradeIds = useMemo(() => new Set(
    allMerchantDeals
      .filter(d => d.status === 'cancelled' || (d.status as string) === 'voided')
      .map(d => parseDealMeta(d.notes).local_trade)
      .filter(Boolean)
  ), [allMerchantDeals]);

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

  // Incoming: deals created by OTHER merchants in my relationships (exclude cancelled)
  const partnerMerchantDeals = useMemo(
    () => allMerchantDeals.filter(d => d.created_by !== userId && d.status !== 'cancelled'),
    [allMerchantDeals, userId],
  );
  // Outgoing: deals I created (server-authoritative, exclude cancelled)
  const creatorMerchantDeals = useMemo(
    () => allMerchantDeals.filter(d => d.created_by === userId && d.status !== 'cancelled'),
    [allMerchantDeals, userId],
  );

  const filteredCustomers = useMemo(() => {
    const q = normalizeName(buyerName);
    if (!q) return state.customers;
    return state.customers.filter(c => normalizeName(c.name).includes(q) || c.phone.includes(buyerName));
  }, [buyerName, state.customers]);

  // Sale preview computation
  const salePreview = useMemo(() => {
    const sell = Number(saleSell);
    const raw = Number(saleAmount);
    const ts = new Date(saleDate).getTime();
    const amountUSDT = saleMode === 'USDT' ? raw : sell > 0 ? raw / sell : 0;
    if (!(amountUSDT > 0) || !(sell > 0) || !Number.isFinite(ts)) return null;
    const fee = parseFloat(saleFee) || 0;
    if (priceMode === 'manual') {
      const buyP = parseFloat(manualBuyPrice) || 0;
      const rev = amountUSDT * sell;
      const cost = amountUSDT * buyP;
      const net = rev - cost - fee;
      return { qty: amountUSDT, revenue: rev, avgBuy: buyP, cost, net };
    }
    const tmpTrade: Trade = { id: '__preview__', ts, inputMode: saleMode, amountUSDT, sellPriceQAR: sell, feeQAR: fee, note: '', voided: false, usesStock: true, revisions: [], customerId: '' };
    const calc = computeFIFO(state.batches, [...state.trades, tmpTrade]).tradeCalc.get('__preview__');
    const rev = amountUSDT * sell;
    const cost = calc?.slices.reduce((s, x) => s + x.cost, 0) || 0;
    const net = calc?.ok ? rev - cost - fee : NaN;
    return { qty: amountUSDT, revenue: rev, avgBuy: calc?.ok ? calc.avgBuyQAR : NaN, cost: calc?.ok ? cost : NaN, net };
  }, [saleAmount, saleDate, saleMode, saleSell, saleFee, priceMode, manualBuyPrice, state.batches, state.trades]);

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
      // Sales Deal: based on order amount
      const base = salePreview.revenue;
      const partnerAmount = (base * partnerPct) / 100;
      const merchantAmount = base - partnerAmount;
      return {
        partnerPct, merchantPct, partnerAmount, merchantAmount,
        base, baseLabel: 'sale_economics' as const,
        revenue: salePreview.revenue,
        fifoCost: Number.isFinite(salePreview.cost) ? salePreview.cost : null,
        counterpartyName: rel?.counterparty?.display_name || t('partner'),
      };
    }
  }, [selectedTemplateId, salePreview, linkedRelId, relationships, t]);

  const isCapitalTransfer = selectedTemplateId === 'capital_transfer';
  const submitCapitalTransfer = useSubmitCapitalTransfer();

  const handleCapitalTransfer = async () => {
    if (!linkedRelId) { toast.error('Select a partner first'); return; }
    if (!transferAmount || !transferCostBasis) { toast.error('Amount and cost basis are required'); return; }
    try {
      await submitCapitalTransfer.mutateAsync({
        relationship_id: linkedRelId,
        direction: transferDirection,
        amount: parseFloat(transferAmount),
        cost_basis: parseFloat(transferCostBasis),
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

  // ─── ADD TRADE (Trade-Centric) ────────────────────────────────────
  const addTrade = async () => {
    // Capital transfers are handled separately via handleCapitalTransfer
    if (isCapitalTransfer) return;

    const ts = new Date(saleDate).getTime();
    const sell = Number(saleSell);
    const raw = Number(saleAmount);
    const amountUSDT = saleMode === 'USDT' ? raw : sell > 0 ? raw / sell : 0;
    const errs: string[] = [];
    if (!Number.isFinite(ts)) errs.push(t('date'));
    if (!(sell > 0)) errs.push(t('sellPriceLabel'));
    if (!(raw > 0)) errs.push(t('quantity'));
    if (!(amountUSDT > 0)) errs.push(t('amountUsdt'));
    if (!buyerName.trim()) errs.push(t('buyerNameRequired'));
    if (errs.length) { setSaleMessage(`${t('fixFields')} ${errs.join(', ')}`); return; }

    // Merchant-linked validation
    const isNewAllocFlow = selectedTemplateId === 'profit_share_family' || selectedTemplateId === 'sales_deal_family';
    if (merchantOrderEnabled && !isNewAllocFlow && !linkedRelId) { setSaleMessage(`${t('fixFields')} ${t('relationship')}`); return; }
    if (merchantOrderEnabled && !selectedTemplateId) { setSaleMessage(`${t('fixFields')} ${t('agreementTypeRequired')}`); return; }

    // Multi-merchant allocation validation
    if (merchantOrderEnabled && isNewAllocFlow) {
      if (allocations.length === 0) { setSaleMessage('Add at least one merchant allocation'); return; }
      const totalAllocated = allocations.reduce((s, a) => s + (parseFloat(a.allocatedUsdt) || 0), 0);
      if (Math.abs(totalAllocated - amountUSDT) > 0.01) {
        setSaleMessage(`Allocation mismatch: allocated ${totalAllocated.toFixed(2)} USDT but sale is ${amountUSDT.toFixed(2)} USDT`);
        return;
      }
      for (const alloc of allocations) {
        if (!alloc.relationshipId) { setSaleMessage('Each allocation must have a merchant selected'); return; }
        if (alloc.family === 'profit_share' && !alloc.agreementId) {
          setSaleMessage(`Profit Share allocation for ${alloc.merchantName || 'merchant'} requires an approved agreement`);
          return;
        }
        if (!(parseFloat(alloc.allocatedUsdt) > 0)) { setSaleMessage('Each allocation must have USDT amount > 0'); return; }
        if (!(parseFloat(alloc.merchantCostPerUsdt) > 0)) { setSaleMessage('Each allocation must have a merchant cost > 0'); return; }
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
      id: uid(), ts, inputMode: saleMode, amountUSDT, sellPriceQAR: sell, feeQAR: parseFloat(saleFee) || 0, note: '', voided: false, usesStock: useStock, revisions: [], customerId,
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
        const saleGroupId = uid();
        const fee = parseFloat(saleFee) || 0;

        const allocationInputs: CreateAllocationInput[] = allocations.map(alloc => {
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
            order_id: baseTrade.id,
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

        // Save local trade
        const next: TrackerState = {
          ...state,
          customers: nextCustomers,
          trades: [...state.trades, baseTrade],
          range: inRange(ts, state.range) ? state.range : 'all'
        };
        applyState(next);
        await reloadMerchantData();
        toast.success('Order created with multi-merchant allocations');

        // Reset
        setSaleAmount('');
        setMerchantOrderEnabled(false);
        setLinkedRelId('');
        setSelectedTemplateId(null);
        setAllocations([]);
        return;
      } catch (err: any) {
        console.error('Failed to create allocations:', err);
        toast.error(err.message || 'Failed to create merchant allocations');
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

        const familyLabel = tmpl.family === 'profit_share' ? 'Profit Share' : 'Sales Deal';
        const title = `${familyLabel} · ${customerName} · ${tmpl.ratioDisplay}`;

        // Store trade data in notes so partner can see qty/sell/cost
        const c = computeFIFO(state.batches, [...state.trades, baseTrade]).tradeCalc.get(baseTrade.id);
        const fifoCost = c?.ok ? c.slices.reduce((s, x) => s + x.cost, 0) : 0;
        const avgBuy = priceMode === 'manual' ? (parseFloat(manualBuyPrice) || 0) : (c?.ok ? c.avgBuyQAR : 0);

        const noteLines = [
          `template: ${tmpl.id}`,
          `customer: ${customerName}`,
          `local_trade: ${baseTrade.id}`,
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
        }).select('id').single();

        if (error) throw error;

        // Per-order settlement period creation
        const dealCadence = (tmpl as any)?.defaults?.settlement_period || 'monthly';
        if (dealCadence === 'per_order' && data?.id) {
          const partnerPct = (tmpl as any).defaults?.counterparty_share_pct ?? (tmpl as any).defaults?.partner_ratio ?? 0;
          const rev = baseTrade.amountUSDT * sell;
          const netProfit = rev - fifoCost - fee;
          const partnerAmt = tmpl.family === 'profit_share'
            ? netProfit * (partnerPct / 100)
            : rev * (partnerPct / 100);

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
        applyState(next);

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
      applyState(next);
      setSaleMessage(t('tradeLogged'));
    }

    // Reset form
    setSaleAmount('');
    setMerchantOrderEnabled(false);
    setLinkedRelId('');
    setSelectedTemplateId(null);
    setAllocations([]);
  };

  const exportCsv = () => {
    const rows = filtered.map(t => {
      const c = derived.tradeCalc.get(t.id);
      const revenue = t.amountUSDT * t.sellPriceQAR;
      const cost = c?.slices.reduce((s, x) => s + x.cost, 0) || 0;
      const net = c?.ok ? revenue - cost : NaN;
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
    // Block editing approved merchant-linked trades
    if (tr.approvalStatus === 'approved') {
      toast.error(t('cannotEditApprovedTrade'));
      return;
    }
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
      if (!tmpl) { toast.error('Invalid template'); return; }

      try {
        const customerName = state.customers.find(c => c.id === editCustomerId)?.name || t('buyer');
        const rev = qty * sell;

        const tempCalc = computeFIFO(state.batches, state.trades);
        const calc = tempCalc.tradeCalc.get(editingTradeId);
        const fifoCost = calc?.ok ? calc.slices.reduce((s, x) => s + x.cost, 0) : 0;
        const avgBuy = calc?.ok ? calc.avgBuyQAR : 0;

        const familyLabel = tmpl.family === 'profit_share' ? 'Profit Share' : 'Sales Deal';
        const title = `${familyLabel} · ${customerName} · ${tmpl.ratioDisplay}`;

        const noteLines = [
          `template: ${tmpl.id}`,
          `customer: ${customerName}`,
          `local_trade: ${editingTradeId}`,
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
    setEditingTradeId(null);
  };

  const deleteTrade = () => {
    if (!editingTradeId) return;
    const tr = state.trades.find(x => x.id === editingTradeId);
    if (tr?.approvalStatus === 'approved') {
      toast.error(t('cannotDeleteApprovedTrade'));
      return;
    }
    applyState({ ...state, trades: state.trades.filter(t => t.id !== editingTradeId) });
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

    // Also update local trade state
    const nextTrades = state.trades.map(t =>
      t.id === tradeId ? { ...t, approvalStatus: 'cancelled' as LinkedTradeStatus } : t
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
    const nextTrades = state.trades.map(t =>
      t.id === cancelTradeId ? { ...t, approvalStatus: 'cancelled' as LinkedTradeStatus } : t
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
      const deal = allMerchantDeals.find(d => d.id === editingDealId);
      const existingNotes = deal?.notes || '';
      const metaNote = `qty: ${qty} | sell: ${sell} | fee: ${fee} | note: ${editDealNote}`;
      const { error } = await supabase.from('merchant_deals').update({
        title: editDealTitle,
        amount: qty * sell,
        notes: metaNote,
      }).eq('id', editingDealId);
      if (error) throw error;
      await reloadMerchantData();
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
                {tr.agreementFamily === 'profit_share'
                  ? fmtQ(Number.isFinite(net) ? net * (tr.merchantPct! / 100) : 0)
                  : fmtQ(revenue * (tr.merchantPct! / 100))
                }
              </strong>
            </div>
            <div style={{ padding: '4px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--bad) 10%, transparent)', fontSize: 10 }}>
              🤝 {t('partnerNetProfit')}: <strong style={{ color: 'var(--bad)' }}>
                {tr.agreementFamily === 'profit_share'
                  ? fmtQ(Number.isFinite(net) ? net * (tr.partnerPct! / 100) : 0)
                  : fmtQ(revenue * (tr.partnerPct! / 100))
                }
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
  const myKpi = useMemo(() => {
    const selfTrades = filtered.filter(tr => !tr.agreementFamily && !tr.linkedDealId && !tr.linkedRelId);
    let qty = 0, vol = 0, netVal = 0;
    for (const tr of selfTrades) {
      const c = derived.tradeCalc.get(tr.id);
      qty += tr.amountUSDT;
      vol += tr.amountUSDT * tr.sellPriceQAR;
      if (c?.ok) netVal += c.netQAR;
    }
    return { count: selfTrades.length, qty, vol, net: netVal };
  }, [filtered, derived]);

  const outKpi = useMemo(() => {
    let vol = 0, netVal = 0;
    for (const deal of creatorMerchantDeals) {
      vol += deal.amount;
      if (deal.realized_pnl != null) netVal += deal.realized_pnl;
    }
    return { count: creatorMerchantDeals.length, vol, net: netVal };
  }, [creatorMerchantDeals]);

  const inKpi = useMemo(() => {
    let vol = 0, netVal = 0;
    for (const deal of partnerMerchantDeals) {
      vol += deal.amount;
      if (deal.realized_pnl != null) netVal += deal.realized_pnl;
    }
    return { count: partnerMerchantDeals.length, vol, net: netVal };
  }, [partnerMerchantDeals]);

  const renderKpiBar = (kpi: { count: number; qty?: number; vol: number; net: number }) => (
    <div style={{ display: 'flex', gap: 16, padding: '8px 12px', background: 'color-mix(in srgb, var(--brand) 5%, transparent)', borderRadius: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>{t('count').toUpperCase()}</div><div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{kpi.count}</div></div>
      {kpi.qty != null && <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>USDT {t('qty').toUpperCase()}</div><div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtU(kpi.qty)}</div></div>}
      <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>{t('volume').toUpperCase()}</div><div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtQ(kpi.vol)}</div></div>
      <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>{t('net').toUpperCase()} P&L</div><div className="mono" style={{ fontSize: 13, fontWeight: 700, color: kpi.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>{kpi.net >= 0 ? '+' : ''}{fmtQ(kpi.net)}</div></div>
    </div>
  );

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>

      {/* ─── TAB BAR ─── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)', marginBottom: 2 }}>
        {(['my', 'incoming', 'outgoing', 'transfers'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              if (tab !== 'my' && tab !== 'transfers') {
                setMerchantOrderEnabled(true);
                setLinkedRelId('');
                setSelectedTemplateId(null);
                setSaleAmount('');
              }
            }}
            style={{
              padding: '9px 18px', fontSize: 11, fontWeight: activeTab === tab ? 700 : 500,
              color: activeTab === tab ? 'var(--brand)' : 'var(--muted)',
              borderBottom: activeTab === tab ? '2px solid var(--brand)' : '2px solid transparent',
              background: 'transparent', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer',
              transition: 'all 0.15s', letterSpacing: '.2px',
            }}
          >
            {tab === 'my' ? `👤 ${t('myOrders')}`
              : tab === 'incoming' ? `📥 ${t('incomingOrders')}`
              : tab === 'outgoing' ? `📤 ${t('outgoingOrders')}`
              : `💸 ${t('usdtTransfers')}`}
          </button>
        ))}
      </div>

      <div className="twoColPage">

        {/* ═══════════ LEFT PANEL ═══════════ */}
        <div>

          {/* ── MY ORDERS TAB ── */}
          {activeTab === 'my' && (
            <>
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
              ) : (
                <div className="tableWrap ledgerWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('date')}</th><th>{t('type')}</th><th>{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r">{t('volume')}</th><th className="r">{t('net')}</th><th>{t('margin')}</th><th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(tr => {
                        const c = derived.tradeCalc.get(tr.id);
                        const ok = !!c?.ok;
                        const rev = tr.amountUSDT * tr.sellPriceQAR;
                        const net = ok ? c!.netQAR : NaN;
                        const margin = ok && rev > 0 ? c!.netQAR / rev : NaN;
                        const pct = Number.isFinite(margin) ? Math.min(1, Math.abs(margin) / 0.05) : 0;
                        const cn = state.customers.find(x => x.id === tr.customerId)?.name || '';
                        const isMerchantLinked = !!(tr.agreementFamily || tr.linkedDealId || tr.linkedRelId);
                        const linkedRel = isMerchantLinked ? relationships.find(r => r.id === tr.linkedRelId) : null;
                        return (
                          <React.Fragment key={tr.id}>
                            <tr style={isMerchantLinked ? { background: 'color-mix(in srgb, var(--brand) 4%, transparent)' } : undefined}>
                            <td>
                              <span className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(tr.ts)}</span>
                              {!ok && <span className="pill bad" style={{ fontSize: 9, marginLeft: 4 }}>!</span>}
                            </td>
                            <td style={{ textAlign: 'center', fontSize: 16 }}>
                              {isMerchantLinked ? '🤝' : '👤'}
                            </td>
                            <td>{cn ? <span className="tradeBuyerChip" title={cn} style={{ maxWidth: 130 }}>{cn}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                            <td className="mono r">{fmtU(tr.amountUSDT)}</td>
                            <td className="mono r">{ok ? fmtP(c!.avgBuyQAR) : '—'}</td>
                            <td className="mono r">{fmtP(tr.sellPriceQAR)}</td>
                            <td className="mono r">{fmtQ(rev)}</td>
                            <td className="mono r" style={{ color: Number.isFinite(net) ? (net >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)', fontWeight: 700 }}>{Number.isFinite(net) ? (net >= 0 ? '+' : '') + fmtQ(net) : '—'}</td>
                            <td>
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
              {renderKpiBar({ count: inKpi.count, vol: inKpi.vol, net: inKpi.net })}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>📥 {t('incomingOrders')}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('partnerTradesAwaitingApproval')}</div>
                </div>
                <span className="pill">{partnerMerchantDeals.length} {t('trades')}</span>
              </div>

              {partnerMerchantDeals.length === 0 ? (
                <div className="empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 4h10M7 8h10M7 12h10M7 16h10M7 20h10" /></svg>
                  <div className="empty-t">{t('noIncomingTrades')}</div>
                  <div className="empty-s">{t('incomingTradesDesc')}</div>
                </div>
              ) : (
                <div className="tableWrap ledgerWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('date')}</th><th>{t('merchant')}</th><th>{t('merchantDealType')}</th><th className="r">{t('qty')}</th><th className="r">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r">{t('volume')}</th><th className="r">{t('net')}</th><th>{t('margin')}</th><th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnerMerchantDeals.map(deal => {
                        const cfg = DEAL_TYPE_CONFIGS[deal.deal_type];
                        const rel = relationships.find(r => r.id === deal.relationship_id);
                        const { partnerPct } = getDealShares(deal);
                        const isPending = deal.status === 'pending';
                        const isLegacy = !isSupportedDealType(deal.deal_type);
                        const meta = parseDealMeta(deal.notes);
                        const dealQty = Number(meta.quantity) || deal.amount || 0;
                        const dealSell = Number(meta.sell_price) || 0;
                        const dealVol = dealQty * (dealSell || 1);
                        const dealCost = Number(meta.fifo_cost) || 0;
                        const dealNet = dealSell > 0 ? dealVol - dealCost : 0;
                        const dealMargin = dealVol > 0 ? dealNet / dealVol : 0;
                        const marginPct = Number.isFinite(dealMargin) ? Math.min(1, Math.abs(dealMargin) / 0.05) : 0;
                        const merchantName = rel?.counterparty?.display_name || '—';
                        const avgBuy = dealQty > 0 && dealCost > 0 ? dealCost / dealQty : 0;

                        return (
                          <tr key={deal.id}>
                            <td><span className="mono">{deal.created_at ? new Date(deal.created_at).toLocaleDateString() : '—'}</span></td>
                            <td>{merchantName !== '—' ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{merchantName}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                <span>{cfg?.icon}</span>
                                <span style={{ color: 'var(--brand)', fontWeight: 600, fontSize: 10 }}>{cfg?.label || deal.deal_type}</span>
                                {partnerPct != null && <span className="pill" style={{ fontSize: 8, color: 'var(--brand)' }}>{partnerPct}%/{100 - partnerPct}%</span>}
                                {isLegacy && <span className="pill" style={{ fontSize: 7, color: 'var(--muted)' }}>{t('legacyAgreement')}</span>}
                              </span>
                            </td>
                            <td className="mono r">{fmtU(dealQty)}</td>
                            <td className="mono r">{avgBuy > 0 ? fmtP(avgBuy) : '—'}</td>
                            <td className="mono r">{dealSell > 0 ? fmtP(dealSell) : '—'}</td>
                            <td className="mono r">{fmtQ(dealVol)}</td>
                            <td className="mono r" style={{ color: dealNet >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                              {dealNet !== 0 ? `${dealNet >= 0 ? '+' : ''}${fmtQ(dealNet)}` : '—'}
                            </td>
                            <td>
                              <div className={`prog ${dealMargin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(marginPct * 100).toFixed(0)}%` }} /></div>
                              <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{dealMargin !== 0 ? `${(dealMargin * 100).toFixed(2)}% ${t('marginLabel')}` : '—'}</div>
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
                                <button className="rowBtn" onClick={() => openDealEdit(deal)}>{t('edit')}</button>
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
              {renderKpiBar({ count: outKpi.count, vol: outKpi.vol, net: outKpi.net })}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>📤 {t('outgoingOrders')}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('yourMerchantLinkedTrades')}</div>
                </div>
                <span className="pill">{creatorMerchantDeals.length} {t('trades')}</span>
              </div>

              {creatorMerchantDeals.length === 0 ? (
                <div className="empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 4h10M7 8h10M7 12h10M7 16h10M7 20h10" /></svg>
                  <div className="empty-t">{t('noOutgoingTrades')}</div>
                  <div className="empty-s">{t('outgoingTradesDesc')}</div>
                </div>
              ) : (
                <div className="tableWrap ledgerWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('date')}</th><th>{t('merchant')}</th><th>{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r">{t('volume')}</th><th className="r">{t('net')}</th><th>{t('margin')}</th><th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creatorMerchantDeals.map(deal => {
                        const cfg = DEAL_TYPE_CONFIGS[deal.deal_type];
                        const rel = relationships.find(r => r.id === deal.relationship_id);
                        const { partnerPct } = getDealShares(deal);
                        const meta = parseDealMeta(deal.notes);
                        const dealQty = Number(meta.quantity) || deal.amount || 0;
                        const dealSell = Number(meta.sell_price) || 0;
                        const dealVol = dealQty * (dealSell || 1);
                        const dealCost = Number(meta.fifo_cost) || 0;
                        const dealNet = dealSell > 0 ? dealVol - dealCost : 0;
                        const dealMargin = dealVol > 0 ? dealNet / dealVol : 0;
                        const marginPct = Number.isFinite(dealMargin) ? Math.min(1, Math.abs(dealMargin) / 0.05) : 0;
                        const merchantName = rel?.counterparty?.display_name || '—';
                        const customerName = meta.customer || '';

                        const statusColors: Record<string, { bg: string; color: string }> = {
                          pending: { bg: 'color-mix(in srgb, var(--warn) 15%, transparent)', color: 'var(--warn)' },
                          approved: { bg: 'color-mix(in srgb, var(--good) 15%, transparent)', color: 'var(--good)' },
                          rejected: { bg: 'color-mix(in srgb, var(--bad) 15%, transparent)', color: 'var(--bad)' },
                          cancelled: { bg: 'color-mix(in srgb, var(--muted) 15%, transparent)', color: 'var(--muted)' },
                        };
                        const sc = statusColors[deal.status] || statusColors.pending;

                        return (
                          <tr key={`deal-${deal.id}`}>
                            <td>
                              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span className="mono">{deal.created_at ? new Date(deal.created_at).toLocaleDateString() : '—'}</span>
                                <span className="pill" style={{ fontSize: 8, background: sc.bg, color: sc.color, fontWeight: 700 }}>{deal.status}</span>
                                {partnerPct != null && <span className="pill" style={{ fontSize: 8, color: 'var(--brand)' }}>{partnerPct}%/{100 - partnerPct}%</span>}
                              </div>
                            </td>
                            <td>{merchantName !== '—' ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{merchantName}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                            <td>{customerName ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{customerName}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                            <td className="mono r">{fmtU(dealQty)}</td>
                            <td className="mono r">{dealQty > 0 && dealCost > 0 ? fmtP(dealCost / dealQty) : '—'}</td>
                            <td className="mono r">{dealSell > 0 ? fmtP(dealSell) : '—'}</td>
                            <td className="mono r">{fmtQ(dealVol)}</td>
                            <td className="mono r" style={{ color: dealNet >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                              {dealNet !== 0 ? `${dealNet >= 0 ? '+' : ''}${fmtQ(dealNet)}` : '—'}
                            </td>
                            <td>
                              <div className={`prog ${dealMargin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(marginPct * 100).toFixed(0)}%` }} /></div>
                              <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{dealMargin !== 0 ? `${(dealMargin * 100).toFixed(2)}% ${t('marginLabel')}` : '—'}</div>
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

        </div>

        {/* ═══════════ RIGHT PANEL ═══════════ */}
        <div>

          {/* ── MY ORDERS: New Sale Form ── */}
          {activeTab === 'my' && (
            <div className="formPanel salePanel">
              <div className="hdr">{t('newSale')}</div>
              <div className="inner">
                {/* Normal sale form — hidden when Capital Transfer is selected */}
                {!isCapitalTransfer && (<>

                {/* Price mode toggle: FIFO vs Manual */}
                <div className="bannerRow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="bLbl">{t('avPrice')}</span>
                    <span className="bVal">{priceMode === 'fifo' && wacop ? fmtP(wacop) : '—'}</span>
                  </div>
                  <div className="modeToggle" style={{ fontSize: 9 }}>
                    <button type="button" className={priceMode === 'fifo' ? 'active' : ''} onClick={() => { setPriceMode('fifo'); setUseStock(true); }}>FIFO</button>
                    <button type="button" className={priceMode === 'manual' ? 'active' : ''} onClick={() => { setPriceMode('manual'); setUseStock(false); }}>Manual</button>
                  </div>
                </div>

                <div className="field2">
                  <div className="lbl">{t('dateTime')}</div>
                  <div className="inputBox"><input type="datetime-local" value={saleDate} onChange={e => setSaleDate(e.target.value)} /></div>
                </div>

                <div className="field2">
                  <div className="lbl">{t('inputMode')}</div>
                  <div className="modeToggle">
                    <button className={saleMode === 'USDT' ? 'active' : ''} type="button" onClick={() => setSaleMode('USDT')}>💲 USDT</button>
                    <button className={saleMode === 'QAR' ? 'active' : ''} type="button" onClick={() => setSaleMode('QAR')}>📦 QAR</button>
                  </div>
                </div>

                <div className="g2tight">
                  <div className="field2">
                    <div className="lbl">{saleMode === 'USDT' ? t('quantity') : t('amountQar')}</div>
                    <div className="inputBox"><input inputMode="decimal" placeholder="0.00" value={saleAmount} onChange={numericOnly(setSaleAmount)} /></div>
                  </div>
                  <div className="field2">
                    <div className="lbl">{t('sellPriceLabel')}</div>
                    <div className="inputBox"><input inputMode="decimal" placeholder={wacop ? fmtP(wacop) : '0.00'} value={saleSell} onChange={numericOnly(setSaleSell)} /></div>
                  </div>
                </div>

                {priceMode === 'manual' && (
                  <div className="g2tight">
                    <div className="field2">
                      <div className="lbl">{t('buyPrice') || 'Buy Price'}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="0.00" value={manualBuyPrice} onChange={numericOnly(setManualBuyPrice)} /></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('feeQarLabel') || 'Fee (QAR)'}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="0" value={saleFee} onChange={numericOnly(setSaleFee)} /></div>
                    </div>
                  </div>
                )}

                {priceMode === 'fifo' && (
                  <div className="field2">
                    <div className="lbl">{t('feeQarLabel') || 'Fee (QAR)'}</div>
                    <div className="inputBox"><input inputMode="decimal" placeholder="0" value={saleFee} onChange={numericOnly(setSaleFee)} /></div>
                  </div>
                )}

                <div className="field2">
                  <div className="lbl">{t('buyerName')} <span style={{ color: 'var(--bad)', fontWeight: 700 }}>*</span></div>
                  <div className="lookupShell">
                    <div className="inputBox lookupBox" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input placeholder={t('searchOrTypeBuyer')} style={{ flex: 1, paddingRight: 0 }} autoComplete="off" value={buyerName}
                        onFocus={() => setBuyerMenuOpen(true)}
                        onChange={e => { setBuyerName(e.target.value); setBuyerId(''); setBuyerMenuOpen(true); }}
                      />
                      <button className="sideAction" title={t('buyer')} type="button" onClick={() => setBuyerMenuOpen(v => !v)}>⌄</button>
                      <button className="sideAction" title={t('addBuyerTitle')} type="button" onClick={() => { setNewBuyerName(buyerName); setAddBuyerOpen(v => !v); }}>+</button>
                    </div>
                    {buyerMenuOpen && (
                      <div className="lookupMenu">
                        {filteredCustomers.length ? filteredCustomers.map(c => (
                          <button key={c.id} className="lookupItem" type="button" onClick={() => { setBuyerName(c.name); setBuyerId(c.id); setBuyerMenuOpen(false); }}>
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
                      <div className="field2"><div className="lbl">{t('name')}</div><div className="inputBox"><input value={newBuyerName} onChange={e => setNewBuyerName(e.target.value)} placeholder={t('buyerNamePlaceholder')} /></div></div>
                      <div className="field2"><div className="lbl">{t('phone')}</div><div className="inputBox"><input value={newBuyerPhone} onChange={e => setNewBuyerPhone(e.target.value)} placeholder="+974 ..." /></div></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('tier')}</div>
                      <div className="modeToggle">{['A', 'B', 'C', 'D'].map(tier => (<button key={tier} type="button" className={newBuyerTier === tier ? 'active' : ''} onClick={() => setNewBuyerTier(tier)}>{tier}</button>))}</div>
                    </div>
                    <div className="formActions"><button className="btn secondary" onClick={() => setAddBuyerOpen(false)}>{t('cancel')}</button><button className="btn" onClick={addBuyerFromModal}>{t('addBuyerTitle')}</button></div>
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
                      {/* ─── Deal Family Selector ─── */}
                      <div className="field2" style={{ marginBottom: 6 }}>
                        <div className="lbl">{t('dealFamilyLabel')} <span style={{ color: 'var(--bad)', fontWeight: 700 }}>*</span></div>
                        <select
                          value={selectedTemplateId || ''}
                          onChange={e => {
                            const val = e.target.value || null;
                            setSelectedTemplateId(val);
                            setAllocations([]);
                            // For capital transfer, switch to legacy flow
                            if (val === 'capital_transfer') {
                              setLinkedRelId('');
                            }
                          }}
                          style={{ width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                        >
                          <option value="">{t('selectDealFamily')}</option>
                          <option value="profit_share_family">🤝 {t('profitShareRequiresAgreement')}</option>
                          <option value="sales_deal_family">📊 {t('salesDealNoApproval')}</option>
                          <option value="capital_transfer">💸 {t('capitalTransferFamily')}</option>
                        </select>
                      </div>

                      {/* ─── Capital Transfer (legacy flow) ─── */}
                      {isCapitalTransfer && (
                        <>
                          <div className="field2" style={{ marginBottom: 6 }}>
                            <div className="lbl">{t('selectPartner')}</div>
                            <select
                              value={linkedRelId}
                              onChange={e => setLinkedRelId(e.target.value)}
                              style={{ width: '100%', padding: '4px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                            >
                              <option value="">{t('noneSelected')}</option>
                              {relationships.map(r => (
                                <option key={r.id} value={r.id}>{r.counterparty?.display_name || r.id}</option>
                              ))}
                            </select>
                          </div>
                          {linkedRelId && (
                            <div style={{ marginTop: 8 }}>
                              {(() => {
                                const cpRel = relationships.find(r => r.id === linkedRelId);
                                const cpName = cpRel?.counterparty?.display_name || (cpRel as any)?.counterparty_name || t('partner');
                                const myName = merchantProfile?.display_name || t('you') || 'You';
                                return (
                                  <div className="field2" style={{ marginBottom: 6 }}>
                                    <div className="lbl">{t('direction')}</div>
                                    <select
                                      value={transferDirection}
                                      onChange={e => setTransferDirection(e.target.value as any)}
                                      style={{ width: '100%', padding: '4px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                                    >
                                      <option value="lender_to_operator">💸 {cpName} → {myName}</option>
                                      <option value="operator_to_lender">↩️ {myName} → {cpName}</option>
                                    </select>
                                  </div>
                                );
                              })()}
                              <div className="g2tight">
                                <div className="field2">
                                  <div className="lbl">USDT {t('amount')}</div>
                                  <div className="inputBox">
                                    <input type="number" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder="0" />
                                  </div>
                                </div>
                                <div className="field2">
                                  <div className="lbl">{t('costBasisQar')}</div>
                                  <div className="inputBox">
                                    <input type="number" step="0.01" value={transferCostBasis} onChange={e => setTransferCostBasis(e.target.value)} placeholder="3.65" />
                                  </div>
                                </div>
                              </div>
                              {transferAmount && transferCostBasis && (
                                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                                  {t('totalCostQar')}: <span className="mono" style={{ fontWeight: 700 }}>
                                    {(parseFloat(transferAmount) * parseFloat(transferCostBasis)).toLocaleString()} QAR
                                  </span>
                                </div>
                              )}
                              <div className="field2" style={{ marginTop: 6 }}>
                                <div className="lbl">{t('noteOptional')}</div>
                                <div className="inputBox">
                                  <input value={transferNote} onChange={e => setTransferNote(e.target.value)} placeholder={t('noteOptional')} />
                                </div>
                              </div>
                              <button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={handleCapitalTransfer} disabled={submitCapitalTransfer.isPending}>
                                💸 {t('submitTransfer')}
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {/* ─── MULTI-MERCHANT ALLOCATIONS (Profit Share & Sales Deal) ─── */}
                      {(selectedTemplateId === 'profit_share_family' || selectedTemplateId === 'sales_deal_family') && (
                        <div style={{ marginTop: 4 }}>
                          {/* Info banner */}
                          <div style={{
                            padding: '6px 10px', borderRadius: 4, fontSize: 9, lineHeight: 1.4, marginBottom: 8,
                            background: selectedTemplateId === 'profit_share_family'
                              ? 'color-mix(in srgb, var(--brand) 6%, transparent)'
                              : 'color-mix(in srgb, var(--good) 6%, transparent)',
                            border: `1px solid ${selectedTemplateId === 'profit_share_family' ? 'color-mix(in srgb, var(--brand) 15%, transparent)' : 'color-mix(in srgb, var(--good) 15%, transparent)'}`,
                            color: 'var(--muted)',
                          }}>
                            {selectedTemplateId === 'profit_share_family' ? (
                              <><strong style={{ color: 'var(--brand)' }}>{t('profitShare')}:</strong> {t('profitShareInfoBanner')}</>
                            ) : (
                              <><strong style={{ color: 'var(--good)' }}>{t('salesDeal')}:</strong> {t('salesDealInfoBanner')}</>
                            )}
                          </div>

                          {/* Allocation rows */}
                          {allocations.map((alloc, idx) => {
                            const relAgreements = allAgreements.filter(a =>
                              a.relationship_id === alloc.relationshipId && a.status === 'approved' && isAgreementActive(a)
                            );
                            return (
                              <div key={alloc.id} style={{
                                padding: '8px 10px', borderRadius: 6, marginBottom: 6,
                                border: '1px solid var(--line)',
                                background: 'color-mix(in srgb, var(--brand) 3%, transparent)',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                  <span style={{ fontSize: 10, fontWeight: 700 }}>
                                    {selectedTemplateId === 'profit_share_family' ? '🤝' : '📊'} {t('allocationNum')} #{idx + 1}
                                  </span>
                                  <button
                                    className="rowBtn"
                                    style={{ color: 'var(--bad)', fontSize: 9 }}
                                    onClick={() => setAllocations(prev => prev.filter(a => a.id !== alloc.id))}
                                  >
                                    {t('removeAllocation')}
                                  </button>
                                </div>

                                {/* Merchant selector */}
                                <div className="field2" style={{ marginBottom: 4 }}>
                                  <div className="lbl" style={{ fontSize: 9 }}>{t('allocMerchant')}</div>
                                  <select
                                    value={alloc.relationshipId}
                                    onChange={e => {
                                      const relId = e.target.value;
                                      const rel = relationships.find(r => r.id === relId);
                                      const cpId = rel ? (rel.merchant_a_id === merchantProfile?.merchant_id ? rel.merchant_b_id : rel.merchant_a_id) : '';
                                      setAllocations(prev => prev.map(a => a.id === alloc.id ? {
                                        ...a,
                                        relationshipId: relId,
                                        merchantName: rel?.counterparty?.display_name || '',
                                        merchantId: cpId,
                                        agreementId: null,
                                        agreementLabel: '',
                                        partnerSharePct: selectedTemplateId === 'sales_deal_family' ? a.partnerSharePct : 0,
                                        merchantSharePct: selectedTemplateId === 'sales_deal_family' ? a.merchantSharePct : 0,
                                      } : a));
                                    }}
                                    style={{ width: '100%', padding: '4px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                                  >
                                    <option value="">{t('selectMerchantAlloc')}</option>
                                    {relationships.map(r => (
                                      <option key={r.id} value={r.id}>{r.counterparty?.display_name || r.id}</option>
                                    ))}
                                  </select>
                                </div>

                                {/* Profit Share: Agreement selector (locked ratio) */}
                                {selectedTemplateId === 'profit_share_family' && alloc.relationshipId && (
                                  <div className="field2" style={{ marginBottom: 4 }}>
                                    <div className="lbl" style={{ fontSize: 9 }}>{t('approvedAgreement')} <span style={{ color: 'var(--bad)' }}>*</span></div>
                                    {relAgreements.length === 0 ? (
                                      <div style={{ fontSize: 9, color: 'var(--bad)', padding: '4px 0' }}>
                                        ⚠️ {t('noApprovedAgreement')} {alloc.merchantName || t('thisMerchant')}. {t('createInWorkspaceFirst')}
                                      </div>
                                    ) : (
                                      <select
                                        value={alloc.agreementId || ''}
                                        onChange={e => {
                                          const agr = relAgreements.find(a => a.id === e.target.value);
                                          setAllocations(prev => prev.map(a => a.id === alloc.id ? {
                                            ...a,
                                            agreementId: agr?.id || null,
                                            agreementLabel: agr ? getAgreementLabel(agr) : '',
                                            partnerSharePct: agr?.partner_ratio || 0,
                                            merchantSharePct: agr?.merchant_ratio || 0,
                                          } : a));
                                        }}
                                        style={{ width: '100%', padding: '4px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
                                      >
                                        <option value="">{t('selectAgreement')}</option>
                                        {relAgreements.map(agr => (
                                          <option key={agr.id} value={agr.id}>
                                            🤝 {agr.partner_ratio}/{agr.merchant_ratio} — {agr.settlement_cadence}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    {alloc.agreementId && (
                                      <div style={{ fontSize: 9, color: 'var(--brand)', marginTop: 2, fontWeight: 600 }}>
                                        {t('lockedRatio')} {alloc.partnerSharePct}% / {t('youShare')} {alloc.merchantSharePct}%
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Sales Deal: Direct share entry */}
                                {selectedTemplateId === 'sales_deal_family' && (
                                  <div className="g2tight" style={{ marginBottom: 4 }}>
                                    <div className="field2">
                                      <div className="lbl" style={{ fontSize: 9 }}>{t('allocPartnerSharePct')}</div>
                                      <div className="inputBox" style={{ padding: '3px 6px' }}>
                                        <input
                                          type="number" min="0" max="100" placeholder="50"
                                          value={alloc.partnerSharePct || ''}
                                          onChange={e => {
                                            const pct = Number(e.target.value) || 0;
                                            setAllocations(prev => prev.map(a => a.id === alloc.id ? {
                                              ...a, partnerSharePct: pct, merchantSharePct: 100 - pct,
                                            } : a));
                                          }}
                                          style={{ fontSize: 10 }}
                                        />
                                      </div>
                                    </div>
                                    <div className="field2">
                                      <div className="lbl" style={{ fontSize: 9 }}>{t('allocYourSharePct')}</div>
                                      <div className="inputBox" style={{ padding: '3px 6px' }}>
                                        <input type="number" readOnly value={alloc.merchantSharePct || 0} style={{ fontSize: 10, opacity: 0.6, cursor: 'not-allowed' }} />
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Common: USDT allocation & cost */}
                                <div className="g2tight">
                                  <div className="field2">
                                    <div className="lbl" style={{ fontSize: 9 }}>Allocated USDT</div>
                                    <div className="inputBox" style={{ padding: '3px 6px' }}>
                                      <input
                                        inputMode="decimal" placeholder="0"
                                        value={alloc.allocatedUsdt}
                                        onChange={e => setAllocations(prev => prev.map(a => a.id === alloc.id ? { ...a, allocatedUsdt: e.target.value } : a))}
                                        style={{ fontSize: 10 }}
                                      />
                                    </div>
                                  </div>
                                  <div className="field2">
                                    <div className="lbl" style={{ fontSize: 9 }}>Merchant Cost/USDT</div>
                                    <div className="inputBox" style={{ padding: '3px 6px' }}>
                                      <input
                                        inputMode="decimal" placeholder="3.65"
                                        value={alloc.merchantCostPerUsdt}
                                        onChange={e => setAllocations(prev => prev.map(a => a.id === alloc.id ? { ...a, merchantCostPerUsdt: e.target.value } : a))}
                                        style={{ fontSize: 10 }}
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Optional note */}
                                <div className="field2" style={{ marginTop: 4 }}>
                                  <div className="lbl" style={{ fontSize: 9 }}>Note (optional)</div>
                                  <div className="inputBox" style={{ padding: '3px 6px' }}>
                                    <input
                                      value={alloc.note}
                                      onChange={e => setAllocations(prev => prev.map(a => a.id === alloc.id ? { ...a, note: e.target.value } : a))}
                                      placeholder="Optional note..."
                                      style={{ fontSize: 10 }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {/* Add allocation button */}
                          <button
                            className="btn secondary"
                            style={{ width: '100%', fontSize: 10, marginBottom: 8 }}
                            onClick={() => {
                              setAllocations(prev => [...prev, {
                                id: `alloc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                relationshipId: '',
                                merchantName: '',
                                merchantId: '',
                                family: selectedTemplateId === 'profit_share_family' ? 'profit_share' : 'sales_deal',
                                agreementId: null,
                                agreementLabel: '',
                                allocatedUsdt: '',
                                merchantCostPerUsdt: '',
                                partnerSharePct: 0,
                                merchantSharePct: 0,
                                note: '',
                              }]);
                            }}
                          >
                            + Add Merchant Allocation
                          </button>

                          {/* ─── Allocation Summary ─── */}
                          {allocations.length > 0 && salePreview && (() => {
                            const totalAllocated = allocations.reduce((s, a) => s + (parseFloat(a.allocatedUsdt) || 0), 0);
                            const remaining = salePreview.qty - totalAllocated;
                            const sellP = Number(saleSell) || 0;
                            const totalFee = parseFloat(saleFee) || 0;

                            const calcRows = allocations.map(alloc => {
                              const usdt = parseFloat(alloc.allocatedUsdt) || 0;
                              const costPerUsdt = parseFloat(alloc.merchantCostPerUsdt) || 0;
                              return calculateAllocationEconomics({
                                allocatedUsdt: usdt,
                                merchantCostPerUsdt: costPerUsdt,
                                sellPrice: sellP,
                                totalFee,
                                totalUsdt: salePreview.qty,
                                family: alloc.family,
                                partnerSharePct: alloc.partnerSharePct,
                              });
                            });

                            const totals = calcRows.reduce((acc, c) => ({
                              revenue: acc.revenue + c.revenue,
                              cost: acc.cost + c.cost,
                              fee: acc.fee + c.feeShare,
                              net: acc.net + c.net,
                              partnerTotal: acc.partnerTotal + c.partnerAmount,
                              merchantTotal: acc.merchantTotal + c.merchantAmount,
                            }), { revenue: 0, cost: 0, fee: 0, net: 0, partnerTotal: 0, merchantTotal: 0 });

                            const allocationMatch = Math.abs(remaining) < 0.01;
                            const overAllocated = remaining < -0.01;

                            return (
                              <div style={{
                                padding: '8px 10px', borderRadius: 6, marginBottom: 6,
                                background: 'color-mix(in srgb, var(--brand) 8%, transparent)',
                                border: `1px solid ${allocationMatch ? 'color-mix(in srgb, var(--good) 30%, transparent)' : 'color-mix(in srgb, var(--warn) 30%, transparent)'}`,
                              }}>
                                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--brand)', marginBottom: 4 }}>
                                  Allocation Summary
                                </div>

                                {/* Allocation balance */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                                  <span className="muted">Total Sale USDT:</span>
                                  <strong className="mono">{fmtU(salePreview.qty)}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                                  <span className="muted">Allocated:</span>
                                  <strong className="mono">{fmtU(totalAllocated)}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
                                  <span className="muted">Remaining:</span>
                                  <strong className="mono" style={{ color: allocationMatch ? 'var(--good)' : overAllocated ? 'var(--bad)' : 'var(--warn)' }}>
                                    {allocationMatch ? '✅ Balanced' : overAllocated ? `⚠️ Over by ${fmtU(Math.abs(remaining))}` : fmtU(remaining)}
                                  </strong>
                                </div>

                                {/* Per-merchant preview table */}
                                {calcRows.length > 0 && (
                                  <div style={{ borderTop: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)', paddingTop: 4, marginTop: 2 }}>
                                    <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                                      Per-Merchant Breakdown
                                    </div>
                                    {allocations.map((alloc, i) => {
                                      const c = calcRows[i];
                                      return (
                                        <div key={alloc.id} style={{
                                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                          fontSize: 9, padding: '3px 0',
                                          borderBottom: i < allocations.length - 1 ? '1px solid color-mix(in srgb, var(--line) 30%, transparent)' : 'none',
                                        }}>
                                          <span style={{ fontWeight: 600 }}>{alloc.merchantName || `Merchant ${i + 1}`}</span>
                                          <span className="mono">
                                            Rev {fmtQ(c.revenue)} · Net <span style={{ color: c.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>{c.net >= 0 ? '+' : ''}{fmtQ(c.net)}</span>
                                            {' · '}
                                            <span style={{ color: 'var(--good)' }}>You {fmtQ(c.merchantAmount)}</span>
                                            {' · '}
                                            <span style={{ color: 'var(--bad)' }}>Partner {fmtQ(c.partnerAmount)}</span>
                                          </span>
                                        </div>
                                      );
                                    })}
                                    {/* Totals row */}
                                    <div style={{
                                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                      fontSize: 10, fontWeight: 700, padding: '5px 0 0 0',
                                      borderTop: '1px solid color-mix(in srgb, var(--brand) 25%, transparent)',
                                      marginTop: 3,
                                    }}>
                                      <span>TOTAL</span>
                                      <span className="mono">
                                        Rev {fmtQ(totals.revenue)} · Net <span style={{ color: totals.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>{totals.net >= 0 ? '+' : ''}{fmtQ(totals.net)}</span>
                                        {' · '}
                                        <span style={{ color: 'var(--good)' }}>You {fmtQ(totals.merchantTotal)}</span>
                                        {' · '}
                                        <span style={{ color: 'var(--bad)' }}>Partners {fmtQ(totals.partnerTotal)}</span>
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* Validation message */}
                                {!allocationMatch && (
                                  <div style={{ fontSize: 9, color: 'var(--warn)', marginTop: 4, fontWeight: 600 }}>
                                    ⚠️ Allocated USDT must exactly match total sale quantity ({fmtU(salePreview.qty)}) to submit.
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
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

                {/* Live Preview - only show when NO partner is linked */}
                {!allocationPreview && (
                <div className="previewBox">
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

                <div className="formActions"><button className="btn" onClick={addTrade}>{merchantOrderEnabled ? t('sendForApproval') : t('addTrade')}</button></div>
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
                {partnerMerchantDeals.length === 0 ? (
                  <div className="muted" style={{ fontSize: 11, textAlign: 'center', padding: 20 }}>{t('noIncomingTrades')}</div>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                    <p>{t('incomingTradesHelp')}</p>
                    <div style={{ marginTop: 12 }}>
                      {partnerMerchantDeals.filter(d => d.status === 'pending').map(deal => {
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
                      {partnerMerchantDeals.filter(d => d.status === 'pending').length === 0 && (
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
                {creatorMerchantDeals.filter(d => d.status === 'pending').length > 0 && (
                  <div className="previewBox" style={{ borderColor: 'var(--warn)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn)', marginBottom: 4 }}>⏳ {t('pendingApprovalCount').replace('{n}', String(creatorMerchantDeals.filter(d => d.status === 'pending').length))}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('awaitingPartnerApproval')}</div>
                  </div>
                )}
                {creatorMerchantDeals.filter(d => d.status === 'approved').length > 0 && (
                  <div className="previewBox" style={{ borderColor: 'var(--good)', marginTop: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--good)', marginBottom: 4 }}>✅ {creatorMerchantDeals.filter(d => d.status === 'approved').length} {t('approvedTrades')}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('permanentSharedRecords')}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── USDT TRANSFERS PANEL ── */}
          {activeTab === 'transfers' && (
            <div className="formPanel salePanel">
              <div className="hdr">💸 {t('usdtTransfers')}</div>
              <div className="inner">
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
                  {t('capitalTransfersDesc')}
                </div>
                {allTransfers.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)', fontSize: 11 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('noTransfers')}</div>
                    <div style={{ fontSize: 10 }}>{t('createTransferDesc')}</div>
                  </div>
                ) : (
                  <div className="tableWrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('date')}</th>
                          <th>{t('direction')}</th>
                          <th>{t('merchant') || 'Partner'}</th>
                          <th className="r">USDT</th>
                          <th className="r">{t('costBasisQar')}</th>
                          <th className="r">{t('totalCostQar')}</th>
                          <th>{t('notes')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allTransfers.map((tx: any) => {
                          const rel = relationships.find(r => r.id === tx.relationship_id);
                          const isIn = tx.direction === 'lender_to_operator';
                          return (
                            <tr key={tx.id}>
                              <td className="mono" style={{ fontSize: 10 }}>
                                {new Date(tx.created_at).toLocaleDateString()}
                              </td>
                              <td>
                                <span className={`pill ${isIn ? 'good' : 'warn'}`} style={{ fontSize: 9 }}>
                                  {isIn ? '💸 ' + (t('capitalIn') || 'In') : '↩️ ' + (t('capitalReturn') || 'Out')}
                                </span>
                              </td>
                              <td style={{ fontSize: 10 }}>
                                {rel?.counterparty?.display_name || '—'}
                              </td>
                              <td className="mono r" style={{ fontWeight: 700, color: isIn ? 'var(--good)' : 'var(--bad)' }}>
                                {isIn ? '+' : '−'}{fmtU(tx.amount)}
                              </td>
                              <td className="mono r" style={{ fontSize: 10 }}>
                                {fmtP(tx.cost_basis)} QAR
                              </td>
                              <td className="mono r" style={{ fontSize: 10 }}>
                                {fmtQ(tx.total_cost)}
                              </td>
                              <td style={{ fontSize: 9, color: 'var(--muted)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {tx.note || '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
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
            <DialogContent className="tracker-root" style={{ maxWidth: 500, background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--good) 25%, var(--line))', borderRadius: 12, padding: 24, gap: 0 }}>
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
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>Volume</span>
                    <strong style={{ fontFamily: 'var(--lt-font-mono)', fontSize: 13, color: 'var(--text)' }}>{fmtQ(currentVolume)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>Net</span>
                    <strong style={{ fontFamily: 'var(--lt-font-mono)', fontSize: 13, color: currentNet != null ? (currentNet >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)' }}>
                      {currentNet != null ? `${currentNet >= 0 ? '+' : ''}${fmtQ(currentNet)}` : '—'}
                    </strong>
                  </div>
                </div>
              )}

              <div className="field2" style={{ marginBottom: 10 }}>
                <div className="lbl">{t('dateTime')}</div>
                <div className="inputBox"><input type="datetime-local" value={editDate} onChange={e => setEditDate(e.target.value)} disabled={isApproved} /></div>
              </div>

              <div className="field2" style={{ marginBottom: 10 }}>
                <div className="lbl">{t('buyerLabel')}</div>
                <select value={editCustomerId} onChange={e => setEditCustomerId(e.target.value)} disabled={isApproved}
                  style={{ width: '100%', padding: '8px 32px 8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', appearance: 'none', cursor: 'pointer', outline: 'none' }}
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
                  <div className="inputBox"><input inputMode="decimal" value={editQty} onChange={numericOnly(setEditQty)} disabled={isApproved} /></div>
                </div>
                <div className="field2">
                  <div className="lbl">{t('sellPriceQar')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editSell} onChange={numericOnly(setEditSell)} disabled={isApproved} /></div>
                </div>
              </div>

              <div className="g2tight" style={{ marginBottom: 10 }}>
                <div className="field2">
                  <div className="lbl">{t('feeQarLabel')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editFee} onChange={numericOnly(setEditFee)} disabled={isApproved} /></div>
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
                    style={{ width: '100%', padding: '7px 10px', resize: 'none', background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
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
                      ({editingTrade.agreementFamily === 'profit_share' ? 'Profit Share' : 'Sales Deal'}
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

              <DialogFooter style={{ gap: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                {!isApproved && (
                  <button
                    onClick={deleteTrade}
                    style={{ padding: '7px 12px', borderRadius: 6, background: 'color-mix(in srgb, var(--bad) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)', color: 'var(--bad)', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}
                  >
                    {t('delete')}
                  </button>
                )}
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                  <button className="btn secondary" style={{ minWidth: 80 }} onClick={() => setEditingTradeId(null)}>{t('cancel')}</button>
                  {!isApproved && (
                    <button
                      onClick={saveTradeEdit}
                      style={{ minWidth: 130, padding: '9px 18px', borderRadius: 6, background: 'var(--good)', color: '#000', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}
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
        <DialogContent className="tracker-root" style={{ maxWidth: 420, background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--warn) 25%, var(--line))', borderRadius: 12, padding: 24, gap: 0 }}>
          <DialogHeader style={{ marginBottom: 14 }}>
            <DialogTitle style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('requestCancellationTitle')}</DialogTitle>
          </DialogHeader>
          <div style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--warn)', marginBottom: 14, lineHeight: 1.5 }}>
            {t('cancellationRequestExplainer')}
          </div>
          <DialogFooter style={{ gap: 8, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={() => setCancelTradeId(null)}>{t('cancel')}</button>
            <button
              onClick={submitCancellationRequest}
              style={{ padding: '9px 18px', borderRadius: 6, background: 'var(--warn)', color: '#000', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}
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
            <DialogContent className="tracker-root" style={{ maxWidth: 500, background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--good) 25%, var(--line))', borderRadius: 12, padding: 24, gap: 0 }}>
              <DialogHeader style={{ marginBottom: 14 }}>
                <DialogTitle style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('correctTradeTitle')}</DialogTitle>
              </DialogHeader>

              <div style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--warn)', marginBottom: 14, lineHeight: 1.5 }}>
                {t('editInPlaceWarning')}
              </div>

              <div style={{ background: 'color-mix(in srgb, var(--good) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 25%, transparent)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.7px', textTransform: 'uppercase', color: 'var(--good)', marginBottom: 8 }}>{t('currentStatsLabel')}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: 'var(--text)' }}>Volume</span>
                  <strong style={{ fontFamily: 'var(--lt-font-mono)', fontSize: 13, color: 'var(--text)' }}>{fmtQ(Number.isFinite(dealVol) ? dealVol : 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text)' }}>Net</span>
                  <strong style={{ fontFamily: 'var(--lt-font-mono)', fontSize: 13, color: Number.isFinite(dealNet) ? (dealNet >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)' }}>
                    {Number.isFinite(dealNet) ? `${dealNet >= 0 ? '+' : ''}${fmtQ(dealNet)}` : '—'}
                  </strong>
                </div>
              </div>

              <div className="g2tight" style={{ marginBottom: 10 }}>
                <div className="field2">
                  <div className="lbl">{t('qtyUsdt')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editDealQty} onChange={numericOnly(setEditDealQty)} /></div>
                </div>
                <div className="field2">
                  <div className="lbl">{t('sellPriceQar')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editDealSell} onChange={numericOnly(setEditDealSell)} /></div>
                </div>
              </div>

              <div className="field2" style={{ marginBottom: 10 }}>
                <div className="lbl">{t('feeQarLabel')}</div>
                <div className="inputBox"><input inputMode="decimal" value={editDealFee} onChange={numericOnly(setEditDealFee)} /></div>
              </div>

              <div className="field2" style={{ marginBottom: 16 }}>
                <div className="lbl">{t('note')}</div>
                <div className="inputBox" style={{ padding: 0 }}>
                  <textarea
                    value={editDealNote}
                    onChange={e => setEditDealNote(e.target.value)}
                    rows={2}
                    style={{ width: '100%', padding: '7px 10px', resize: 'none', background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <DialogFooter style={{ gap: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => setDeleteDealConfirm(editingDealId)}
                  style={{ padding: '7px 12px', borderRadius: 6, background: 'color-mix(in srgb, var(--bad) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)', color: 'var(--bad)', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}
                >
                  {t('delete')}
                </button>
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                  <button className="btn secondary" style={{ minWidth: 80 }} onClick={() => setEditingDealId(null)}>{t('cancel')}</button>
                  <button
                    onClick={saveDealEdit}
                    style={{ minWidth: 130, padding: '9px 18px', borderRadius: 6, background: 'var(--good)', color: '#000', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}
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
        <DialogContent className="tracker-root" style={{ maxWidth: 420, background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--bad) 25%, var(--line))', borderRadius: 12, padding: 24, gap: 0 }}>
          <DialogHeader style={{ marginBottom: 14 }}>
            <DialogTitle style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('confirmDeleteDeal')}</DialogTitle>
          </DialogHeader>
          <div style={{ background: 'color-mix(in srgb, var(--bad) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 28%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--bad)', marginBottom: 14, lineHeight: 1.5 }}>
            {t('deleteDealWarning')}
          </div>
          <DialogFooter style={{ gap: 8, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={() => setDeleteDealConfirm(null)}>{t('cancel')}</button>
            <button
              onClick={() => deleteDealConfirm && deleteDeal(deleteDealConfirm)}
              style={{ padding: '9px 18px', borderRadius: 6, background: 'var(--bad)', color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}
            >
              {t('delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
