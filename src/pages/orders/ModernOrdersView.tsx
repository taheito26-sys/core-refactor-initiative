import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  FileText,
  Plus,
  Search,
  TrendingUp,
  DollarSign,
  X,
  Wallet,
  Users,
  Eye,
  Edit2,
  Trash2,
  Download,
  AlertTriangle,
  CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fmtU,
  fmtP,
  fmtTotal,
  fmtDate,
  type TrackerState,
  type Trade,
  type Customer,
  type TradeCalcResult,
} from '@/lib/tracker-helpers';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExchangeInbox, type ExchangeTransferPayload } from '@/features/exchanges/components/ExchangeInbox';

export interface ModernOrdersViewProps {
  state: TrackerState;
  derived: any;
  trades: Trade[];
  availableStock: number;
  wacop: number;
  baseFiat: 'QAR' | 'EGP';
  activeSaleFiat: 'QAR' | 'EGP';
  currency: 'QAR' | 'EGP' | 'USDT';
  customers: Customer[];
  activeAccounts: any[];
  accountBalances: Map<string, number>;
  // Trade Form State
  saleDate: string;
  setSaleDate: (d: string) => void;
  saleEntryMode: 'price_vol' | 'qty_total' | 'qty_price';
  setSaleEntryMode: (m: 'price_vol' | 'qty_total' | 'qty_price') => void;
  saleMode: 'USDT' | 'QAR' | 'EGP';
  setSaleMode: (m: 'USDT' | 'QAR' | 'EGP') => void;
  saleSell: string;
  setSaleSell: (s: string) => void;
  saleAmount: string;
  setSaleAmount: (a: string) => void;
  saleUsdtQty: string;
  setSaleUsdtQty: (q: string) => void;
  buyerName: string;
  setBuyerName: (b: string) => void;
  buyerId: string;
  setBuyerId: (id: string) => void;
  isLoanSale: boolean;
  setIsLoanSale: (l: boolean) => void;
  saleFee: string;
  setSaleFee: (f: string) => void;
  saleMessage: string;
  setSaleMessage: (m: string) => void;
  // Drawer & Modals
  newSaleSheetOpen: boolean;
  setNewSaleSheetOpen: (open: boolean) => void;
  addBuyerOpen: boolean;
  setAddBuyerOpen: (open: boolean) => void;
  newBuyerName: string;
  setNewBuyerName: (n: string) => void;
  newBuyerPhone: string;
  setNewBuyerPhone: (p: string) => void;
  newBuyerTier: string;
  setNewBuyerTier: (t: string) => void;
  addCustomer: () => void;
  addTrade: () => Promise<void>;
  // Prefills
  applyExchangeOrderPrefill: (prefill: any) => void;
  applyExchangeTransferPrefill: (prefill: ExchangeTransferPayload) => void;
  // Edit & Delete
  setEditingTradeId: (id: string | null) => void;
  onDeleteTrade: (id: string) => void;
  // Exports
  onExportExcel: () => void;
  onExportPdf: () => void;
  t: (key: any) => string;
}

