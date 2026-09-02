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
    <div className="w-full flex-1 flex flex-col gap-5 p-3 md:p-6 bg-background text-foreground animate-in fade-in duration-200">
      
      {/* ── 1. MONTH SELECTOR & PRO DESK HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              <span>Stock Inventory & FIFO Cost Basis</span>
            </h1>
            <span className="hidden sm:inline-flex px-2 py-0.5 text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20 rounded-md">
              {selectedMonth === 'all' ? 'All Cohorts' : selectedMonth}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time inventory valuation, FIFO queues, and automated exchange batch settlement.
          </p>
        </div>

        {/* Month Navigation Pills */}
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/80 overflow-x-auto max-w-full">
          <button
            onClick={() => setSelectedMonth('all')}
            className={cn(
              'px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer',
              selectedMonth === 'all'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All Months
          </button>
          {availableMonths.slice(0, 5).map((m) => (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className={cn(
                'px-2.5 py-1 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer',
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

      {/* ── 2. EXECUTIVE 4-CARD KPI DECK ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        
        {/* Card 1: Available Stock */}
        <div className="rounded-2xl border border-border/80 bg-card/60 p-4 backdrop-blur-sm shadow-xs hover:border-border transition-colors">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Available Stock</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-emerald-500 tracking-tight">
              {fmtU(availableUsdt)}
            </span>
            <span className="text-xs font-bold text-emerald-500/80">USDT</span>
          </div>
          <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Est. Market Value:</span>
            <span className="font-mono font-semibold text-foreground">
              {fmtTotal(estimatedMarketValue)} {baseFiat}
            </span>
          </div>
        </div>

        {/* Card 2: Weighted Cost Basis */}
        <div className="rounded-2xl border border-border/80 bg-card/60 p-4 backdrop-blur-sm shadow-xs hover:border-border transition-colors">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Weighted Avg Buy Rate</span>
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-foreground tracking-tight">
              {wacop > 0 ? fmtP(wacop) : '—'}
            </span>
            <span className="text-xs font-medium text-muted-foreground">{baseFiat} / USDT</span>
          </div>
          <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Month Avg Rate:</span>
            <span className="font-mono font-semibold text-foreground">
              {monthAvgBuyPrice ? fmtP(monthAvgBuyPrice) : '—'} {baseFiat}
            </span>
          </div>
        </div>

        {/* Card 3: Active FIFO Layer */}
        <div className="rounded-2xl border border-amber-500/30 bg-card/60 p-4 backdrop-blur-sm shadow-xs hover:border-amber-500/50 transition-colors">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              Active FIFO Layer
            </span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-1.5 truncate mr-2">
              <span className="text-lg font-bold text-foreground truncate">
                {activeFifoBatch ? activeFifoBatch.source : 'No Active Layer'}
              </span>
              {activeFifoBatch && (
                <span className="text-xs text-muted-foreground font-mono">
                  @ {fmtP(activeFifoBatch.buyPriceQAR)}
                </span>
              )}
            </div>
            {activeFifoBatch && (
              <span className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-400 rounded font-mono flex-shrink-0">
                QUEUE #1
              </span>
            )}
          </div>
          <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Remaining in Layer:</span>
            <span className="font-mono font-semibold text-foreground">
              {activeFifoBatch ? `${fmtU(activeFifoBatch.remaining)} USDT` : '0 USDT'}
            </span>
          </div>
        </div>

        {/* Card 4: Capital Deployed & Bank Funding */}
        <div className="rounded-2xl border border-border/80 bg-card/60 p-4 backdrop-blur-sm shadow-xs hover:border-border transition-colors">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Capital Invested</span>
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-foreground tracking-tight">
              {fmtTotal(totalCapitalInvested)}
            </span>
            <span className="text-xs font-medium text-muted-foreground">{baseFiat}</span>
          </div>
          <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Exchange Synced:</span>
            <button
              onClick={() => setReconciliationModalOpen(true)}
              className="font-mono font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{fmtU(exchangeUsdtTotal)} USDT</span>
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>

      </div>

      {/* ── 3. SMART EXCHANGE RECONCILIATION & QUICK ACTIONS BAR ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-primary/5 border border-primary/20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary flex-shrink-0">
            <RefreshCw className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-foreground">Exchange Reconciliation Status</h3>
              {reconciliationMismatch ? (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-500 rounded font-mono flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Δ {fmtU(Math.abs(reconciliationDelta))} USDT
                </span>
              ) : (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-500 rounded font-mono flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  100% Synced
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Binance ({fmtU(exchangeUsdtTotals.binance)} USDT) · OKX ({fmtU(exchangeUsdtTotals.okx)} USDT)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setReconciliationModalOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-background hover:bg-muted text-xs font-semibold text-foreground border border-border transition-colors cursor-pointer"
          >
            Reconcile Details
          </button>
          
          {/* Primary Action: Add Stock Batch */}
          <button
            onClick={() => setAddBatchSheetOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-sm transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Add Stock Batch</span>
            <span className="hidden md:inline ml-1 px-1.5 py-0.2 bg-black/20 rounded text-[9px] font-mono">⌘B</span>
          </button>
        </div>
      </div>

      {/* ── 4. SMART FILTER & SEARCH TOOLBAR ── */}
      <div className="rounded-2xl border border-border/80 bg-card/60 p-3.5 flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Left: Search Input & Status Select */}
          <div className="flex items-center gap-2.5 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search batch ID, supplier name, tx note, or date..."
                className="w-full bg-background border border-border rounded-xl pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Layers</option>
              <option value="active">Active Only</option>
              <option value="depleted">Depleted Only</option>
            </select>
          </div>

          {/* Right: Suppliers Directory Button */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSuppliersModalOpen(true)}
              className="px-3 py-2 rounded-xl bg-background hover:bg-muted border border-border text-xs font-semibold text-foreground transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Users className="h-4 w-4 text-amber-500" />
              <span>Suppliers Directory</span>
              <span className="px-1.5 py-0.2 bg-muted rounded text-[10px] text-muted-foreground font-mono">
                {supplierOptions.length}
              </span>
            </button>
          </div>

        </div>

        {/* Quick Frequent Supplier Filter Chips */}
        <div className="flex items-center gap-1.5 pt-2 border-t border-border/60 overflow-x-auto text-xs pb-1">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap mr-1">
            Frequent:
          </span>

          <button
            onClick={() => setSelectedSupplierFilter('all')}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer',
              selectedSupplierFilter === 'all'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'bg-muted/60 text-muted-foreground hover:text-foreground border border-border/60'
            )}
          >
            All Suppliers
          </button>

          {frequentSuppliers.map((sup) => (
            <button
              key={sup}
              onClick={() => setSelectedSupplierFilter(sup)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer',
                selectedSupplierFilter.toLowerCase() === sup.toLowerCase()
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-muted/60 text-muted-foreground hover:text-foreground border border-border/60'
              )}
            >
              {sup}
            </button>
          ))}

          <button
            onClick={() => setSuppliersModalOpen(true)}
            className="px-2 py-1 text-primary hover:underline text-xs font-semibold whitespace-nowrap cursor-pointer"
          >
            + All Directory ({supplierOptions.length})
          </button>
        </div>

      </div>

      {/* ── 5. FULL-WIDTH FIFO INVENTORY TABLE ── */}
      <div className="rounded-2xl border border-border/80 bg-card overflow-hidden shadow-xs flex-1 flex flex-col">
        
        {/* Table Header Controls */}
        <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Inventory Batch Register
            </span>
            <span className="px-2 py-0.2 bg-muted rounded-full text-[10px] font-mono text-muted-foreground">
              {filteredBatches.length} {filteredBatches.length === 1 ? 'Batch' : 'Batches'}
            </span>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 text-muted-foreground uppercase text-[10px] font-bold tracking-wider border-b border-border">
              <tr>
                <th className="py-3 px-3.5 w-12 text-center">#</th>
                <th className="py-3 px-3.5">Date & Time</th>
                <th className="py-3 px-3.5">Supplier / Channel</th>
                <th className="py-3 px-3.5 text-right">Initial Stock</th>
                <th className="py-3 px-3.5 text-right">Cost Basis ({baseFiat})</th>
                <th className="py-3 px-3.5 text-right">Buy Rate</th>
                <th className="py-3 px-3.5 w-48">FIFO Depletion</th>
                <th className="py-3 px-3.5 text-right">Remaining USDT</th>
                <th className="py-3 px-3.5 text-center">Status</th>
                <th className="py-3 px-3.5 text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    <p className="text-sm font-semibold">No stock inventory batches found.</p>
                    <p className="text-xs mt-1">Adjust filters or click "+ Add Stock Batch" to record your first inventory batch.</p>
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
                      className="hover:bg-muted/40 transition-colors group"
                    >
                      <td className="py-3.5 px-3.5 text-center font-mono">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-bold',
                          idx === 0 && !isDepleted ? 'bg-amber-500/20 text-amber-500' : 'bg-muted text-muted-foreground'
                        )}>
                          #{idx + 1}
                        </span>
                      </td>

                      <td className="py-3.5 px-3.5">
                        <div className="font-semibold text-foreground">{fmtDate(b.ts)}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {new Date(b.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      <td className="py-3.5 px-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground">{b.source}</span>
                          {b.source.toLowerCase().includes('binance') && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[9px] font-bold">
                              Binance
                            </span>
                          )}
                        </div>
                        {b.note && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[180px]" title={b.note}>
                            {b.note}
                          </p>
                        )}
                      </td>

                      <td className="py-3.5 px-3.5 text-right font-mono font-semibold text-foreground">
                        {fmtU(b.initialUSDT)} <span className="text-[9px] text-muted-foreground font-sans">USDT</span>
                      </td>

                      <td className="py-3.5 px-3.5 text-right font-mono font-semibold text-foreground">
                        {fmtTotal(b.initialUSDT * b.buyPriceQAR)} <span className="text-[9px] text-muted-foreground font-sans">{baseFiat}</span>
                      </td>

                      <td className="py-3.5 px-3.5 text-right font-mono font-bold text-primary">
                        {fmtP(b.buyPriceQAR)}
                      </td>

                      <td className="py-3.5 px-3.5">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className={cn(
                              'font-semibold font-mono',
                              isFresh ? 'text-emerald-500' : isDraining ? 'text-amber-500' : 'text-muted-foreground'
                            )}>
                              {percentRem.toFixed(0)}% Left
                            </span>
                            <span className="text-muted-foreground font-mono">
                              {fmtU(b.initialUSDT - b.remaining)} filled
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

                      <td className="py-3.5 px-3.5 text-right font-mono font-bold">
                        <span className={cn(
                          isFresh ? 'text-emerald-500' : isDraining ? 'text-amber-500' : 'text-muted-foreground'
                        )}>
                          {fmtU(b.remaining)}
                        </span>
                      </td>

                      <td className="py-3.5 px-3.5 text-center">
                        {isFresh && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[9px] font-bold">
                            Fresh
                          </span>
                        )}
                        {isDraining && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[9px] font-bold">
                            Draining
                          </span>
                        )}
                        {isDepleted && (
                          <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border text-[9px] font-bold">
                            Depleted
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-3.5 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setSelectedBatchDetails(b)}
                            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="View Batch Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
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
                            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="Edit Batch"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => onSplitBatch(b.id)}
                            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="Split Batch"
                          >
                            <Split className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteBatch(b.id)}
                            className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                            title="Delete Batch"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

        {/* Table Footer Summary */}
        <div className="px-4 py-3 bg-muted/40 border-t border-border flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground gap-2">
          <div className="flex items-center gap-3">
            <span>Total Shown: <strong className="text-foreground font-mono">{filteredBatches.length}</strong></span>
            <span>•</span>
            <span>Total Available in View: <strong className="text-emerald-500 font-mono">{fmtU(filteredBatches.reduce((s, b) => s + b.remaining, 0))} USDT</strong></span>
          </div>
        </div>

      </div>

      {/* ── 6. SLIDE-OVER "ADD BATCH" DRAWER ── */}
      {addBatchSheetOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div
            className="w-full max-w-md bg-background border-l border-border shadow-2xl h-full flex flex-col animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Drawer Header */}
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Record New Stock Batch</h2>
                  <p className="text-[11px] text-muted-foreground">FIFO Queue Injection with Real-Time Pricing</p>
                </div>
              </div>
              <button
                onClick={() => setAddBatchSheetOpen(false)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer Form Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {batchMsg && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
                  {batchMsg}
                </div>
              )}

              {/* Collapsible Exchange Inbox Inflow Feed */}
              <div className="border border-border rounded-xl overflow-hidden bg-card/60">
                <ExchangeInbox
                  onPickOrder={applyExchangeOrderPrefill}
                  onPickTransfer={applyExchangeTransferPrefill}
                  selectedMonth={selectedMonth}
                />
              </div>

              {/* Mode Switcher */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Entry Calculation Mode</label>
                <div className="grid grid-cols-3 gap-1 bg-muted p-1 rounded-xl text-center text-xs">
                  <button
                    type="button"
                    onClick={() => setBatchEntryMode('price_vol')}
                    className={cn(
                      'py-1.5 rounded-lg font-semibold transition-all cursor-pointer',
                      batchEntryMode === 'price_vol' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    ⚡ Rate + Vol
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchEntryMode('qty_total')}
                    className={cn(
                      'py-1.5 rounded-lg font-semibold transition-all cursor-pointer',
                      batchEntryMode === 'qty_total' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    USDT + Total
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchEntryMode('qty_price')}
                    className={cn(
                      'py-1.5 rounded-lg font-semibold transition-all cursor-pointer',
                      batchEntryMode === 'qty_price' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    USDT + Rate
                  </button>
                </div>
              </div>

              {/* Date & Time */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Transaction Date & Time</label>
                <input
                  type="datetime-local"
                  value={batchDate}
                  onChange={(e) => setBatchDate(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Inputs based on entry mode */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Buy Rate ({baseFiat})</label>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="e.g. 3.639"
                    value={batchPrice}
                    onChange={(e) => setBatchPrice(e.target.value)}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {batchEntryMode === 'price_vol' ? `Volume (${batchMode})` : 'USDT Volume'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 2500"
                    value={batchEntryMode === 'price_vol' ? batchAmount : batchUsdtQty}
                    onChange={(e) => {
                      if (batchEntryMode === 'price_vol') setBatchAmount(e.target.value);
                      else setBatchUsdtQty(e.target.value);
                    }}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Live Auto-Calculated Totals Banner */}
              <div className="p-3 rounded-xl bg-muted/60 border border-border flex items-center justify-between text-xs">
                <div>
                  <span className="text-muted-foreground">Est. Volume:</span>
                  <div className="font-mono font-bold text-foreground">
                    {fmtU(calculatedUsdtVolume)} USDT
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-muted-foreground">Total Cost ({baseFiat}):</span>
                  <div className="font-mono font-bold text-emerald-500 text-sm">
                    {fmtTotal(calculatedTotalCost)} {baseFiat}
                  </div>
                </div>
              </div>

              {/* Supplier Dropdown */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground">Supplier / Channel</label>
                  <button
                    type="button"
                    onClick={() => setSupplierAddOpen(true)}
                    className="text-[11px] text-primary hover:underline cursor-pointer"
                  >
                    + New Supplier
                  </button>
                </div>
                <input
                  type="text"
                  list="supplier-options-list"
                  value={batchSupplier}
                  onChange={(e) => setBatchSupplier(e.target.value)}
                  placeholder="Select or type supplier name..."
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <datalist id="supplier-options-list">
                  {supplierOptions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              {/* Funding Bank Account */}
              {activeAccounts.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground">Funding Bank Account</label>
                    {fundingAccountId && fundingAccountId !== 'none' && (
                      <span className="text-[10px] text-emerald-500 font-mono">
                        Avl: {fmtTotal(accountBalances.get(fundingAccountId) || 0)} {baseFiat}
                      </span>
                    )}
                  </div>
                  <select
                    value={fundingAccountId}
                    onChange={(e) => setFundingAccountId(e.target.value)}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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

              {/* Order Note */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Note / Reference</label>
                <input
                  type="text"
                  value={batchNote}
                  onChange={(e) => setBatchNote(e.target.value)}
                  placeholder="Optional reference, counterparty note..."
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

            </div>

            {/* Drawer Footer Action Buttons */}
            <div className="p-4 border-t border-border bg-muted/40 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setAddBatchSheetOpen(false)}
                className="flex-1 py-2 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addBatch}
                className="flex-1 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-sm transition-all cursor-pointer"
              >
                Confirm & Queue FIFO
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── 7. SUPPLIERS DIRECTORY MODAL ── */}
      <Dialog open={suppliersModalOpen} onOpenChange={setSuppliersModalOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5 text-amber-500" />
              <span>Suppliers & Liquidity Counterparties</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="text-xs text-muted-foreground">
              {supplierOptions.length} registered suppliers and exchange channels.
            </span>
            <button
              onClick={() => {
                setSupplierAddOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Supplier</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 max-h-[50vh] pr-1 mt-3">
            {supplierOptions.map((s) => {
              const count = state.batches.filter((b) => (b.source || '').trim().toLowerCase() === s.toLowerCase()).length;
              return (
                <div
                  key={s}
                  className="p-3 rounded-xl border border-border bg-card/60 hover:bg-muted/40 transition-colors flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold flex items-center justify-center text-xs">
                      {s.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-foreground">{s}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {count} {count === 1 ? 'Batch Supplied' : 'Batches Supplied'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedSupplierFilter(s);
                      setSuppliersModalOpen(false);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Filter Table
                  </button>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <button
              onClick={() => setSuppliersModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-muted text-foreground text-xs font-semibold hover:bg-muted/80 cursor-pointer"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 8. RECONCILIATION MODAL ── */}
      <Dialog open={reconciliationModalOpen} onOpenChange={setReconciliationModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-5 w-5 text-primary" />
              <span>Exchange Balance Reconciliation</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className={cn(
              'p-3 rounded-xl border font-medium flex items-center gap-2',
              reconciliationMismatch ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
            )}>
              {reconciliationMismatch ? (
                <>
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>Variance detected between local tracker inventory and connected exchange balances.</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>All local inventory batches match connected exchange balances perfectly.</span>
                </>
              )}
            </div>

            <div className="space-y-2">
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Binance Spot + Funding:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(exchangeUsdtTotals.binance)} USDT</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">OKX Spot + Funding:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(exchangeUsdtTotals.okx)} USDT</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Total Connected Exchanges:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(exchangeUsdtTotal)} USDT</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Local Active FIFO Remaining:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(availableUsdt)} USDT</span>
              </div>
              <div className={cn(
                'p-2.5 rounded-xl border flex justify-between font-bold',
                reconciliationMismatch ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
              )}>
                <span>Reconciliation Delta:</span>
                <span className="font-mono">{fmtU(reconciliationDelta)} USDT</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => setReconciliationModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 cursor-pointer"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 9. BATCH DETAILS MODAL ── */}
      {selectedBatchDetails && (
        <Dialog open={!!selectedBatchDetails} onOpenChange={() => setSelectedBatchDetails(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Info className="h-5 w-5 text-primary" />
                <span>Batch Details · {selectedBatchDetails.id}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-2.5 py-2 text-xs">
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Date:</span>
                <span className="font-semibold text-foreground">{fmtDate(selectedBatchDetails.ts)}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Supplier / Channel:</span>
                <span className="font-bold text-foreground">{selectedBatchDetails.source}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Initial USDT:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(selectedBatchDetails.initialUSDT)} USDT</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Remaining USDT:</span>
                <span className="font-mono font-bold text-emerald-500">{fmtU(selectedBatchDetails.remaining)} USDT</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Buy Rate:</span>
                <span className="font-mono font-bold text-primary">{fmtP(selectedBatchDetails.buyPriceQAR)} {baseFiat}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Total Cost Basis:</span>
                <span className="font-mono font-bold text-foreground">{fmtTotal(selectedBatchDetails.initialUSDT * selectedBatchDetails.buyPriceQAR)} {baseFiat}</span>
              </div>
              {selectedBatchDetails.note && (
                <div className="p-2.5 rounded-xl bg-muted/40 border border-border">
                  <span className="text-muted-foreground block mb-1">Note:</span>
                  <p className="text-foreground text-xs">{selectedBatchDetails.note}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <button
                onClick={() => setSelectedBatchDetails(null)}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 cursor-pointer"
              >
                Close
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 10. NEW SUPPLIER MODAL ── */}
      <Dialog open={supplierAddOpen} onOpenChange={setSupplierAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus className="h-5 w-5 text-primary" />
              <span>Add New Supplier / Counterparty</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <label className="text-muted-foreground font-semibold">Supplier Name *</label>
              <input
                type="text"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="e.g. Al Rayan Trading / Zacki"
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1">
              <label className="text-muted-foreground font-semibold">Phone / WhatsApp (Optional)</label>
              <input
                type="text"
                value={newSupplierPhone}
                onChange={(e) => setNewSupplierPhone(e.target.value)}
                placeholder="+974 ..."
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              onClick={() => setSupplierAddOpen(false)}
              className="px-4 py-2 rounded-xl bg-muted text-foreground text-xs font-semibold hover:bg-muted/80 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={addSupplier}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 cursor-pointer"
            >
              Save Supplier
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
