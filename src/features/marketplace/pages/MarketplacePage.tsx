import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import {
  Banknote, Coins, Plus, Loader2, Send, ArrowRightLeft, Users, TrendingUp,
  Pause, Play, Trash2, X, Check, RefreshCw, Clock,
  MessageCircle, Star, BarChart3, Filter, Shield, ShieldCheck, AlertTriangle,
  PieChart, Activity, Upload, FileCheck, Eye, Download, Search,
  BadgeCheck, Award, UserCheck,
} from 'lucide-react';
import { useOtcListings, useMyOtcListings, type OtcListing, type CreateListingInput } from '../hooks/useOtcListings';
import { useOtcTrades, type OtcTrade, type SendOfferInput, type CounterOfferInput } from '../hooks/useOtcTrades';
import { useOtcEscrow } from '../hooks/useOtcEscrow';
import { useOtcDisputes, type OpenDisputeInput } from '../hooks/useOtcDisputes';
import { useSubmitReview } from '../hooks/useOtcReviews';
import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
import { useTradeHistory } from '../hooks/useTradeHistory';
import { toast } from 'sonner';

const CURRENCIES = ['QAR', 'AED', 'EGP', 'SAR', 'TRY', 'OMR', 'GEL', 'KZT'];
const PAYMENT_METHODS = ['Bank Transfer', 'Cash Handoff', 'Exchange House', 'Mobile Wallet'];

const STATUS_COLORS: Record<string, string> = {
  offered: 'bg-blue-500/10 text-blue-500',
  countered: 'bg-amber-500/10 text-amber-500',
  confirmed: 'bg-green-500/10 text-green-500',
  completed: 'bg-emerald-600/10 text-emerald-600',
  cancelled: 'bg-destructive/10 text-destructive',
  expired: 'bg-muted text-muted-foreground',
};

