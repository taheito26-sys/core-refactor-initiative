import React, { useState, useMemo, useEffect } from 'react';
import {
  Layers,
  Plus,
  Search,
  ArrowUpRight,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  X,
  Wallet,
  DollarSign,
  Clock,
  RefreshCw,
  Eye,
  Edit2,
  Trash2,
  Users,
  Split,
  Info,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fmtU,
  fmtP,
  fmtDate,
  fmtTotal,
  type TrackerState,
} from '@/lib/tracker-helpers';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExchangeInbox, type ExchangeTransferPayload } from '@/features/exchanges/components/ExchangeInbox';
import { useExchangeP2POrders } from '@/features/exchanges/hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '@/features/exchanges/hooks/useExchangeTransfers';

export interface ModernStockViewProps {
  state: TrackerState;
  derived: any;
  perf: any[];
  availableUsdt: number;
  wacop: number;
  monthAvgBuyPrice: number | null;
  activeFifoBatch: any | null;
  exchangeUsdtTotals: { binance: number; okx: number };
  exchangeUsdtTotal: number;
  reconciliationDelta: number;
  reconciliationMismatch: boolean;
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  availableMonths: string[];
  baseFiat: 'QAR' | 'EGP';
  activeBatchFiat: 'QAR' | 'EGP';
  currency: 'QAR' | 'EGP' | 'USDT';
  supplierOptions: string[];
  activeAccounts: any[];
  accountBalances: Map<string, number>;
  fundingAccountId: string;
  setFundingAccountId: (id: string) => void;
  // Batch Form State
  batchDate: string;
  setBatchDate: (d: string) => void;
  batchEntryMode: 'price_vol' | 'qty_total' | 'qty_price';
  setBatchEntryMode: (m: 'price_vol' | 'qty_total' | 'qty_price') => void;
  batchMode: 'QAR' | 'EGP' | 'USDT';
  setBatchMode: (m: 'QAR' | 'EGP' | 'USDT') => void;
  batchPrice: string;
  setBatchPrice: (p: string) => void;
  batchAmount: string;
  setBatchAmount: (a: string) => void;
  batchUsdtQty: string;
  setBatchUsdtQty: (q: string) => void;
  batchSupplier: string;
  setBatchSupplier: (s: string) => void;
  batchNote: string;
  setBatchNote: (n: string) => void;
  batchMsg: string;
  setBatchMsg: (m: string) => void;
  // Drawer & Modals State
  addBatchSheetOpen: boolean;
  setAddBatchSheetOpen: (open: boolean) => void;
  supplierAddOpen: boolean;
  setSupplierAddOpen: (open: boolean) => void;
  newSupplierName: string;
  setNewSupplierName: (name: string) => void;
  newSupplierPhone: string;
  setNewSupplierPhone: (phone: string) => void;
  addSupplier: () => void;
  addBatch: () => Promise<void>;
  // Prefill handlers
  applyExchangeOrderPrefill: (prefill: any) => void;
  applyExchangeTransferPrefill: (prefill: ExchangeTransferPayload) => void;
  // Edit & Details
  setEditingBatchId: (id: string | null) => void;
  setEditDate: (d: string) => void;
  setEditSource: (s: string) => void;
  setEditSupplierCustom: (c: string) => void;
  setEditQty: (q: string) => void;
  setEditPrice: (p: string) => void;
  setEditNote: (n: string) => void;
  // Delete / Split
  onDeleteBatch: (batchId: string) => void;
  onSplitBatch: (batchId: string) => void;
  // Formatters & Translations
  t: (key: any) => string;
}