export function ModernOrdersView({
  state,
  derived,
  trades,
  availableStock,
  wacop,
  baseFiat,
  activeSaleFiat,
  currency,
  customers,
  activeAccounts,
  accountBalances,
  saleDate,
  setSaleDate,
  saleEntryMode,
  setSaleEntryMode,
  saleMode,
  setSaleMode,
  saleSell,
  setSaleSell,
  saleAmount,
  setSaleAmount,
  saleUsdtQty,
  setSaleUsdtQty,
  buyerName,
  setBuyerName,
  buyerId,
  setBuyerId,
  isLoanSale,
  setIsLoanSale,
  saleFee,
  setSaleFee,
  saleMessage,
  setSaleMessage,
  newSaleSheetOpen,
  setNewSaleSheetOpen,
  addBuyerOpen,
  setAddBuyerOpen,
  newBuyerName,
  setNewBuyerName,
  newBuyerPhone,
  setNewBuyerPhone,
  newBuyerTier,
  setNewBuyerTier,
  addCustomer,
  addTrade,
  applyExchangeOrderPrefill,
  applyExchangeTransferPrefill,
  setEditingTradeId,
  onDeleteTrade,
  onExportExcel,
  onExportPdf,
}: ModernOrdersViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerFilter, setSelectedCustomerFilter] = useState<string>('all');
  const [selectedTradeDetails, setSelectedTradeDetails] = useState<Trade | null>(null);

  // Keyboard shortcut CMD+N or CTRL+N to open New Trade Drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewSaleSheetOpen(!newSaleSheetOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [newSaleSheetOpen, setNewSaleSheetOpen]);

  // Buyer/customer name resolution — Trade only stores customerId, not a display name
  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    customers.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [customers]);
  const getBuyerName = useCallback(
    (tr: Trade) => customerNameById.get(tr.customerId) || '—',
    [customerNameById],
  );
  const getTradeTotal = (tr: Trade) => tr.amountUSDT * tr.sellPriceQAR;

  // Loans linked to trades — mirrors OrdersPage.tsx loanByTradeId
  const loanByTradeId = useMemo(() => {
    const m = new Map<string, typeof state.customerLoans[number]>();
    const deletedIds = new Set(state.deletedLoanIds || []);
    for (const loan of state.customerLoans || []) {
      if (loan.tradeId && !deletedIds.has(loan.id)) m.set(loan.tradeId, loan);
    }
    return m;
  }, [state.customerLoans, state.deletedLoanIds]);

  // Filtered trades
  const filteredTrades = useMemo(() => {
    return trades.filter((tr) => {
      const name = getBuyerName(tr);
      if (selectedCustomerFilter !== 'all' && name.toLowerCase() !== selectedCustomerFilter.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = `${tr.id} ${name} ${tr.note || ''} ${fmtDate(tr.ts)}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [trades, selectedCustomerFilter, searchQuery, getBuyerName]);

  // Aggregate Metrics for Ultra-Slim KPI Ribbon
  const metrics = useMemo(() => {
    let totalUsdtSold = 0;
    let totalRealizedProfit = 0;
    let totalGrossFiat = 0;

    filteredTrades.forEach((tr) => {
      const calc: TradeCalcResult | undefined = derived.tradeCalc?.get(tr.id);
      totalUsdtSold += tr.amountUSDT;
      totalGrossFiat += getTradeTotal(tr);
      if (calc && calc.ok) {
        totalRealizedProfit += calc.netQAR;
      }
    });

    const avgMarginPct = totalGrossFiat > 0 ? (totalRealizedProfit / totalGrossFiat) * 100 : 0;

    return {
      totalUsdtSold,
      totalRealizedProfit,
      totalTradesCount: filteredTrades.length,
      avgMarginPct,
    };
  }, [filteredTrades, derived.tradeCalc]);

  // Total Outstanding Unsettled Customer Loans
  const totalOutstandingLoan = useMemo(() => {
    return (state.customerLoans || []).reduce((acc, l) => {
      const repaid = (l.repayments || []).reduce((rSum, r) => rSum + r.amount, 0);
      return acc + Math.max(0, l.principal - repaid);
    }, 0);
  }, [state.customerLoans]);

  // Dynamic preview calculations in Drawer
  const calculatedUsdtQty = useMemo(() => {
    const px = parseFloat(saleSell) || 0;
    if (saleEntryMode === 'price_vol') {
      const amt = parseFloat(saleAmount) || 0;
      return px > 0 ? (saleMode === 'USDT' ? amt : amt / px) : 0;
    } else {
      return parseFloat(saleUsdtQty) || 0;
    }
  }, [saleSell, saleAmount, saleUsdtQty, saleEntryMode, saleMode]);

  const calculatedTotalFiat = useMemo(() => {
    const px = parseFloat(saleSell) || 0;
    if (saleEntryMode === 'price_vol') {
      const amt = parseFloat(saleAmount) || 0;
      return saleMode === 'USDT' ? amt * px : amt;
    } else if (saleEntryMode === 'qty_total') {
      return parseFloat(saleAmount) || 0;
    } else {
      const qty = parseFloat(saleUsdtQty) || 0;
      return qty * px;
    }
  }, [saleSell, saleAmount, saleUsdtQty, saleEntryMode, saleMode]);

  const estimatedProfit = useMemo(() => {
    if (calculatedUsdtQty <= 0) return 0;
    const px = parseFloat(saleSell) || 0;
    const effectiveCost = wacop > 0 ? wacop : 3.64;
    return calculatedUsdtQty * (px - effectiveCost);
  }, [calculatedUsdtQty, saleSell, wacop]);

  const isStockExceeded = calculatedUsdtQty > availableStock;

  return (
    <div className="w-full flex-1 flex flex-col gap-4 p-3 sm:p-5 bg-background text-foreground animate-in fade-in duration-150">

      {/* ── 1. HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">Trade Register</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{filteredTrades.length} fills</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onExportExcel}
            className="p-1.5 rounded-lg bg-card hover:bg-muted border border-border text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Export Excel"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={onExportPdf}
            className="p-1.5 rounded-lg bg-card hover:bg-muted border border-border text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Export PDF"
          >
            <FileText className="h-4 w-4" />
          </button>
          <button
            onClick={() => setNewSaleSheetOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Trade</span>
          </button>
        </div>
      </div>

      {/* ── 2. METRIC CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-card border border-border/80">
          <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 flex-shrink-0">
            <DollarSign className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground leading-none">Volume</div>
            <div className="font-mono font-bold text-foreground text-sm mt-1 truncate">{fmtU(metrics.totalUsdtSold)} <span className="text-[10px] font-normal text-muted-foreground">USDT</span></div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-card border border-border/80">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 flex-shrink-0">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground leading-none">Profit</div>
            <div className="font-mono font-bold text-emerald-500 text-sm mt-1 truncate">{fmtTotal(metrics.totalRealizedProfit)} <span className="text-[10px] font-normal text-muted-foreground">{baseFiat}</span></div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-card border border-border/80">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 flex-shrink-0">
            <Wallet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground leading-none">Stock</div>
            <div className="font-mono font-bold text-foreground text-sm mt-1 truncate">{fmtU(availableStock)} <span className="text-[10px] font-normal text-muted-foreground">USDT</span></div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-card border border-border/80">
          <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 flex-shrink-0">
            <CreditCard className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground leading-none">Receivables</div>
            <div className="font-mono font-bold text-amber-500 text-sm mt-1 truncate">{fmtTotal(totalOutstandingLoan)} <span className="text-[10px] font-normal text-muted-foreground">{baseFiat}</span></div>
          </div>
        </div>
      </div>

      {/* ── 3. FILTER & SEARCH STRIP ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-card border border-border rounded-lg pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
          value={selectedCustomerFilter}
          onChange={(e) => setSelectedCustomerFilter(e.target.value)}
          className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary max-w-[160px]"
        >
          <option value="all">All customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* ── 4. ORDERS TABLE ── */}
      <div className="rounded-xl border border-border/80 bg-card overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground uppercase text-[10px] font-semibold tracking-wide border-b border-border">
              <tr>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Customer</th>
                <th className="py-2.5 px-3 text-right">Volume</th>
                <th className="py-2.5 px-3 text-right">Price</th>
                <th className="py-2.5 px-3 text-right">Total</th>
                <th className="py-2.5 px-3 text-right">Profit</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-center w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredTrades.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted-foreground text-xs">
                    No trades found.
                  </td>
                </tr>
              ) : (
                filteredTrades.map((tr) => {
                  const calc: TradeCalcResult | undefined = derived.tradeCalc?.get(tr.id);
                  const isPositiveProfit = calc && calc.netQAR >= 0;
                  const buyerName = getBuyerName(tr);
                  const tradeTotal = getTradeTotal(tr);
                  const loan = loanByTradeId.get(tr.id);

                  return (
                    <tr key={tr.id} className="hover:bg-muted/40 transition-colors group">
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-medium text-foreground">{fmtDate(tr.ts)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(tr.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="font-medium text-foreground truncate max-w-[140px]">{buyerName}</div>
                        {tr.note && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={tr.note}>
                            {tr.note}
                          </p>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono text-foreground whitespace-nowrap">
                        {fmtU(tr.amountUSDT)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono text-foreground whitespace-nowrap">
                        {fmtP(tr.sellPriceQAR)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono text-foreground whitespace-nowrap">
                        {fmtTotal(tradeTotal)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold whitespace-nowrap">
                        {calc && calc.ok ? (
                          <span className={isPositiveProfit ? 'text-emerald-500' : 'text-rose-500'}>
                            {isPositiveProfit ? '+' : ''}{fmtTotal(calc.netQAR)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {loan ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-semibold">
                            {loan.status === 'closed' ? 'Settled' : 'Loan'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-semibold">
                            Cash
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setSelectedTradeDetails(tr)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingTradeId(tr.id)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteTrade(tr.id)}
                            className="p-1 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 cursor-pointer"
                            title="Delete"
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
      </div>

      {/* ── 5. SLIDE-OVER / MOBILE SHEET "NEW TRADE" DRAWER ── */}
      {newSaleSheetOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full sm:max-w-md bg-background border-l border-border shadow-2xl h-full flex flex-col animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3.5 border-b border-border flex items-center justify-between bg-gradient-to-r from-violet-500/10 via-blue-500/5 to-transparent">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 text-white shadow-sm shadow-violet-500/30 flex items-center justify-center">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-foreground">Record New Trade Fill</h2>
                  <p className="text-[10px] text-muted-foreground">FIFO Depletion & Profit Tracking</p>
                </div>
              </div>
              <button
                onClick={() => setNewSaleSheetOpen(false)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {saleMessage && (
                <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
                  {saleMessage}
                </div>
              )}

              {/* Stock Coverage Warning */}
              {isStockExceeded && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>Trade volume ({fmtU(calculatedUsdtQty)} USDT) exceeds available inventory ({fmtU(availableStock)} USDT).</span>
                </div>
              )}

              {/* Exchange Inflow Picker */}
              <div className="border border-border rounded-lg overflow-hidden bg-card/60">
                <ExchangeInbox
                  onPickOrder={applyExchangeOrderPrefill}
                  onPickTransfer={applyExchangeTransferPrefill}
                />
              </div>

              {/* Entry Mode */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">Calculation Mode</label>
                <div className="grid grid-cols-3 gap-1 bg-muted p-0.5 rounded-lg text-center text-xs">
                  <button
                    type="button"
                    onClick={() => setSaleEntryMode('price_vol')}
                    className={cn(
                      'py-1 rounded font-semibold transition-all cursor-pointer text-[11px]',
                      saleEntryMode === 'price_vol' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Rate + Vol
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaleEntryMode('qty_total')}
                    className={cn(
                      'py-1 rounded font-semibold transition-all cursor-pointer text-[11px]',
                      saleEntryMode === 'qty_total' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    USDT + Total
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaleEntryMode('qty_price')}
                    className={cn(
                      'py-1 rounded font-semibold transition-all cursor-pointer text-[11px]',
                      saleEntryMode === 'qty_price' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    USDT + Rate
                  </button>
                </div>
              </div>

              {/* Date & Time */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">Trade Date & Time</label>
                <input
                  type="datetime-local"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Sell Price & Volume */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">Sell Price ({baseFiat})</label>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="e.g. 3.655"
                    value={saleSell}
                    onChange={(e) => setSaleSell(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">
                    {saleEntryMode === 'price_vol' ? `Volume (${saleMode})` : 'USDT Volume'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 1000"
                    value={saleEntryMode === 'price_vol' ? saleAmount : saleUsdtQty}
                    onChange={(e) => {
                      if (saleEntryMode === 'price_vol') setSaleAmount(e.target.value);
                      else setSaleUsdtQty(e.target.value);
                    }}
                    className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Live Gross & Profit Preview */}
              <div className="p-2.5 rounded-lg bg-gradient-to-r from-blue-500/10 to-emerald-500/10 border border-border flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-blue-500 font-semibold">Gross ({baseFiat}):</span>
                  <div className="font-mono font-bold text-foreground">
                    {fmtTotal(calculatedTotalFiat)}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-emerald-500 font-semibold">Est. Profit:</span>
                  <div className="font-mono font-bold text-emerald-500">
                    +{fmtTotal(estimatedProfit)} {baseFiat}
                  </div>
                </div>
              </div>

              {/* Customer Picker */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-muted-foreground">Customer / Counterparty</label>
                  <button
                    type="button"
                    onClick={() => setAddBuyerOpen(true)}
                    className="text-[10px] text-primary hover:underline cursor-pointer"
                  >
                    + New Customer
                  </button>
                </div>
                <input
                  type="text"
                  list="buyer-options-list"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Select or type customer name..."
                  className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <datalist id="buyer-options-list">
                  {customers.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </div>

              {/* Loan / Unsettled Toggle */}
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-foreground">Customer Loan (Credit)</div>
                  <div className="text-[10px] text-muted-foreground">Mark as unsettled receivable</div>
                </div>
                <input
                  type="checkbox"
                  checked={isLoanSale}
                  onChange={(e) => setIsLoanSale(e.target.checked)}
                  className="w-4 h-4 rounded text-primary"
                />
              </div>

            </div>

            <div className="p-3 border-t border-border bg-muted/40 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNewSaleSheetOpen(false)}
                className="flex-1 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addTrade}
                className="flex-1 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-xs cursor-pointer"
              >
                Confirm & Fill
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── 6. DETAILS MODAL ── */}
      {selectedTradeDetails && (
        <Dialog open={!!selectedTradeDetails} onOpenChange={() => setSelectedTradeDetails(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                <FileText className="h-4 w-4 text-primary" />
                <span>Trade Details · {selectedTradeDetails.id}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-1.5 py-1 text-xs">
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Date:</span>
                <span className="font-semibold text-foreground">{fmtDate(selectedTradeDetails.ts)}</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-bold text-foreground">{getBuyerName(selectedTradeDetails)}</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Volume Sold:</span>
                <span className="font-mono font-bold text-foreground">{fmtU(selectedTradeDetails.amountUSDT)} USDT</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Sell Price:</span>
                <span className="font-mono font-bold text-primary">{fmtP(selectedTradeDetails.sellPriceQAR)} {baseFiat}</span>
              </div>
              <div className="p-2 rounded-lg bg-muted/60 border border-border flex justify-between">
                <span className="text-muted-foreground">Total Revenue:</span>
                <span className="font-mono font-bold text-foreground">{fmtTotal(getTradeTotal(selectedTradeDetails))} {baseFiat}</span>
              </div>
            </div>

            <DialogFooter>
              <button
                onClick={() => setSelectedTradeDetails(null)}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 cursor-pointer"
              >
                Close
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 7. ADD BUYER MODAL ── */}
      <Dialog open={addBuyerOpen} onOpenChange={setAddBuyerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold">
              <Users className="h-4 w-4 text-primary" />
              <span>Add Customer</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 py-1 text-xs">
            <div className="space-y-1">
              <label className="text-muted-foreground font-semibold">Customer Name *</label>
              <input
                type="text"
                value={newBuyerName}
                onChange={(e) => setNewBuyerName(e.target.value)}
                placeholder="e.g. Hassan Ahmed"
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground font-semibold">Phone (Optional)</label>
              <input
                type="text"
                value={newBuyerPhone}
                onChange={(e) => setNewBuyerPhone(e.target.value)}
                placeholder="+974 ..."
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              onClick={() => setAddBuyerOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-semibold hover:bg-muted/80 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={addCustomer}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 cursor-pointer"
            >
              Save Customer
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