function fmtAmt(n: number) {
  return Math.round(n).toLocaleString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type T = any;

// ── Verification Badge ──
function VerificationBadge({ tier, trades, rate, t }: { tier?: string; trades?: number; rate?: number; t: T }) {
  const tr = trades ?? 0;
  const r = rate ?? 0;
  const effectiveTier = tier || (tr >= 50 && r >= 90 ? 'verified' : tr >= 10 && r >= 70 ? 'trusted' : 'new');

  if (effectiveTier === 'verified') {
    return (
      <Badge className="text-[8px] px-1 py-0 gap-0.5 bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
        <BadgeCheck className="h-2.5 w-2.5" /> {t('otcVerified')}
      </Badge>
    );
  }
  if (effectiveTier === 'trusted') {
    return (
      <Badge className="text-[8px] px-1 py-0 gap-0.5 bg-blue-500/15 text-blue-600 border-blue-500/30">
        <Award className="h-2.5 w-2.5" /> {t('otcTrusted')}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[8px] px-1 py-0 gap-0.5 text-muted-foreground">
      <UserCheck className="h-2.5 w-2.5" /> {t('otcNew')}
    </Badge>
  );
}

function ReputationBadge({ trades, rate, tier, t }: { trades: number; rate: number; tier?: string; t: T }) {
  return (
    <div className="flex items-center gap-0.5">
      <VerificationBadge tier={tier} trades={trades} rate={rate} t={t} />
      {trades > 0 && (
        <span className="text-[8px] text-muted-foreground">{trades}t · {rate.toFixed(0)}%</span>
      )}
    </div>
  );
}

export default function MarketplacePage() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userId } = useAuth();
  const { listings, isLoading: listingsLoading } = useOtcListings();
  const { myListings, isLoading: myLoading, create, update, remove } = useMyOtcListings();
  const { trades, isLoading: tradesLoading, sendOffer, counterOffer, confirmTrade, completeTrade, cancelTrade } = useOtcTrades();
  const { snapshot: qatarSnapshot } = useP2PMarketData('qatar');
  const submitReview = useSubmitReview();
  const { disputes, openDispute } = useOtcDisputes();

  const initialTab = searchParams.get('tab') || 'p2p';
  const [activeTab, setActiveTab] = useState(initialTab);

  const [tradeDirection, setTradeDirection] = useState<'buy' | 'sell'>('buy');
  const [sideFilter, setSideFilter] = useState<'all' | 'cash' | 'usdt'>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [minAmountFilter, setMinAmountFilter] = useState('');
  const [maxAmountFilter, setMaxAmountFilter] = useState('');
  const [minRateFilter, setMinRateFilter] = useState('');
  const [maxRateFilter, setMaxRateFilter] = useState('');
  const [minRatingFilter, setMinRatingFilter] = useState<number>(0);
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showOfferDialog, setShowOfferDialog] = useState<OtcListing | null>(null);
  const [showCounterDialog, setShowCounterDialog] = useState<OtcTrade | null>(null);
  const [escrowTradeId, setEscrowTradeId] = useState<string | null>(null);
  const [reviewTrade, setReviewTrade] = useState<OtcTrade | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [disputeTrade, setDisputeTrade] = useState<OtcTrade | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  const [ordersFilter, setOrdersFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [historySearch, setHistorySearch] = useState('');
  const [historyCurrency, setHistoryCurrency] = useState('all');

  const { filteredTrades: historyTrades, exportCSV } = useTradeHistory(trades, {
    status: ordersFilter === 'active' ? 'all' : ordersFilter === 'completed' ? 'completed' : 'all',
    currency: historyCurrency,
    counterparty: historySearch || undefined,
  });

  const filteredListings = useMemo(() => {
    let result = listings.filter(l => l.user_id !== userId);
    if (tradeDirection === 'buy') {
      result = result.filter(l => l.side === 'usdt');
    } else {
      result = result.filter(l => l.side === 'cash');
    }
    if (sideFilter !== 'all') result = result.filter(l => l.side === sideFilter);
    if (currencyFilter !== 'all') result = result.filter(l => l.currency === currencyFilter);
    if (methodFilter !== 'all') result = result.filter(l => l.payment_methods.includes(methodFilter));
    const minAmt = Number(minAmountFilter);
    if (minAmt > 0) result = result.filter(l => l.amount_max >= minAmt);
    const maxAmt = Number(maxAmountFilter);
    if (maxAmt > 0) result = result.filter(l => l.amount_min <= maxAmt);
    const minRate = Number(minRateFilter);
    if (minRate > 0) result = result.filter(l => l.rate >= minRate);
    const maxRate = Number(maxRateFilter);
    if (maxRate > 0) result = result.filter(l => l.rate <= maxRate);
    if (minRatingFilter > 0) result = result.filter(l => (l.otc_completion_rate ?? 0) >= minRatingFilter);
    if (tierFilter !== 'all') {
      result = result.filter(l => {
        const ct = l.otc_completed_trades ?? 0;
        const cr = l.otc_completion_rate ?? 0;
        const effectiveTier = ct >= 50 && cr >= 90 ? 'verified' : ct >= 10 && cr >= 70 ? 'trusted' : 'new';
        return effectiveTier === tierFilter;
      });
    }
    return result;
  }, [listings, userId, tradeDirection, sideFilter, currencyFilter, methodFilter, minAmountFilter, maxAmountFilter, minRateFilter, maxRateFilter, minRatingFilter, tierFilter]);

  const activeTrades = trades.filter(t => !['completed', 'cancelled', 'expired'].includes(t.status));
  const completedTrades = trades.filter(t => ['completed', 'cancelled', 'expired'].includes(t.status));

  const analytics = useMemo(() => {
    const completed = trades.filter(t => t.status === 'completed');
    const cancelled = trades.filter(t => t.status === 'cancelled');
    const totalVolume = completed.reduce((s, t) => s + (t.counter_total ?? t.total), 0);
    const completionRate = trades.length > 0 ? (completed.length / trades.length * 100) : 0;
    const byCurrency = new Map<string, { volume: number; count: number }>();
    for (const t of completed) {
      const cur = t.currency;
      const entry = byCurrency.get(cur) || { volume: 0, count: 0 };
      entry.volume += t.counter_total ?? t.total;
      entry.count++;
      byCurrency.set(cur, entry);
    }
    const byCounterparty = new Map<string, number>();
    for (const t of trades) {
      const name = t.counterparty_name || 'Unknown';
      byCounterparty.set(name, (byCounterparty.get(name) || 0) + 1);
    }
    const topCounterparties = Array.from(byCounterparty.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      completedCount: completed.length, cancelledCount: cancelled.length,
      totalVolume, completionRate, totalTrades: trades.length,
      byCurrency: Array.from(byCurrency.entries()).sort((a, b) => b[1].volume - a[1].volume),
      topCounterparties, disputeCount: disputes.length,
    };
  }, [trades, disputes]);

  const suggestedRate = qatarSnapshot?.sellAvg ?? qatarSnapshot?.buyAvg ?? null;
  const hasActiveFilters = currencyFilter !== 'all' || methodFilter !== 'all' || minAmountFilter !== '' || maxAmountFilter !== '' || minRateFilter !== '' || maxRateFilter !== '' || minRatingFilter > 0 || tierFilter !== 'all';

  return (
    <div className="p-2 sm:p-3 md:p-6 space-y-3 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg md:text-xl font-black tracking-tight truncate">
            {t('otcP2pTrading')}
          </h1>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 truncate">
            {t('otcBuySellSubtitle')}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreateDialog(true)} className="gap-1 shrink-0 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('otcPostAd')}</span>
          <span className="sm:hidden">{t('otcPost')}</span>
        </Button>
      </div>

      {/* ── Quick Stats ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-2 px-2 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-4">
        <StatCard icon={Banknote} label={t('otcCashAds')} value={listings.filter(l => l.side === 'cash').length} />
        <StatCard icon={Coins} label={t('otcUsdtAds')} value={listings.filter(l => l.side === 'usdt').length} />
        <StatCard icon={Users} label={t('otcMerchants')} value={new Set(listings.map(l => l.user_id)).size} />
        <StatCard icon={ArrowRightLeft} label={t('otcActiveTrades')} value={activeTrades.length} />
      </div>

      {/* ── Main Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-4 h-9">
          <TabsTrigger value="p2p" className="text-[10px] sm:text-xs">{t('otcP2p')}</TabsTrigger>
          <TabsTrigger value="my-ads" className="text-[10px] sm:text-xs">
            {t('otcMyAds')}{myListings.length > 0 && <Badge variant="secondary" className="ml-1 text-[9px] px-1 hidden sm:inline">{myListings.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="orders" className="text-[10px] sm:text-xs">
            {t('otcOrders')}{activeTrades.length > 0 && <Badge variant="destructive" className="ml-1 text-[9px] px-1">{activeTrades.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="stats" className="text-[10px] sm:text-xs">{t('otcStats')}</TabsTrigger>
        </TabsList>

        {/* ═══ P2P TAB ═══ */}
        <TabsContent value="p2p" className="space-y-2.5 mt-2">
          <div className="flex items-center gap-0 rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setTradeDirection('buy')}
              className={`flex-1 py-2 text-xs font-bold transition-colors ${
                tradeDirection === 'buy'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-background text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {t('otcBuyUsdt')}
            </button>
            <button
              onClick={() => setTradeDirection('sell')}
              className={`flex-1 py-2 text-xs font-bold transition-colors ${
                tradeDirection === 'sell'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {t('otcSellUsdt')}
            </button>
          </div>

          {/* Filter row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
              <SelectTrigger className="h-7 text-[10px] w-[80px]"><SelectValue placeholder={t('otcCurrency')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">{t('otcAll')}</SelectItem>
                {CURRENCIES.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {(['all', 'cash', 'usdt'] as const).map(f => (
              <Button key={f} size="sm" variant={sideFilter === f ? 'default' : 'ghost'} onClick={() => setSideFilter(f)} className="text-[9px] h-6 px-1.5">
                {f === 'all' ? t('otcAll') : f === 'cash' ? '💵' : '🪙'}
              </Button>
            ))}

            <Sheet>
              <SheetTrigger asChild>
                <Button size="sm" variant={hasActiveFilters ? 'secondary' : 'ghost'} className="text-[10px] h-6 px-2 gap-0.5 ml-auto">
                  <Filter className="h-3 w-3" />
                  {hasActiveFilters ? `(${filteredListings.length})` : t('otcFilter')}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
                <SheetHeader><SheetTitle className="text-sm">{t('otcAdvancedFilters')}</SheetTitle></SheetHeader>
                <div className="space-y-3 mt-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">{t('otcPaymentMethod')}</label>
                    <Select value={methodFilter} onValueChange={setMethodFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">{t('otcAllMethods')}</SelectItem>
                        {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">{t('otcAmountRange')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="number" placeholder={t('otcMin')} value={minAmountFilter} onChange={e => setMinAmountFilter(e.target.value)} className="h-8 text-xs" />
                      <Input type="number" placeholder={t('otcMax')} value={maxAmountFilter} onChange={e => setMaxAmountFilter(e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">{t('otcRateRange')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="number" placeholder={t('otcMinRate')} value={minRateFilter} onChange={e => setMinRateFilter(e.target.value)} className="h-8 text-xs" />
                      <Input type="number" placeholder={t('otcMaxRate')} value={maxRateFilter} onChange={e => setMaxRateFilter(e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">{t('otcMerchantTrustTier')}</label>
                    <Select value={tierFilter} onValueChange={setTierFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">{t('otcAllTiers')}</SelectItem>
                        <SelectItem value="verified" className="text-xs">✅ {t('otcVerified')}</SelectItem>
                        <SelectItem value="trusted" className="text-xs">🔷 {t('otcTrusted')}</SelectItem>
                        <SelectItem value="new" className="text-xs">🆕 {t('otcNew')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">
                      {t('otcMinCompletionRate')}: {minRatingFilter}%
                    </label>
                    <Slider value={[minRatingFilter]} onValueChange={v => setMinRatingFilter(v[0])} min={0} max={100} step={5} className="py-2" />
                  </div>
                  <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => {
                    setCurrencyFilter('all'); setMethodFilter('all'); setMinAmountFilter(''); setMaxAmountFilter('');
                    setMinRateFilter(''); setMaxRateFilter(''); setMinRatingFilter(0); setTierFilter('all');
                  }}>
                    {t('otcClearAllFilters')}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          <div className="text-[10px] text-muted-foreground">
            {filteredListings.length} {tradeDirection === 'buy' ? t('otcSellersAvailable') : t('otcBuyersAvailable')}
          </div>

          {listingsLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filteredListings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {tradeDirection === 'buy' ? t('otcNoSellersMatch') : t('otcNoBuyersMatch')}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredListings.map(listing => (
                <P2PListingCard
                  key={listing.id}
                  listing={listing}
                  direction={tradeDirection}
                  onTrade={() => setShowOfferDialog(listing)}
                  t={t}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ═══ MY ADS TAB ═══ */}
        <TabsContent value="my-ads" className="space-y-2 mt-2">
          {myLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : myListings.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-muted-foreground text-sm">{t('otcNoAdsYet')}</p>
              <Button size="sm" onClick={() => setShowCreateDialog(true)} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> {t('otcPostAd')}</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {myListings.map(listing => (
                <MyListingCard key={listing.id} listing={listing} t={t}
                  onTogglePause={() => {
                    const newStatus = listing.status === 'active' ? 'paused' : 'active';
                    update.mutate({ id: listing.id, status: newStatus }, { onSuccess: () => toast.success(newStatus === 'paused' ? t('otcAdPaused') : t('otcAdActivated')) });
                  }}
                  onDelete={() => { remove.mutate(listing.id, { onSuccess: () => toast.success(t('otcAdRemoved')) }); }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ═══ ORDERS TAB ═══ */}
        <TabsContent value="orders" className="space-y-3 mt-2">
          <div className="flex items-center gap-1.5">
            {(['active', 'completed', 'all'] as const).map(f => (
              <Button key={f} size="sm" variant={ordersFilter === f ? 'default' : 'outline'} onClick={() => setOrdersFilter(f)} className="text-[10px] h-6 px-2.5 capitalize">
                {f === 'active' ? t('otcActive') : f === 'completed' ? t('otcCompleted') : t('otcAll')}{f === 'active' && activeTrades.length > 0 ? ` (${activeTrades.length})` : ''}
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input placeholder={t('otcSearch')} value={historySearch} onChange={e => setHistorySearch(e.target.value)} className="h-6 text-[10px] pl-7 w-[100px] sm:w-[140px]" />
              </div>
              <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-0.5 px-1.5" onClick={exportCSV} disabled={trades.length === 0}>
                <Download className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {tradesLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (() => {
            const displayTrades = ordersFilter === 'active' ? activeTrades
              : ordersFilter === 'completed' ? completedTrades
              : trades;
            const filtered = historySearch
              ? displayTrades.filter(t => t.counterparty_name?.toLowerCase().includes(historySearch.toLowerCase()))
              : displayTrades;

            if (filtered.length === 0) {
              return <div className="text-center py-12 text-muted-foreground text-sm">{t('otcNoOrdersFound')}</div>;
            }

            return (
              <div className="space-y-2">
                {filtered.map(trade => (
                  <TradeCard key={trade.id} trade={trade} userId={userId!} t={t}
                    onOpenChat={(roomId) => navigate(`/chat?room=${roomId}`)}
                    onCounter={() => setShowCounterDialog(trade)}
                    onConfirm={() => confirmTrade.mutate(trade.id, { onSuccess: () => toast.success(t('otcTradeConfirmed')) })}
                    onComplete={() => completeTrade.mutate(trade.id, { onSuccess: () => toast.success(t('otcTradeCompleted')) })}
                    onCancel={() => cancelTrade.mutate(trade.id, { onSuccess: () => toast.info(t('otcTradeCancelled')) })}
                    onEscrow={() => setEscrowTradeId(trade.id)}
                    onReview={() => { setReviewTrade(trade); setReviewRating(5); setReviewComment(''); }}
                    onDispute={() => { setDisputeTrade(trade); setDisputeReason(''); }}
                  />
                ))}
              </div>
            );
          })()}
        </TabsContent>

        {/* ═══ STATS TAB ═══ */}
        <TabsContent value="stats" className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3"><div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary/60" /><div><div className="text-lg font-black">{analytics.completedCount}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('otcCompletedLabel')}</div></div></div></Card>
            <Card className="p-3"><div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary/60" /><div><div className="text-lg font-black">{fmtAmt(analytics.totalVolume)}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('otcVolume')}</div></div></div></Card>
            <Card className="p-3"><div className="flex items-center gap-2"><Star className="h-4 w-4 text-primary/60" /><div><div className="text-lg font-black">{analytics.completionRate.toFixed(0)}%</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('otcSuccessRate')}</div></div></div></Card>
            <Card className="p-3"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-primary/60" /><div><div className="text-lg font-black">{analytics.disputeCount}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('otcDisputes')}</div></div></div></Card>
          </div>

          {suggestedRate && (
            <Card className="p-3">
              <div className="text-xs">
                <span className="text-muted-foreground">{t('otcLiveP2pRate')}: </span>
                <span className="font-bold text-primary">{suggestedRate.toFixed(3)}</span>
                <span className="text-[10px] text-muted-foreground ml-1">QAR/USDT</span>
              </div>
            </Card>
          )}

          {analytics.byCurrency.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><PieChart className="h-3 w-3" /> {t('otcVolumeByCurrency')}</h3>
              {analytics.byCurrency.map(([currency, data]) => (
                <Card key={currency} className="p-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] px-1 py-0">{currency}</Badge>
                      <span className="text-xs font-bold">{data.count} {t('otcTrades')}</span>
                    </div>
                    <span className="text-xs font-black text-primary">{fmtAmt(data.volume)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${Math.min(100, (data.volume / (analytics.totalVolume || 1)) * 100)}%` }} />
                  </div>
                </Card>
              ))}
            </div>
          )}

          {analytics.topCounterparties.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> {t('otcTopCounterparties')}</h3>
              {analytics.topCounterparties.map(([name, count]) => (
                <Card key={name} className="p-2.5 flex items-center justify-between">
                  <span className="text-xs font-bold truncate max-w-[180px]">{name}</span>
                  <Badge variant="secondary" className="text-[9px] px-1.5">{count} {t('otcTrades')}</Badge>
                </Card>
              ))}
            </div>
          )}

          {disputes.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {t('otcRecentDisputes')}</h3>
              {disputes.slice(0, 3).map(d => (
                <Card key={d.id} className="p-2.5">
                  <div className="flex items-center justify-between mb-0.5">
                    <Badge className={`text-[9px] px-1 py-0 ${d.status === 'open' ? 'bg-amber-500/10 text-amber-600' : d.status === 'resolved' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{d.status}</Badge>
                    <span className="text-[9px] text-muted-foreground">{getTimeAgo(d.created_at, t)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{d.reason}</p>
                  {d.resolution_note && <p className="text-[10px] text-primary mt-0.5">{t('otcResolution')}: {d.resolution_note}</p>}
                </Card>
              ))}
            </div>
          )}

          <MarketDepthSection listings={listings} t={t} />
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ── */}
      <CreateListingDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} suggestedRate={suggestedRate} t={t}
        onCreate={(input) => { create.mutate(input, { onSuccess: () => { toast.success(t('otcAdPosted')); setShowCreateDialog(false); setActiveTab('my-ads'); }, onError: (err) => toast.error(err.message) }); }}
        isPending={create.isPending} />

      <SendOfferDialog listing={showOfferDialog} onClose={() => setShowOfferDialog(null)} t={t}
        onSend={(input) => { sendOffer.mutate(input, { onSuccess: () => { toast.success(t('otcOfferSent')); setShowOfferDialog(null); setActiveTab('orders'); }, onError: (err) => toast.error(err.message) }); }}
        isPending={sendOffer.isPending} />

      <CounterOfferDialog trade={showCounterDialog} onClose={() => setShowCounterDialog(null)} t={t}
        onCounter={(input) => { counterOffer.mutate(input, { onSuccess: () => { toast.success(t('otcCounterSent')); setShowCounterDialog(null); }, onError: (err) => toast.error(err.message) }); }}
        isPending={counterOffer.isPending} />

      <EscrowSheet tradeId={escrowTradeId} trade={trades.find(t => t.id === escrowTradeId) ?? null} userId={userId} t={t}
        onClose={() => setEscrowTradeId(null)} />

      {/* Review Dialog */}
      {reviewTrade && (
        <Dialog open={!!reviewTrade} onOpenChange={v => { if (!v) setReviewTrade(null); }}>
          <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-sm font-bold">{t('otcReviewTrade')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">{t('otcRateExperience')} <span className="font-bold text-foreground">{reviewTrade.counterparty_name}</span></div>
              <div className="flex gap-1 justify-center">
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} onClick={() => setReviewRating(s)} className={`p-1 ${s <= reviewRating ? 'text-amber-500' : 'text-muted-foreground/30'}`}>
                    <Star className="h-6 w-6 fill-current" />
                  </button>
                ))}
              </div>
              <Textarea placeholder={t('otcShareExperience')} value={reviewComment} onChange={e => setReviewComment(e.target.value)} className="text-xs min-h-[60px]" />
            </div>
            <DialogFooter>
              <Button size="sm" className="w-full gap-1.5" disabled={submitReview.isPending}
                onClick={() => {
                  const reviewedId = reviewTrade.initiator_user_id === userId ? reviewTrade.responder_user_id : reviewTrade.initiator_user_id;
                  submitReview.mutate({ trade_id: reviewTrade.id, reviewed_user_id: reviewedId, rating: reviewRating, comment: reviewComment || undefined }, {
                    onSuccess: () => { toast.success(t('otcReviewSubmitted')); setReviewTrade(null); },
                    onError: (err) => toast.error(err.message),
                  });
                }}>
                {submitReview.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
                {t('otcSubmitReview')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Dispute Dialog */}
      {disputeTrade && (
        <Dialog open={!!disputeTrade} onOpenChange={v => { if (!v) setDisputeTrade(null); }}>
          <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-sm font-bold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-500" /> {t('otcOpenDispute')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-xs bg-muted/50 rounded-lg p-2.5 space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">{t('otcTradeWithLabel')}</span><span className="font-bold">{disputeTrade.counterparty_name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('otcAmountLabel')}</span><span className="font-bold">{fmtAmt(disputeTrade.counter_amount ?? disputeTrade.amount)} {disputeTrade.currency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('otcStatusLabel')}</span><Badge className={`text-[9px] px-1 py-0 ${STATUS_COLORS[disputeTrade.status]}`}>{disputeTrade.status}</Badge></div>
              </div>
              <div className="bg-amber-500/5 rounded-lg p-2.5 text-[10px] text-amber-700 dark:text-amber-400">
                ⚠️ {t('otcDisputeWarning')}
              </div>
              <Textarea placeholder={t('otcDescribeIssue')} value={disputeReason} onChange={e => setDisputeReason(e.target.value)} className="text-xs min-h-[80px]" />
            </div>
            <DialogFooter>
              <Button size="sm" variant="destructive" className="w-full gap-1.5"
                disabled={openDispute.isPending || !disputeReason.trim()}
                onClick={() => {
                  openDispute.mutate({
                    trade_id: disputeTrade.id,
                    reason: disputeReason,
                  } as OpenDisputeInput, {
                    onSuccess: () => { toast.success(t('otcDisputeFiled')); setDisputeTrade(null); },
                    onError: (err) => toast.error(err.message),
                  });
                }}>
                {openDispute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {t('otcFileDispute')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <Card className="flex items-center gap-2 p-2 sm:p-2.5 min-w-[100px]">
      <Icon className="h-4 w-4 text-primary/60 shrink-0" />
      <div>
        <div className="text-sm sm:text-base font-black leading-tight">{value}</div>
        <div className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      </div>
    </Card>
  );
}

// ── P2P Listing Card ──
function P2PListingCard({ listing, direction, onTrade, t }: {
  listing: OtcListing; direction: 'buy' | 'sell'; onTrade: () => void; t: T;
}) {
  return (
    <Card className="p-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
              {(listing.merchant_name || listing.merchant_nickname || '?')[0]?.toUpperCase()}
            </div>
            <span className="text-xs font-bold truncate max-w-[100px]">{listing.merchant_name || listing.merchant_nickname}</span>
            <ReputationBadge trades={listing.otc_completed_trades ?? 0} rate={listing.otc_completion_rate ?? 0} t={t} />
          </div>
          <div>
            <span className="text-lg font-black text-foreground">{listing.rate.toFixed(3)}</span>
            <span className="text-[10px] text-muted-foreground ml-1">{listing.currency}/USDT</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <div>
              <span className="text-muted-foreground">{t('otcLimit')} </span>
              <span className="text-foreground font-medium">{fmtAmt(listing.amount_min)} – {fmtAmt(listing.amount_max)} {listing.currency}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {listing.payment_methods.map(m => (
              <Badge key={m} variant="outline" className="text-[8px] px-1 py-0 border-border/60">{m}</Badge>
            ))}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <Button
            size="sm"
            onClick={onTrade}
            className={`h-8 px-4 text-xs font-bold ${
              direction === 'buy'
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                : 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
            }`}
          >
            {direction === 'buy' ? t('otcBuy') : t('otcSell')}
          </Button>
          <Badge variant="outline" className="text-[8px] px-1 py-0">
            {listing.side === 'cash' ? `💵 ${t('otcCash')}` : `🪙 ${t('otcUsdt')}`}
          </Badge>
        </div>
      </div>
    </Card>
  );
}

// ── My Listing Card ──
function MyListingCard({ listing, onTogglePause, onDelete, t }: {
  listing: OtcListing; onTogglePause: () => void; onDelete: () => void; t: T;
}) {
  return (
    <Card className={`p-2.5 ${listing.status === 'paused' ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <Badge className={listing.status === 'active' ? 'bg-green-500/10 text-green-600 text-[9px] px-1 py-0' : 'bg-muted text-muted-foreground text-[9px] px-1 py-0'}>{listing.status}</Badge>
            <Badge variant="outline" className="text-[9px] px-1 py-0">{listing.side === 'cash' ? `💵 ${t('otcCash')}` : `🪙 ${t('otcUsdt')}`}</Badge>
            <Badge variant="outline" className="text-[9px] px-1 py-0">{listing.currency}</Badge>
          </div>
          <div className="text-xs">
            <span className="font-bold">{fmtAmt(listing.amount_min)} – {fmtAmt(listing.amount_max)}</span>
            <span className="mx-1.5 text-muted-foreground">@</span>
            <span className="font-bold text-primary">{listing.rate}</span>
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5">{listing.payment_methods.join(' · ') || t('otcNoMethods')}</div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onTogglePause}>
            {listing.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </Card>
  );
}

// ── Trade Card ──
function TradeCard({ trade, userId, t, onOpenChat, onCounter, onConfirm, onComplete, onCancel, onEscrow, onReview, onDispute }: {
  trade: OtcTrade; userId: string; t: T;
  onOpenChat?: (roomId: string) => void; onCounter?: () => void; onConfirm?: () => void; onComplete?: () => void; onCancel?: () => void; onEscrow?: () => void; onReview?: () => void; onDispute?: () => void;
}) {
  const isInitiator = trade.initiator_user_id === userId;
  const isActive = !['completed', 'cancelled', 'expired'].includes(trade.status);
  const finalAmount = trade.counter_amount ?? trade.amount;
  const finalRate = trade.counter_rate ?? trade.rate;
  const finalTotal = trade.counter_total ?? trade.total;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const escrowStatus = (trade as any).escrow_status as string | undefined;

  const timelineSteps = [
    { label: t('otcOffered'), done: true, ts: trade.created_at },
    { label: t('otcConfirmed'), done: ['confirmed', 'completed'].includes(trade.status), ts: trade.confirmed_at },
    { label: t('otcEscrowed'), done: escrowStatus === 'both_deposited', ts: null },
    { label: t('otcCompletedLabel'), done: trade.status === 'completed', ts: trade.completed_at },
  ];

  return (
    <Card className="p-2.5 sm:p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <Badge className={`text-[9px] px-1 py-0 ${STATUS_COLORS[trade.status] || ''}`}>{trade.status}</Badge>
            <span className="text-xs font-bold truncate max-w-[100px]">{trade.counterparty_name}</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0">{trade.side === 'cash' ? '💵' : '🪙'} {trade.currency}</Badge>
          </div>
          <div className="text-[11px]">
            <span className="font-bold">{fmtAmt(finalAmount)}</span>
            <span className="mx-1 text-muted-foreground">@</span>
            <span className="font-bold text-primary">{finalRate}</span>
            <span className="mx-1 text-muted-foreground">=</span>
            <span className="font-bold">{fmtAmt(finalTotal)} {trade.currency}</span>
          </div>
          {trade.status === 'countered' && (
            <div className="text-[10px] text-amber-500 mt-0.5">
              <RefreshCw className="inline h-2.5 w-2.5 mr-0.5" />
              {t('otcCounter')}: {fmtAmt(trade.counter_amount!)} @ {trade.counter_rate}
            </div>
          )}
          <div className="text-[9px] text-muted-foreground mt-0.5">{getTimeAgo(trade.created_at, t)}</div>
        </div>

        {isActive && (
          <div className="flex flex-col gap-0.5 shrink-0">
            {trade.status === 'offered' && !isInitiator && (
              <>
                <Button size="sm" className="h-6 text-[9px] gap-0.5" onClick={onConfirm}><Check className="h-2.5 w-2.5" /> {t('otcAccept')}</Button>
                <Button size="sm" variant="outline" className="h-6 text-[9px] gap-0.5" onClick={onCounter}><RefreshCw className="h-2.5 w-2.5" /> {t('otcCounter')}</Button>
              </>
            )}
            {trade.status === 'countered' && isInitiator && (
              <Button size="sm" className="h-6 text-[9px] gap-0.5" onClick={onConfirm}><Check className="h-2.5 w-2.5" /> {t('otcAccept')}</Button>
            )}
            {trade.status === 'confirmed' && (
              <Button size="sm" className="h-6 text-[9px] gap-0.5 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={onComplete}><Check className="h-2.5 w-2.5" /> {t('otcComplete')}</Button>
            )}
            {trade.chat_room_id && onOpenChat && (
              <Button size="sm" variant="outline" className="h-6 text-[9px] gap-0.5" onClick={() => onOpenChat(trade.chat_room_id!)}><MessageCircle className="h-2.5 w-2.5" /> {t('otcChat')}</Button>
            )}
            <Button size="sm" variant="ghost" className="h-6 text-[9px] text-destructive gap-0.5" onClick={onCancel}><X className="h-2.5 w-2.5" /> {t('otcCancel')}</Button>
            {onDispute && (
              <Button size="sm" variant="ghost" className="h-6 text-[9px] text-amber-600 gap-0.5" onClick={onDispute}><AlertTriangle className="h-2.5 w-2.5" /> {t('otcDispute')}</Button>
            )}
          </div>
        )}
        {!isActive && trade.status === 'completed' && (
          <div className="flex flex-col gap-0.5 shrink-0">
            {onReview && <Button size="sm" variant="outline" className="h-6 text-[9px] gap-0.5" onClick={onReview}><Star className="h-2.5 w-2.5" /> {t('otcReview')}</Button>}
            {onDispute && <Button size="sm" variant="ghost" className="h-6 text-[9px] text-amber-600 gap-0.5" onClick={onDispute}><AlertTriangle className="h-2.5 w-2.5" /> {t('otcDispute')}</Button>}
            {trade.chat_room_id && onOpenChat && (
              <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-0.5" onClick={() => onOpenChat(trade.chat_room_id!)}><MessageCircle className="h-2.5 w-2.5" /> {t('otcChat')}</Button>
            )}
          </div>
        )}
      </div>

      {/* Trade Progress Timeline */}
      {isActive && (
        <div className="flex items-center gap-0 px-1">
          {timelineSteps.map((step, i) => (
            <div key={step.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${step.done ? 'bg-primary border-primary' : 'border-muted-foreground/30 bg-background'}`}>
                  {step.done && <Check className="h-2 w-2 text-primary-foreground" />}
                </div>
                <span className={`text-[7px] mt-0.5 ${step.done ? 'text-primary font-bold' : 'text-muted-foreground'}`}>{step.label}</span>
              </div>
              {i < timelineSteps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-0.5 rounded-full transition-colors ${step.done ? 'bg-primary' : 'bg-muted-foreground/20'}`} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Escrow Section for Confirmed Trades */}
      {trade.status === 'confirmed' && onEscrow && (
        <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-[11px] font-bold">{t('otcEscrowProtection')}</span>
            </div>
            {escrowStatus === 'both_deposited' ? (
              <Badge className="bg-green-500/15 text-green-600 text-[9px] gap-0.5 border-green-500/30">
                <ShieldCheck className="h-2.5 w-2.5" /> {t('otcBothDeposited')}
              </Badge>
            ) : escrowStatus && escrowStatus !== 'none' ? (
              <Badge className="bg-amber-500/15 text-amber-600 text-[9px] gap-0.5 border-amber-500/30">
                <Clock className="h-2.5 w-2.5" /> {t('otcPartial')}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] gap-0.5 text-muted-foreground">
                <Clock className="h-2.5 w-2.5" /> {t('otcNotStarted')}
              </Badge>
            )}
          </div>
          <div className="flex gap-1">
            <div className={`flex-1 h-1.5 rounded-full ${escrowStatus && escrowStatus !== 'none' ? 'bg-primary' : 'bg-muted-foreground/20'}`} />
            <div className={`flex-1 h-1.5 rounded-full ${escrowStatus === 'both_deposited' ? 'bg-primary' : 'bg-muted-foreground/20'}`} />
          </div>
          <div className="flex justify-between text-[8px] text-muted-foreground">
            <span>{t('otcYouDeposit')}</span>
            <span>{t('otcCounterpartyDeposits')}</span>
          </div>
          <Button size="sm" className="w-full h-7 text-[10px] gap-1" variant={escrowStatus === 'both_deposited' ? 'outline' : 'default'} onClick={onEscrow}>
            <Shield className="h-3 w-3" />
            {escrowStatus === 'both_deposited' ? t('otcViewEscrowDetails') : escrowStatus && escrowStatus !== 'none' ? t('otcViewCompleteEscrow') : t('otcOpenEscrow')}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Escrow Sheet ──
function EscrowSheet({ tradeId, trade, userId, onClose, t }: {
  tradeId: string | null; trade: OtcTrade | null; userId: string | null; onClose: () => void; t: T;
}) {
  const { escrows, myDeposit, counterDeposit, bothDeposited, deposit } = useOtcEscrow(tradeId);
  const [paymentProof, setPaymentProof] = useState<string | null>(null);
  const [showProofPreview, setShowProofPreview] = useState(false);

  if (!tradeId || !trade || !userId) return null;

  const finalAmount = trade.counter_amount ?? trade.amount;
  const isInitiator = trade.initiator_user_id === userId;
  const myDepositDone = myDeposit?.status === 'deposited';
  const counterDepositDone = counterDeposit?.status === 'deposited';
  const progress = (myDepositDone ? 1 : 0) + (counterDepositDone ? 1 : 0);

  const handleProofUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPaymentProof(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <Sheet open={!!tradeId} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-1.5">
            <Shield className="h-4 w-4 text-primary" />
            {t('otcEscrowProtection')}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{t('otcEscrowProgress')}</span>
              <span className="font-bold text-primary">{progress}/2 {t('otcDeposits')}</span>
            </div>
            <div className="flex gap-1">
              <div className={`flex-1 h-2 rounded-full transition-colors ${myDepositDone ? 'bg-primary' : 'bg-muted'}`} />
              <div className={`flex-1 h-2 rounded-full transition-colors ${counterDepositDone ? 'bg-primary' : 'bg-muted'}`} />
            </div>
          </div>

          <div className="text-xs bg-muted/50 rounded-lg p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('otcTradeAmount')}:</span>
              <span className="font-bold">{fmtAmt(finalAmount)} {trade.side === 'cash' ? trade.currency : 'USDT'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('otcCounterparty')}:</span>
              <span className="font-bold">{trade.counterparty_name}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Card className={`p-2.5 border-2 ${myDepositDone ? 'border-primary/40 bg-primary/5' : 'border-dashed border-muted-foreground/20'}`}>
              <div className="text-center space-y-1">
                {myDepositDone ? <ShieldCheck className="h-5 w-5 text-primary mx-auto" /> : <Shield className="h-5 w-5 text-muted-foreground/40 mx-auto" />}
                <div className="text-[10px] font-bold">{t('otcYourDeposit')}</div>
                <Badge className={`text-[8px] ${myDepositDone ? 'bg-primary/10 text-primary' : ''}`} variant={myDepositDone ? 'default' : 'outline'}>
                  {myDepositDone ? `✓ ${t('otcLocked')}` : `⏳ ${t('otcPending')}`}
                </Badge>
              </div>
            </Card>
            <Card className={`p-2.5 border-2 ${counterDepositDone ? 'border-primary/40 bg-primary/5' : 'border-dashed border-muted-foreground/20'}`}>
              <div className="text-center space-y-1">
                {counterDepositDone ? <ShieldCheck className="h-5 w-5 text-primary mx-auto" /> : <Clock className="h-5 w-5 text-muted-foreground/40 mx-auto" />}
                <div className="text-[10px] font-bold">{t('otcCounterparty')}</div>
                <Badge className={`text-[8px] ${counterDepositDone ? 'bg-primary/10 text-primary' : ''}`} variant={counterDepositDone ? 'default' : 'outline'}>
                  {counterDepositDone ? `✓ ${t('otcLocked')}` : `⏳ ${t('otcWaiting')}`}
                </Badge>
              </div>
            </Card>
          </div>

          {bothDeposited && (
            <div className="text-center text-xs bg-primary/10 rounded-lg p-3 text-primary font-bold flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-4 w-4" />
              {t('otcBothDepositedSafe')}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold block">{t('otcPaymentProof')}</label>
            {paymentProof ? (
              <div className="space-y-1.5">
                <div className="relative rounded-lg overflow-hidden border bg-muted/30 cursor-pointer" onClick={() => setShowProofPreview(true)}>
                  <img src={paymentProof} alt="Payment proof" className="w-full h-32 object-cover" />
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <Eye className="h-5 w-5 text-white" />
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge className="bg-primary/10 text-primary text-[9px] gap-0.5"><FileCheck className="h-2.5 w-2.5" /> {t('otcProofAttached')}</Badge>
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] text-destructive" onClick={() => setPaymentProof(null)}>{t('otcRemove')}</Button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center gap-1.5 p-4 border-2 border-dashed border-muted-foreground/20 rounded-lg cursor-pointer hover:border-primary/40 transition-colors">
                <Upload className="h-5 w-5 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground">{t('otcUploadProof')}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleProofUpload} />
              </label>
            )}
          </div>

          {!myDepositDone ? (
            <Button className="w-full gap-1.5" size="sm"
              disabled={deposit.isPending}
              onClick={() => deposit.mutate({
                trade_id: tradeId,
                side: trade.side,
                amount: finalAmount,
                currency: trade.currency,
              }, { onSuccess: () => toast.success(t('otcEscrowDeposited')) })}
            >
              {deposit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
              {t('otcDepositToEscrow')}
            </Button>
          ) : (
            <div className="text-center text-xs text-muted-foreground py-1">
              {t('otcEscrowLocked')} {counterDepositDone ? t('otcReadyComplete') : t('otcWaitingCounterparty')}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Dialogs ──

function CreateListingDialog({ open, onClose, onCreate, isPending, suggestedRate, t }: {
  open: boolean; onClose: () => void; onCreate: (i: CreateListingInput) => void; isPending: boolean; suggestedRate?: number | null; t: T;
}) {
  const [side, setSide] = useState<'cash' | 'usdt'>('cash');
  const [currency, setCurrency] = useState('QAR');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [rate, setRate] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const toggleMethod = (m: string) => setMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-sm font-bold">{t('otcPostNewAd')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={side === 'cash' ? 'default' : 'outline'} onClick={() => setSide('cash')} className="flex-1 text-xs">💵 {t('otcIHaveCash')}</Button>
            <Button size="sm" variant={side === 'usdt' ? 'default' : 'outline'} onClick={() => setSide('usdt')} className="flex-1 text-xs">🪙 {t('otcIHaveUsdt')}</Button>
          </div>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" placeholder={t('otcMinAmount')} value={amountMin} onChange={e => setAmountMin(e.target.value)} className="h-8 text-xs" />
            <Input type="number" placeholder={t('otcMaxAmount')} value={amountMax} onChange={e => setAmountMax(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Input type="number" placeholder={`${t('otcRate')} (${currency}/USDT)`} value={rate} onChange={e => setRate(e.target.value)} className="h-8 text-xs" />
            {suggestedRate && currency === 'QAR' && (
              <button type="button" onClick={() => setRate(suggestedRate.toFixed(3))} className="text-[10px] text-primary hover:underline">
                💡 {t('otcUseMarketRate')}: {suggestedRate.toFixed(3)}
              </button>
            )}
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">{t('otcPaymentMethods')}</label>
            <div className="flex flex-wrap gap-1">
              {PAYMENT_METHODS.map(m => (
                <Badge key={m} variant={methods.includes(m) ? 'default' : 'outline'} className="cursor-pointer text-[10px] px-1.5" onClick={() => toggleMethod(m)}>{m}</Badge>
              ))}
            </div>
          </div>
          <Textarea placeholder={t('otcNote')} value={note} onChange={e => setNote(e.target.value)} className="text-xs min-h-[60px]" />
        </div>
        <DialogFooter>
          <Button onClick={() => {
            if (!amountMin || !amountMax || !rate) return toast.error(t('otcFillFields'));
            onCreate({ side, currency, amount_min: Number(amountMin), amount_max: Number(amountMax), rate: Number(rate), payment_methods: methods, note: note || undefined });
          }} disabled={isPending} size="sm" className="w-full gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t('otcPostAd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendOfferDialog({ listing, onClose, onSend, isPending, t }: {
  listing: OtcListing | null; onClose: () => void; onSend: (i: SendOfferInput) => void; isPending: boolean; t: T;
}) {
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  if (!listing) return null;
  const rateVal = Number(rate) || listing.rate;
  const amountVal = Number(amount) || 0;
  const total = amountVal * rateVal;

  return (
    <Dialog open={!!listing} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-sm font-bold">{t('otcTradeWith')} {listing.merchant_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs bg-muted/50 rounded-lg p-2.5 space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">{t('otcAd')}:</span><span className="font-bold">{listing.side === 'cash' ? `💵 ${t('otcCash')}` : `🪙 ${t('otcUsdt')}`} · {listing.currency}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t('otcLimit')}:</span><span className="font-bold">{fmtAmt(listing.amount_min)} – {fmtAmt(listing.amount_max)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t('otcRate')}:</span><span className="font-bold text-primary">{listing.rate}</span></div>
            {(listing.otc_completed_trades ?? 0) > 0 && (
              <div className="flex justify-between items-center"><span className="text-muted-foreground">{t('otcMerchant')}:</span><ReputationBadge trades={listing.otc_completed_trades ?? 0} rate={listing.otc_completion_rate ?? 0} t={t} /></div>
            )}
          </div>
          <Input type="number" placeholder={`${t('otcAmount')} (${listing.amount_min} – ${listing.amount_max})`} value={amount} onChange={e => setAmount(e.target.value)} className="h-8 text-xs" />
          <Input type="number" placeholder={`${t('otcRate')} (${t('otcDefault')}: ${listing.rate})`} value={rate} onChange={e => setRate(e.target.value)} className="h-8 text-xs" />
          {amountVal > 0 && (
            <div className="text-xs text-center p-2 bg-primary/5 rounded-lg">{t('otcTotal')}: <span className="font-bold text-primary">{fmtAmt(total)} {listing.currency}</span></div>
          )}
          <Textarea placeholder={t('otcNote')} value={note} onChange={e => setNote(e.target.value)} className="text-xs min-h-[50px]" />
        </div>
        <DialogFooter>
          <Button onClick={() => {
            if (!amountVal) return toast.error(t('otcEnterAmount'));
            onSend({ listing_id: listing.id, responder_user_id: listing.user_id, responder_merchant_id: listing.merchant_id, side: listing.side, currency: listing.currency, amount: amountVal, rate: rateVal, total, note: note || undefined });
          }} disabled={isPending} size="sm" className="w-full gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t('otcSendOffer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CounterOfferDialog({ trade, onClose, onCounter, isPending, t }: {
  trade: OtcTrade | null; onClose: () => void; onCounter: (i: CounterOfferInput) => void; isPending: boolean; t: T;
}) {
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  if (!trade) return null;
  const rateVal = Number(rate) || trade.rate;
  const amountVal = Number(amount) || trade.amount;
  const total = amountVal * rateVal;

  return (
    <Dialog open={!!trade} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-sm font-bold">{t('otcCounterOffer')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs bg-muted/50 rounded-lg p-2.5 space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">{t('otcOriginal')}:</span><span className="font-bold">{fmtAmt(trade.amount)} @ {trade.rate}</span></div>
          </div>
          <Input type="number" placeholder={`${t('otcCounterAmount')} (${trade.amount})`} value={amount} onChange={e => setAmount(e.target.value)} className="h-8 text-xs" />
          <Input type="number" placeholder={`${t('otcCounterRate')} (${trade.rate})`} value={rate} onChange={e => setRate(e.target.value)} className="h-8 text-xs" />
          <div className="text-xs text-center p-2 bg-amber-500/5 rounded-lg">{t('otcCounter')}: <span className="font-bold text-amber-600">{fmtAmt(total)} {trade.currency}</span></div>
          <Textarea placeholder={t('otcNote')} value={note} onChange={e => setNote(e.target.value)} className="text-xs min-h-[50px]" />
        </div>
        <DialogFooter>
          <Button onClick={() => { onCounter({ trade_id: trade.id, counter_amount: amountVal, counter_rate: rateVal, counter_total: total, counter_note: note || undefined }); }}
            disabled={isPending} size="sm" variant="outline" className="w-full gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t('otcSendCounter')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Market Depth Section ──
function MarketDepthSection({ listings, t }: { listings: OtcListing[]; t: T }) {
  const depthByCurrency = useMemo(() => {
    const map = new Map<string, { cashVolume: number; usdtVolume: number; cashCount: number; usdtCount: number; avgRate: number; rates: number[] }>();
    for (const l of listings) {
      if (l.status !== 'active') continue;
      const key = l.currency;
      let entry = map.get(key);
      if (!entry) { entry = { cashVolume: 0, usdtVolume: 0, cashCount: 0, usdtCount: 0, avgRate: 0, rates: [] }; map.set(key, entry); }
      const midpoint = (l.amount_min + l.amount_max) / 2;
      if (l.side === 'cash') { entry.cashVolume += midpoint; entry.cashCount++; }
      else { entry.usdtVolume += midpoint; entry.usdtCount++; }
      entry.rates.push(l.rate);
    }
    for (const [, v] of map) {
      v.avgRate = v.rates.length > 0 ? v.rates.reduce((a, b) => a + b, 0) / v.rates.length : 0;
    }
    return Array.from(map.entries()).sort((a, b) => (b[1].cashVolume + b[1].usdtVolume) - (a[1].cashVolume + a[1].usdtVolume));
  }, [listings]);

  if (depthByCurrency.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('otcMarketDepth')}</h3>
      {depthByCurrency.map(([currency, depth]) => {
        const totalVolume = depth.cashVolume + depth.usdtVolume;
        const cashPct = totalVolume > 0 ? (depth.cashVolume / totalVolume * 100) : 50;
        return (
          <Card key={currency} className="p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold">{currency}</span>
              <span className="text-[10px] text-muted-foreground">{t('otcAvgRate')}: <span className="font-bold text-primary">{depth.avgRate.toFixed(3)}</span></span>
            </div>
            <div className="flex h-4 rounded-full overflow-hidden bg-muted mb-1">
              <div className="bg-green-500/60 transition-all" style={{ width: `${cashPct}%` }} />
              <div className="bg-blue-500/60 transition-all" style={{ width: `${100 - cashPct}%` }} />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>💵 {depth.cashCount} {t('otcAds')} · {fmtAmt(depth.cashVolume)}</span>
              <span>🪙 {depth.usdtCount} {t('otcAds')} · {fmtAmt(depth.usdtVolume)}</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function getTimeAgo(dateStr: string, t?: T): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t ? t('otcJustNow') : 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