export function ModernStockView({
  state,
  perf,
  availableUsdt,
  wacop,
  monthAvgBuyPrice,
  activeFifoBatch,
  exchangeUsdtTotals,
  exchangeUsdtTotal,
  reconciliationDelta,
  reconciliationMismatch,
  selectedMonth,
  setSelectedMonth,
  availableMonths,
  baseFiat,
  supplierOptions,
  activeAccounts,
  accountBalances,
  fundingAccountId,
  setFundingAccountId,
  batchDate,
  setBatchDate,
  batchEntryMode,
  setBatchEntryMode,
  batchMode,
  batchPrice,
  setBatchPrice,
  batchAmount,
  setBatchAmount,
  batchUsdtQty,
  setBatchUsdtQty,
  batchSupplier,
  setBatchSupplier,
  batchNote,
  setBatchNote,
  batchMsg,
  setBatchMsg,
  addBatchSheetOpen,
  setAddBatchSheetOpen,
  supplierAddOpen,
  setSupplierAddOpen,
  newSupplierName,
  setNewSupplierName,
  newSupplierPhone,
  setNewSupplierPhone,
  addSupplier,
  addBatch,
  applyExchangeOrderPrefill,
  applyExchangeTransferPrefill,
  setEditingBatchId,
  setEditDate,
  setEditSource,
  setEditSupplierCustom,
  setEditQty,
  setEditPrice,
  setEditNote,
  onDeleteBatch,
  onSplitBatch,
}: ModernStockViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupplierFilter, setSelectedSupplierFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'depleted'>('all');
  const [suppliersModalOpen, setSuppliersModalOpen] = useState(false);
  const [reconciliationModalOpen, setReconciliationModalOpen] = useState(false);
  const [selectedBatchDetails, setSelectedBatchDetails] = useState<any | null>(null);

  // Keyboard shortcut CMD+B or CTRL+B to open Add Batch Drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setAddBatchSheetOpen(!addBatchSheetOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addBatchSheetOpen, setAddBatchSheetOpen]);

  // Unassigned exchange deposits (buy-side P2P orders / incoming Pay-transfers
  // not yet linked to a batch) -- surfaced as a banner so nothing sits unlogged.
  const { data: exchangeOrdersForBanner } = useExchangeP2POrders();
  const { data: exchangeTransfersForBanner } = useExchangeTransfers();
  const pendingExchangeDeposits = useMemo(() => {
    const orders = (exchangeOrdersForBanner ?? []).filter((o) => o.side === 'buy' && !o.linked_at);
    const transfers = (exchangeTransfersForBanner ?? []).filter((t) => t.direction === 'in' && !t.linked_at);
    const volume = orders.reduce((s, o) => s + o.amount, 0) + transfers.reduce((s, t) => s + t.amount, 0);
    return { count: orders.length + transfers.length, volume };
  }, [exchangeOrdersForBanner, exchangeTransfersForBanner]);

  // Filtered rows for the full-width table
  const filteredBatches = useMemo(() => {
    return perf.filter((b) => {
      // Supplier filter
      if (selectedSupplierFilter !== 'all' && b.source.toLowerCase() !== selectedSupplierFilter.toLowerCase()) {
        return false;
      }
      // Status filter
      if (statusFilter === 'active' && b.remaining <= 1e-6) return false;
      if (statusFilter === 'depleted' && b.remaining > 1e-6) return false;
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const str = `${b.id} ${b.source} ${b.note || ''} ${fmtDate(b.ts)}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    });
  }, [perf, selectedSupplierFilter, statusFilter, searchQuery]);

  // Top 5 frequent suppliers
  const frequentSuppliers = useMemo(() => {
    const counts = new Map<string, number>();
    state.batches.forEach((b) => {
      const s = (b.source || '').trim();
      if (s) counts.set(s, (counts.get(s) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s);
  }, [state.batches]);

  // Dynamic cost preview in Add Batch drawer
  const calculatedTotalCost = useMemo(() => {
    const px = parseFloat(batchPrice) || 0;
    if (batchEntryMode === 'price_vol') {
      const amt = parseFloat(batchAmount) || 0;
      return amt;
    } else if (batchEntryMode === 'qty_total') {
      const amt = parseFloat(batchAmount) || 0;
      return amt;
    } else {
      const qty = parseFloat(batchUsdtQty) || 0;
      return qty * px;
    }
  }, [batchPrice, batchAmount, batchUsdtQty, batchEntryMode]);

  // Dynamic USDT volume preview in Add Batch drawer
  const calculatedUsdtVolume = useMemo(() => {
    const px = parseFloat(batchPrice) || 0;
    if (batchEntryMode === 'price_vol') {
      const amt = parseFloat(batchAmount) || 0;
      return px > 0 ? (batchMode === 'USDT' ? amt : amt / px) : 0;
    } else if (batchEntryMode === 'qty_total') {
      return parseFloat(batchUsdtQty) || 0;
    } else {
      return parseFloat(batchUsdtQty) || 0;
    }
  }, [batchPrice, batchAmount, batchUsdtQty, batchEntryMode, batchMode]);

  // Total invested capital across all batches
  const totalCapitalInvested = useMemo(() => {
    return state.batches.reduce((sum, b) => sum + (b.buyPriceQAR * b.initialUSDT), 0);
  }, [state.batches]);

  // Estimated portfolio value
  const estimatedMarketValue = useMemo(() => {
    const rate = wacop > 0 ? wacop : (monthAvgBuyPrice || 3.64);
    return availableUsdt * rate;
  }, [availableUsdt, wacop, monthAvgBuyPrice]);

  return (
    <div className="w-full flex-1 flex flex-col gap-3 p-2.5 sm:p-4 bg-background text-foreground animate-in fade-in duration-150">
      
      {/* ── 1. HEADER & CONTROLS STRIP ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/70">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary flex-shrink-0" />
          <h1 className="text-base font-bold tracking-tight text-foreground">Stock Inventory & FIFO Cost Basis</h1>
          <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 rounded">
            {selectedMonth === 'all' ? 'All Cohorts' : selectedMonth}
          </span>
        </div>

        {/* Month Selector Pills */}
        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/80 overflow-x-auto max-w-full">
          <button
            onClick={() => setSelectedMonth('all')}
            className={cn(
              'px-2 py-0.5 text-[11px] font-semibold rounded-md transition-all cursor-pointer',
              selectedMonth === 'all'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All
          </button>
          {availableMonths.slice(0, 5).map((m) => (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className={cn(
                'px-2 py-0.5 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer',
                selectedMonth === m
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* ── 2. ULTRA-SLIM PRO METRIC RIBBON (Zero Wasted Space) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 bg-muted/30 p-1 rounded-xl border border-border/70 text-xs">
        
        {/* Metric 1: Available Stock */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card/80 border border-border/50">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-emerald-500/10 text-emerald-500 flex-shrink-0">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none">
                Available Stock
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono font-bold text-emerald-500 text-xs sm:text-sm">{fmtU(availableUsdt)}</span>
                <span className="text-[9px] text-emerald-500/80 font-semibold">USDT</span>
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground hidden xl:inline">
            ≈ {fmtTotal(estimatedMarketValue)} {baseFiat}
          </span>
        </div>

        {/* Metric 2: Weighted Buy Rate */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card/80 border border-border/50">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-blue-500/10 text-blue-500 flex-shrink-0">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none">
                WACOP Buy Rate
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono font-bold text-foreground text-xs sm:text-sm">{wacop > 0 ? fmtP(wacop) : '—'}</span>
                <span className="text-[9px] text-muted-foreground">{baseFiat}</span>
              </div>
            </div>
          </div>
          {monthAvgBuyPrice && (
            <span className="text-[10px] font-mono text-muted-foreground hidden xl:inline">
              Mo: {fmtP(monthAvgBuyPrice)}
            </span>
          )}
        </div>

        {/* Metric 3: Active FIFO Queue */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card/80 border border-amber-500/30">
          <div className="flex items-center gap-2 truncate">
            <div className="p-1 rounded bg-amber-500/10 text-amber-500 flex-shrink-0">
              <Clock className="h-3.5 w-3.5" />
            </div>
            <div className="truncate">
              <div className="text-[9px] font-bold text-amber-500 uppercase tracking-wider leading-none flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                FIFO #1
              </div>
              <div className="flex items-baseline gap-1 mt-0.5 truncate">
                <span className="font-bold text-foreground text-xs sm:text-sm truncate max-w-[85px]">{activeFifoBatch ? activeFifoBatch.source : 'None'}</span>
                {activeFifoBatch && <span className="text-[9px] font-mono text-muted-foreground">@{fmtP(activeFifoBatch.buyPriceQAR)}</span>}
              </div>
            </div>
          </div>
          {activeFifoBatch && (
            <span className="text-[10px] font-mono text-amber-500 font-semibold hidden xl:inline">
              {fmtU(activeFifoBatch.remaining)} rem
            </span>
          )}
        </div>

        {/* Metric 4: Capital Invested */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card/80 border border-border/50">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-indigo-500/10 text-indigo-500 flex-shrink-0">
              <Wallet className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none">
                Capital Invested
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono font-bold text-foreground text-xs sm:text-sm">{fmtTotal(totalCapitalInvested)}</span>
                <span className="text-[9px] text-muted-foreground">{baseFiat}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setReconciliationModalOpen(true)}
            className="text-[10px] font-mono font-semibold text-primary hover:underline hidden xl:flex items-center gap-0.5 cursor-pointer"
          >
            <span>{fmtU(exchangeUsdtTotal)} exch</span>
            <ArrowUpRight className="h-2.5 w-2.5" />
          </button>
        </div>

      </div>

      {/* ── 3. COMPACT ACTION & RECONCILIATION BAR ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-primary/5 border border-primary/20">
        <div className="flex items-center gap-2.5">
          <RefreshCw className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span className="text-xs text-foreground font-medium">
            Exchanges: Binance ({fmtU(exchangeUsdtTotals.binance)} USDT) · OKX ({fmtU(exchangeUsdtTotals.okx)} USDT)
          </span>
          {reconciliationMismatch ? (
            <span className="px-1.5 py-0.2 text-[9px] font-bold bg-amber-500/20 text-amber-500 rounded font-mono flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5" />
              Δ {fmtU(Math.abs(reconciliationDelta))}
            </span>
          ) : (
            <span className="px-1.5 py-0.2 text-[9px] font-bold bg-emerald-500/20 text-emerald-500 rounded font-mono flex items-center gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Synced
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setReconciliationModalOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-background hover:bg-muted text-[11px] font-semibold text-foreground border border-border transition-colors cursor-pointer"
          >
            Reconcile
          </button>
          
          <button
            onClick={() => setAddBatchSheetOpen(true)}
            className="flex items-center gap-1 px-3 py-1 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-xs transition-all cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Batch</span>
            <span className="hidden md:inline ml-1 px-1 py-0.2 bg-black/20 rounded text-[9px] font-mono">⌘B</span>
          </button>
        </div>
      </div>

      {/* ── 3b. UNASSIGNED EXCHANGE DEPOSITS BANNER ── */}
      {pendingExchangeDeposits.count > 0 && (
        <div className="rounded-2xl bg-gradient-to-r from-blue-500/10 via-indigo-500/8 to-card/60 border border-blue-500/30 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-lg shadow-blue-500/10">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/40 flex items-center justify-center text-blue-500 flex-shrink-0">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-foreground">
                  {pendingExchangeDeposits.count} Unassigned Exchange Deposit{pendingExchangeDeposits.count === 1 ? '' : 's'} Detected
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-500/20 text-blue-500 rounded font-mono">
                  {fmtU(pendingExchangeDeposits.volume)} USDT TOTAL
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Exchange P2P buys / Pay deposits awaiting batch cost basis assignment.</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-end lg:self-center">
            <button
              onClick={() => setAddBatchSheetOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>Quick-Log All {pendingExchangeDeposits.count} Batch{pendingExchangeDeposits.count === 1 ? '' : 'es'}</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setAddBatchSheetOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs font-medium border border-border transition cursor-pointer"
            >
              Review Details
            </button>
          </div>
        </div>
      )}

      {/* ── 4. FILTER & SEARCH STRIP ── */}
      <div className="rounded-xl border border-border/80 bg-card/60 p-2 flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          
          <div className="flex items-center gap-2 flex-1 max-w-lg">
            <div className="relative flex-1">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search batches, supplier, note..."
                className="w-full bg-background border border-border rounded-lg pl-8 pr-3 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Layers</option>
              <option value="active">Active Only</option>
              <option value="depleted">Depleted Only</option>
            </select>
          </div>

          <button
            onClick={() => setSuppliersModalOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-background hover:bg-muted border border-border text-[11px] font-semibold text-foreground transition-colors flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <Users className="h-3.5 w-3.5 text-amber-500" />
            <span>Suppliers ({supplierOptions.length})</span>
          </button>

        </div>

        {/* Quick Frequent Supplier Filter Chips */}
        <div className="flex items-center gap-1 pt-1.5 border-t border-border/60 overflow-x-auto text-[11px]">
          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap mr-0.5">
            Frequent:
          </span>

          <button
            onClick={() => setSelectedSupplierFilter('all')}
            className={cn(
              'px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer',
              selectedSupplierFilter === 'all'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'bg-muted/60 text-muted-foreground hover:text-foreground border border-border/60'
            )}
          >
            All
          </button>

          {frequentSuppliers.map((sup) => (
            <button
              key={sup}
              onClick={() => setSelectedSupplierFilter(sup)}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer',
                selectedSupplierFilter.toLowerCase() === sup.toLowerCase()
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-muted/60 text-muted-foreground hover:text-foreground border border-border/60'
              )}
            >
              {sup}
            </button>
          ))}
        </div>

      </div>

      {/* ── 5. FULL-WIDTH FIFO INVENTORY TABLE ── */}
      <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs flex-1 flex flex-col">
        
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 text-muted-foreground uppercase text-[9px] font-bold tracking-wider border-b border-border">
              <tr>
                <th className="py-2 px-3 w-10 text-center">#</th>
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Supplier</th>
                <th className="py-2 px-3 text-right">Stock (USDT)</th>
                <th className="py-2 px-3 text-right">Cost ({baseFiat})</th>
                <th className="py-2 px-3 text-right">Rate</th>
                <th className="py-2 px-3 w-40">FIFO Depletion</th>
                <th className="py-2 px-3 text-right">Remaining</th>
                <th className="py-2 px-3 text-center">Status</th>
                <th className="py-2 px-3 text-center w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-muted-foreground">
                    <p className="text-xs font-semibold">No stock inventory batches found.</p>
                  </td>
                </tr>
              ) : (
                filteredBatches.map((b, idx) => {
                  const percentRem = b.initialUSDT > 0 ? (b.remaining / b.initialUSDT) * 100 : 0;
                  const isFresh = percentRem > 99.9;
                  const isDepleted = b.remaining <= 1e-6;
                  const isDraining = !isFresh && !isDepleted;

                  return (
                    <tr
                      key={b.id}
                      id={`stock-${b.id}`}
                      data-stock-id={b.id}
                      className="hover:bg-muted/40 transition-colors group text-xs"
                    >
                      <td className="py-2.5 px-3 text-center font-mono">
                        <span className={cn(
                          'px-1 py-0.2 rounded text-[9px] font-bold',
                          idx === 0 && !isDepleted ? 'bg-amber-500/20 text-amber-500' : 'bg-muted text-muted-foreground'
                        )}>
                          #{idx + 1}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-semibold text-foreground">{fmtDate(b.ts)}</div>
                        <div className="text-[9px] text-muted-foreground font-mono">
                          {new Date(b.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-foreground truncate max-w-[140px]">{b.source}</span>
                          {b.source.toLowerCase().includes('binance') && (
                            <span className="px-1 py-0.2 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[8px] font-bold">
                              Binance
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-foreground whitespace-nowrap">
                        {fmtU(b.initialUSDT)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-foreground whitespace-nowrap">
                        {fmtTotal(b.initialUSDT * b.buyPriceQAR)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold text-primary whitespace-nowrap">
                        {fmtP(b.buyPriceQAR)}
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center justify-between text-[9px]">
                            <span className={cn(
                              'font-semibold font-mono',
                              isFresh ? 'text-emerald-500' : isDraining ? 'text-amber-500' : 'text-muted-foreground'
                            )}>
                              {percentRem.toFixed(0)}%
                            </span>
                            <span className="text-muted-foreground font-mono">
                              {fmtU(b.remaining)} rem
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all duration-300',
                                isFresh ? 'bg-emerald-500' : isDraining ? 'bg-amber-500' : 'bg-muted-foreground/40'
                              )}
                              style={{ width: `${Math.min(100, Math.max(0, percentRem))}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap">
                        <span className={cn(
                          isFresh ? 'text-emerald-500' : isDraining ? 'text-amber-500' : 'text-muted-foreground'
                        )}>
                          {fmtU(b.remaining)}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        {isFresh && (
                          <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[9px] font-bold">
                            Fresh
                          </span>
                        )}
                        {isDraining && (
                          <span className="px-1.5 py-0.2 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[9px] font-bold">
                            Drain
                          </span>
                        )}
                        {isDepleted && (
                          <span className="px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground border border-border text-[9px] font-bold">
                            Done
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setSelectedBatchDetails(b)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Details"
                          >
                            <Eye className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingBatchId(b.id);
                              setEditDate(new Date(b.ts).toISOString().slice(0, 16));
                              setEditSource(b.source);
                              setEditSupplierCustom(b.source);
                              setEditQty(String(b.initialUSDT));
                              setEditPrice(String(b.buyPriceQAR));
                              setEditNote(b.note || '');
                            }}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Edit"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => onSplitBatch(b.id)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Split"
                          >
                            <Split className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => onDeleteBatch(b.id)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-3 py-2 bg-muted/40 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{filteredBatches.length} batches</span>
          <span>Available: <strong className="text-emerald-500 font-mono">{fmtU(filteredBatches.reduce((s, b) => s + b.remaining, 0))} USDT</strong></span>
        </div>

      </div>

      {/* ── 6. SLIDE-OVER / MOBILE SHEET "ADD BATCH" DRAWER ── */}
      {addBatchSheetOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full sm:max-w-md bg-background border-l border-border shadow-2xl h-full flex flex-col animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >

            <div className="p-3.5 border-b border-border flex items-center justify-between bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-transparent">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-600/30 flex items-center justify-center">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Record New Stock Batch</h2>
                  <p className="text-[11px] text-muted-foreground">Add to FIFO queue with real-time cost basis</p>
                </div>
              </div>
              <button
                onClick={() => setAddBatchSheetOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {batchMsg && (
                <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
                  {batchMsg}
                </div>
              )}

              {/* Reference Rate Banner -- current weighted-avg cost basis as a one-tap starting rate */}
              {wacop > 0 && (
                <div className="p-3 rounded-xl bg-muted/60 border border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs text-foreground font-medium">Reference Rate (Avg Cost):</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-sm font-bold text-foreground">{fmtP(wacop)} {baseFiat}</span>
                    <button
                      type="button"
                      onClick={() => setBatchPrice(String(wacop))}
                      className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-500 border border-blue-500/30 text-[10px] font-semibold hover:bg-blue-500/25 transition cursor-pointer"
                    >
                      Use Rate
                    </button>
                  </div>
                </div>
              )}

              <div className="border border-border rounded-xl overflow-hidden bg-card/60">
                <ExchangeInbox
                  onPickOrder={applyExchangeOrderPrefill}
                  onPickTransfer={applyExchangeTransferPrefill}
                  selectedMonth={selectedMonth}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Entry Mode</label>
                <div className="grid grid-cols-3 gap-1.5 bg-muted p-1 rounded-xl border border-border text-center text-xs">
                  <button
                    type="button"
                    onClick={() => setBatchEntryMode('price_vol')}
                    className={cn(
                      'py-1.5 rounded-lg font-semibold transition-all cursor-pointer text-[11px]',
                      batchEntryMode === 'price_vol' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    ⚡ Rate + Vol
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchEntryMode('qty_total')}
                    className={cn(
                      'py-1.5 rounded-lg font-semibold transition-all cursor-pointer text-[11px]',
                      batchEntryMode === 'qty_total' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    USDT + Total
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchEntryMode('qty_price')}
                    className={cn(
                      'py-1.5 rounded-lg font-semibold transition-all cursor-pointer text-[11px]',
                      batchEntryMode === 'qty_price' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    USDT + Rate
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Transaction Date & Time</label>
                <input
                  type="datetime-local"
                  value={batchDate}
                  onChange={(e) => setBatchDate(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Buy Rate ({baseFiat})</label>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="3.639"
                    value={batchPrice}
                    onChange={(e) => setBatchPrice(e.target.value)}
                    className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs font-mono font-bold text-foreground focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    {batchEntryMode === 'price_vol' ? `Volume (${batchMode})` : 'USDT Volume'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="2500"
                    value={batchEntryMode === 'price_vol' ? batchAmount : batchUsdtQty}
                    onChange={(e) => {
                      if (batchEntryMode === 'price_vol') setBatchAmount(e.target.value);
                      else setBatchUsdtQty(e.target.value);
                    }}
                    className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs font-mono font-bold text-foreground focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-gradient-to-r from-blue-500/10 to-emerald-500/10 border border-border flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-blue-500 font-semibold">Est. Volume:</span>
                  <div className="font-mono font-bold text-foreground">
                    {fmtU(calculatedUsdtVolume)} USDT
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-emerald-500 font-semibold">Total Cost ({baseFiat}):</span>
                  <div className="font-mono font-bold text-base text-emerald-500">
                    {fmtTotal(calculatedTotalCost)} {baseFiat}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Supplier / Source</label>
                  <button
                    type="button"
                    onClick={() => setSupplierAddOpen(true)}
                    className="text-[11px] text-blue-500 hover:underline cursor-pointer"
                  >
                    + New Supplier
                  </button>
                </div>
                <input
                  type="text"
                  list="supplier-options-list"
                  value={batchSupplier}
                  onChange={(e) => setBatchSupplier(e.target.value)}
                  placeholder="Select or type supplier..."
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                />
                <datalist id="supplier-options-list">
                  {supplierOptions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              {activeAccounts.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">Funding Bank Account</label>
                    {fundingAccountId && fundingAccountId !== 'none' && (
                      <span className="text-[10px] text-emerald-500 font-mono">
                        Avl: {fmtTotal(accountBalances.get(fundingAccountId) || 0)}
                      </span>
                    )}
                  </div>
                  <select
                    value={fundingAccountId}
                    onChange={(e) => setFundingAccountId(e.target.value)}
                    className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  >
                    <option value="none">No auto cash deduction</option>
                    {activeAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.currency}) — Avl: {fmtTotal(accountBalances.get(acc.id) || 0)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Order Note / Reference ID</label>
                <input
                  type="text"
                  value={batchNote}
                  onChange={(e) => setBatchNote(e.target.value)}
                  placeholder="Optional notes, counterparty WhatsApp, etc."
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                />
              </div>

            </div>

            <div className="p-4 border-t border-border bg-muted/40 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setAddBatchSheetOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-muted hover:bg-muted/80 text-foreground font-semibold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addBatch}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-blue-500/25 transition cursor-pointer"
              >
                Confirm & Queue FIFO
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── 7. SUPPLIERS DIRECTORY MODAL ── */}
      <Dialog open={suppliersModalOpen} onOpenChange={setSuppliersModalOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold">
              <Users className="h-4 w-4 text-amber-500" />
              <span>Suppliers & Liquidity Providers ({supplierOptions.length})</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-1.5 max-h-[50vh] pr-1 mt-2">
            {supplierOptions.map((s) => {
              const count = state.batches.filter((b) => (b.source || '').trim().toLowerCase() === s.toLowerCase()).length;
              return (
                <div
                  key={s}
                  className="p-2.5 rounded-lg border border-border bg-card/60 hover:bg-muted/40 transition-colors flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-bold text-foreground">{s}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {count} {count === 1 ? 'Batch' : 'Batches'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedSupplierFilter(s);
                      setSuppliersModalOpen(false);
                    }}
                    className="px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold cursor-pointer"
                  >
                    Filter
                  </button>
                </div>
              );
            })}
          </div>

          <DialogFooter className="pt-2">
            <button
              onClick={() => setSuppliersModalOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-semibold hover:bg-muted/80 cursor-pointer"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 8. RECONCILIATION MODAL ── */}
      <Dialog open={reconciliationModalOpen} onOpenChange={setReconciliationModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold">
              <RefreshCw className="h-4 w-4 text-primary" />
              <span>Exchange Balance Reconciliation</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 py-1 text-xs">
            <div className={cn(
              'p-2.5 rounded-lg border font-medium flex items-center gap-2 text-xs',
              reconciliationMismatch ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
            )}>
              {reconciliationMismatch ? (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>Variance detected between local tracker and exchange balances.</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>All local inventory batches match exchange balances.</span>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Binance USDT:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(exchangeUsdtTotals.binance)}</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">OKX USDT:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(exchangeUsdtTotals.okx)}</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Local Active FIFO:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(availableUsdt)}</span>
              </div>
              <div className={cn(
                'p-2 rounded-lg border flex justify-between font-bold',
                reconciliationMismatch ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
              )}>
                <span>Delta:</span>
                <span className="font-mono">{fmtU(reconciliationDelta)} USDT</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => setReconciliationModalOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 cursor-pointer"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 9. BATCH DETAILS MODAL ── */}
      {selectedBatchDetails && (
        <Dialog open={!!selectedBatchDetails} onOpenChange={() => setSelectedBatchDetails(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                <Info className="h-4 w-4 text-primary" />
                <span>Batch Details · {selectedBatchDetails.id}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-1.5 py-1 text-xs">
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Date:</span>
                <span className="font-semibold text-foreground">{fmtDate(selectedBatchDetails.ts)}</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Supplier:</span>
                <span className="font-bold text-foreground">{selectedBatchDetails.source}</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Initial USDT:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(selectedBatchDetails.initialUSDT)}</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Remaining:</span>
                <span className="font-mono font-bold text-emerald-500">{fmtU(selectedBatchDetails.remaining)} USDT</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Buy Rate:</span>
                <span className="font-mono font-bold text-primary">{fmtP(selectedBatchDetails.buyPriceQAR)} {baseFiat}</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Total Cost:</span>
                <span className="font-mono font-bold text-foreground">{fmtTotal(selectedBatchDetails.initialUSDT * selectedBatchDetails.buyPriceQAR)} {baseFiat}</span>
              </div>
            </div>

            <DialogFooter>
              <button
                onClick={() => setSelectedBatchDetails(null)}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 cursor-pointer"
              >
                Close
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 10. NEW SUPPLIER MODAL ── */}
      <Dialog open={supplierAddOpen} onOpenChange={setSupplierAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold">
              <Plus className="h-4 w-4 text-primary" />
              <span>Add Supplier</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 py-1 text-xs">
            <div className="space-y-1">
              <label className="text-muted-foreground font-semibold">Supplier Name *</label>
              <input
                type="text"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="e.g. Al Rayan / Zacki"
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1">
              <label className="text-muted-foreground font-semibold">Phone / WhatsApp</label>
              <input
                type="text"
                value={newSupplierPhone}
                onChange={(e) => setNewSupplierPhone(e.target.value)}
                placeholder="+974 ..."
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              onClick={() => setSupplierAddOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-semibold hover:bg-muted/80 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={addSupplier}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 cursor-pointer"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
