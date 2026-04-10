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
import {
  Banknote, Coins, Plus, Loader2, Send, ArrowRightLeft, Users, TrendingUp,
  Pause, Play, Trash2, X, Check, RefreshCw, Clock,
  MessageCircle, Star, BarChart3, Filter, Shield, ShieldCheck, AlertTriangle,
  PieChart, Activity,
} from 'lucide-react';
import { useOtcListings, useMyOtcListings, type OtcListing, type CreateListingInput } from '../hooks/useOtcListings';
import { useOtcTrades, type OtcTrade, type SendOfferInput, type CounterOfferInput } from '../hooks/useOtcTrades';
import { useOtcEscrow } from '../hooks/useOtcEscrow';
import { useOtcDisputes, type OpenDisputeInput } from '../hooks/useOtcDisputes';
import { useSubmitReview } from '../hooks/useOtcReviews';
import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
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

  const initialTab = searchParams.get('tab') || 'board';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [sideFilter, setSideFilter] = useState<'all' | 'cash' | 'usdt'>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [minAmountFilter, setMinAmountFilter] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showOfferDialog, setShowOfferDialog] = useState<OtcListing | null>(null);
  const [showCounterDialog, setShowCounterDialog] = useState<OtcTrade | null>(null);
  const [escrowTradeId, setEscrowTradeId] = useState<string | null>(null);
  const [reviewTrade, setReviewTrade] = useState<OtcTrade | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [disputeTrade, setDisputeTrade] = useState<OtcTrade | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  // Filter logic
  const filteredListings = useMemo(() => {
    let result = listings.filter(l => l.user_id !== userId);
    if (sideFilter !== 'all') result = result.filter(l => l.side === sideFilter);
    if (currencyFilter !== 'all') result = result.filter(l => l.currency === currencyFilter);
    if (methodFilter !== 'all') result = result.filter(l => l.payment_methods.includes(methodFilter));
    const minAmt = Number(minAmountFilter);
    if (minAmt > 0) result = result.filter(l => l.amount_max >= minAmt);
    return result;
  }, [listings, userId, sideFilter, currencyFilter, methodFilter, minAmountFilter]);

  const activeTrades = trades.filter(t => !['completed', 'cancelled', 'expired'].includes(t.status));
  const completedTrades = trades.filter(t => ['completed', 'cancelled', 'expired'].includes(t.status));

  const analytics = useMemo(() => {
    const completed = trades.filter(t => t.status === 'completed');
    const totalVolume = completed.reduce((s, t) => s + (t.counter_total ?? t.total), 0);
    const completionRate = trades.length > 0 ? (completed.length / trades.length * 100) : 0;
    return { completedCount: completed.length, totalVolume, completionRate, totalTrades: trades.length };
  }, [trades]);

  const suggestedRate = qatarSnapshot?.sellAvg ?? qatarSnapshot?.buyAvg ?? null;
  const hasActiveFilters = currencyFilter !== 'all' || methodFilter !== 'all' || minAmountFilter !== '';

  return (
    <div className="p-2 sm:p-3 md:p-6 space-y-3 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg md:text-xl font-black tracking-tight truncate">
            OTC Marketplace
          </h1>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 truncate">
            Post liquidity, browse offers, and book trades
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreateDialog(true)} className="gap-1 shrink-0 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Post Listing</span>
          <span className="sm:hidden">Post</span>
        </Button>
      </div>

      {/* Stats — horizontal scroll on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-2 px-2 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-4">
        <StatCard icon={Banknote} label="Cash" value={listings.filter(l => l.side === 'cash').length} />
        <StatCard icon={Coins} label="USDT" value={listings.filter(l => l.side === 'usdt').length} />
        <StatCard icon={Users} label="Merchants" value={new Set(listings.map(l => l.user_id)).size} />
        <StatCard icon={ArrowRightLeft} label="Active" value={activeTrades.length} />
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-4 h-9">
          <TabsTrigger value="board" className="text-[10px] sm:text-xs">Board</TabsTrigger>
          <TabsTrigger value="my-listings" className="text-[10px] sm:text-xs">
            Mine{myListings.length > 0 && <Badge variant="secondary" className="ml-1 text-[9px] px-1 hidden sm:inline">{myListings.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="trades" className="text-[10px] sm:text-xs">
            Trades{activeTrades.length > 0 && <Badge variant="destructive" className="ml-1 text-[9px] px-1">{activeTrades.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-[10px] sm:text-xs">Stats</TabsTrigger>
        </TabsList>

        {/* Board Tab */}
        <TabsContent value="board" className="space-y-2 mt-2">
          {/* Filters row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['all', 'cash', 'usdt'] as const).map(f => (
              <Button key={f} size="sm" variant={sideFilter === f ? 'default' : 'outline'} onClick={() => setSideFilter(f)} className="text-[10px] h-6 px-2">
                {f === 'all' ? 'All' : f === 'cash' ? '💵 Cash' : '🪙 USDT'}
              </Button>
            ))}
            <Sheet>
              <SheetTrigger asChild>
                <Button size="sm" variant={hasActiveFilters ? 'secondary' : 'outline'} className="text-[10px] h-6 px-2 gap-0.5 ml-auto">
                  <Filter className="h-3 w-3" />
                  {hasActiveFilters ? 'Filtered' : 'Filter'}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[70dvh]">
                <SheetHeader><SheetTitle className="text-sm">Advanced Filters</SheetTitle></SheetHeader>
                <div className="space-y-3 mt-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">Currency</label>
                    <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">All Currencies</SelectItem>
                        {CURRENCIES.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">Payment Method</label>
                    <Select value={methodFilter} onValueChange={setMethodFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">All Methods</SelectItem>
                        {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">Min Amount</label>
                    <Input type="number" placeholder="e.g. 5000" value={minAmountFilter} onChange={e => setMinAmountFilter(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => { setCurrencyFilter('all'); setMethodFilter('all'); setMinAmountFilter(''); }}>
                    Clear Filters
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {listingsLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filteredListings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No listings match your filters.</div>
          ) : (
            <div className="space-y-2">
              {filteredListings.map(listing => (
                <ListingCard key={listing.id} listing={listing} onSendOffer={() => setShowOfferDialog(listing)} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* My Listings Tab */}
        <TabsContent value="my-listings" className="space-y-2 mt-2">
          {myLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : myListings.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-muted-foreground text-sm">You haven't posted any listings yet.</p>
              <Button size="sm" onClick={() => setShowCreateDialog(true)} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Post Listing</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {myListings.map(listing => (
                <MyListingCard key={listing.id} listing={listing}
                  onTogglePause={() => {
                    const newStatus = listing.status === 'active' ? 'paused' : 'active';
                    update.mutate({ id: listing.id, status: newStatus }, { onSuccess: () => toast.success(newStatus === 'paused' ? 'Listing paused' : 'Listing activated') });
                  }}
                  onDelete={() => { remove.mutate(listing.id, { onSuccess: () => toast.success('Listing removed') }); }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Trades Tab */}
        <TabsContent value="trades" className="space-y-3 mt-2">
          {tradesLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : trades.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No trades yet. Send an offer to get started!</div>
          ) : (
            <>
              {activeTrades.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active</h3>
                  {activeTrades.map(trade => (
                    <TradeCard key={trade.id} trade={trade} userId={userId!}
                      onOpenChat={(roomId) => navigate(`/chat?room=${roomId}`)}
                      onCounter={() => setShowCounterDialog(trade)}
                      onConfirm={() => confirmTrade.mutate(trade.id, { onSuccess: () => toast.success('Trade confirmed!') })}
                      onComplete={() => completeTrade.mutate(trade.id, { onSuccess: () => toast.success('Trade completed!') })}
                      onCancel={() => cancelTrade.mutate(trade.id, { onSuccess: () => toast.info('Trade cancelled') })}
                      onEscrow={() => setEscrowTradeId(trade.id)}
                    />
                  ))}
                </div>
              )}
              {completedTrades.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">History</h3>
                  {completedTrades.map(trade => (
                    <TradeCard key={trade.id} trade={trade} userId={userId!}
                      onOpenChat={(roomId) => navigate(`/chat?room=${roomId}`)}
                      onReview={() => { setReviewTrade(trade); setReviewRating(5); setReviewComment(''); }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3"><div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary/60" /><div><div className="text-lg font-black">{analytics.completedCount}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Completed</div></div></div></Card>
            <Card className="p-3"><div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary/60" /><div><div className="text-lg font-black">{fmtAmt(analytics.totalVolume)}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Volume</div></div></div></Card>
            <Card className="p-3"><div className="flex items-center gap-2"><Star className="h-4 w-4 text-primary/60" /><div><div className="text-lg font-black">{analytics.completionRate.toFixed(0)}%</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Rate</div></div></div></Card>
            <Card className="p-3"><div className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4 text-primary/60" /><div><div className="text-lg font-black">{analytics.totalTrades}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</div></div></div></Card>
          </div>
          {suggestedRate && (
            <Card className="p-3">
              <div className="text-xs">
                <span className="text-muted-foreground">Live P2P Rate (QAR): </span>
                <span className="font-bold text-primary">{suggestedRate.toFixed(3)}</span>
                <span className="text-[10px] text-muted-foreground ml-1">QAR/USDT</span>
              </div>
            </Card>
          )}

          {/* Market Depth */}
          <MarketDepthSection listings={listings} />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CreateListingDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} suggestedRate={suggestedRate}
        onCreate={(input) => { create.mutate(input, { onSuccess: () => { toast.success('Listing posted!'); setShowCreateDialog(false); setActiveTab('my-listings'); }, onError: (err) => toast.error(err.message) }); }}
        isPending={create.isPending} />

      <SendOfferDialog listing={showOfferDialog} onClose={() => setShowOfferDialog(null)}
        onSend={(input) => { sendOffer.mutate(input, { onSuccess: () => { toast.success('Offer sent!'); setShowOfferDialog(null); setActiveTab('trades'); }, onError: (err) => toast.error(err.message) }); }}
        isPending={sendOffer.isPending} />

      <CounterOfferDialog trade={showCounterDialog} onClose={() => setShowCounterDialog(null)}
        onCounter={(input) => { counterOffer.mutate(input, { onSuccess: () => { toast.success('Counter offer sent!'); setShowCounterDialog(null); }, onError: (err) => toast.error(err.message) }); }}
        isPending={counterOffer.isPending} />

      <EscrowSheet tradeId={escrowTradeId} trade={trades.find(t => t.id === escrowTradeId) ?? null} userId={userId}
        onClose={() => setEscrowTradeId(null)} />

      {/* Review Dialog */}
      {reviewTrade && (
        <Dialog open={!!reviewTrade} onOpenChange={v => { if (!v) setReviewTrade(null); }}>
          <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-sm font-bold">Review Trade</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">Rate your experience with <span className="font-bold text-foreground">{reviewTrade.counterparty_name}</span></div>
              <div className="flex gap-1 justify-center">
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} onClick={() => setReviewRating(s)} className={`p-1 ${s <= reviewRating ? 'text-amber-500' : 'text-muted-foreground/30'}`}>
                    <Star className="h-6 w-6 fill-current" />
                  </button>
                ))}
              </div>
              <Textarea placeholder="Share your experience (optional)" value={reviewComment} onChange={e => setReviewComment(e.target.value)} className="text-xs min-h-[60px]" />
            </div>
            <DialogFooter>
              <Button size="sm" className="w-full gap-1.5" disabled={submitReview.isPending}
                onClick={() => {
                  const reviewedId = reviewTrade.initiator_user_id === userId ? reviewTrade.responder_user_id : reviewTrade.initiator_user_id;
                  submitReview.mutate({ trade_id: reviewTrade.id, reviewed_user_id: reviewedId, rating: reviewRating, comment: reviewComment || undefined }, {
                    onSuccess: () => { toast.success('Review submitted!'); setReviewTrade(null); },
                    onError: (err) => toast.error(err.message),
                  });
                }}>
                {submitReview.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
                Submit Review
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Sub-components ──

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card className="p-2.5 min-w-[80px] shrink-0 sm:min-w-0">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary/60" />
        <div>
          <div className="text-sm font-black leading-tight">{value}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function ReputationBadge({ trades, rate }: { trades: number; rate: number }) {
  if (trades === 0) return <Badge variant="outline" className="text-[8px] px-1 py-0 gap-0.5"><Shield className="h-2.5 w-2.5" />New</Badge>;
  const color = rate >= 80 ? 'text-green-600' : rate >= 50 ? 'text-amber-500' : 'text-destructive';
  return (
    <Badge variant="outline" className={`text-[8px] px-1 py-0 gap-0.5 ${color}`}>
      <ShieldCheck className="h-2.5 w-2.5" />
      {trades} trades · {rate.toFixed(0)}%
    </Badge>
  );
}

function ListingCard({ listing, onSendOffer }: { listing: OtcListing; onSendOffer: () => void }) {
  const timeAgo = getTimeAgo(listing.updated_at);
  return (
    <Card className="p-2.5 sm:p-3 active:scale-[0.99] transition-transform">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <Badge variant="outline" className="text-[9px] px-1 py-0">{listing.side === 'cash' ? '💵 Cash' : '🪙 USDT'}</Badge>
            <span className="text-xs font-bold truncate max-w-[120px]">{listing.merchant_name}</span>
            <ReputationBadge trades={listing.otc_completed_trades ?? 0} rate={listing.otc_completion_rate ?? 0} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            <span><span className="text-muted-foreground">Amt: </span><span className="font-bold">{fmtAmt(listing.amount_min)}–{fmtAmt(listing.amount_max)}</span></span>
            <span><span className="text-muted-foreground">Rate: </span><span className="font-bold text-primary">{listing.rate}</span></span>
          </div>
          {listing.payment_methods.length > 0 && (
            <div className="flex gap-0.5 mt-1 flex-wrap">
              {listing.payment_methods.map(m => <Badge key={m} variant="secondary" className="text-[8px] px-1 py-0">{m}</Badge>)}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button size="sm" onClick={onSendOffer} className="h-7 text-[10px] gap-0.5"><Send className="h-3 w-3" /> Offer</Button>
          <span className="text-[8px] text-muted-foreground">{timeAgo}</span>
        </div>
      </div>
    </Card>
  );
}

function MyListingCard({ listing, onTogglePause, onDelete }: { listing: OtcListing; onTogglePause: () => void; onDelete: () => void }) {
  return (
    <Card className={`p-2.5 sm:p-3 ${listing.status === 'paused' ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Badge variant="outline" className="text-[9px] px-1 py-0">{listing.side === 'cash' ? '💵 Cash' : '🪙 USDT'}</Badge>
            <Badge className={`text-[9px] px-1 py-0 ${listing.status === 'active' ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>{listing.status}</Badge>
            <span className="text-xs font-bold">{listing.currency}</span>
          </div>
          <div className="text-[11px]">
            <span className="font-bold">{fmtAmt(listing.amount_min)}–{fmtAmt(listing.amount_max)}</span>
            <span className="mx-1.5 text-muted-foreground">@</span>
            <span className="font-bold text-primary">{listing.rate}</span>
          </div>
        </div>
        <div className="flex gap-0.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onTogglePause}>
            {listing.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </Card>
  );
}

function TradeCard({ trade, userId, onOpenChat, onCounter, onConfirm, onComplete, onCancel, onEscrow, onReview }: {
  trade: OtcTrade; userId: string;
  onOpenChat?: (roomId: string) => void; onCounter?: () => void; onConfirm?: () => void; onComplete?: () => void; onCancel?: () => void; onEscrow?: () => void; onReview?: () => void;
}) {
  const isInitiator = trade.initiator_user_id === userId;
  const isActive = !['completed', 'cancelled', 'expired'].includes(trade.status);
  const finalAmount = trade.counter_amount ?? trade.amount;
  const finalRate = trade.counter_rate ?? trade.rate;
  const finalTotal = trade.counter_total ?? trade.total;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const escrowStatus = (trade as any).escrow_status as string | undefined;

  return (
    <Card className="p-2.5 sm:p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <Badge className={`text-[9px] px-1 py-0 ${STATUS_COLORS[trade.status] || ''}`}>{trade.status}</Badge>
            <span className="text-xs font-bold truncate max-w-[100px]">{trade.counterparty_name}</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0">{trade.side === 'cash' ? '💵' : '🪙'} {trade.currency}</Badge>
            {escrowStatus && escrowStatus !== 'none' && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 gap-0.5 text-green-600">
                <Shield className="h-2.5 w-2.5" />
                {escrowStatus === 'both_deposited' ? 'Escrow ✓' : 'Escrow ½'}
              </Badge>
            )}
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
              Counter: {fmtAmt(trade.counter_amount!)} @ {trade.counter_rate}
            </div>
          )}
        </div>

        {isActive && (
          <div className="flex flex-col gap-0.5 shrink-0">
            {trade.status === 'offered' && !isInitiator && (
              <>
                <Button size="sm" className="h-6 text-[9px] gap-0.5" onClick={onConfirm}><Check className="h-2.5 w-2.5" /> Accept</Button>
                <Button size="sm" variant="outline" className="h-6 text-[9px] gap-0.5" onClick={onCounter}><RefreshCw className="h-2.5 w-2.5" /> Counter</Button>
              </>
            )}
            {trade.status === 'countered' && isInitiator && (
              <Button size="sm" className="h-6 text-[9px] gap-0.5" onClick={onConfirm}><Check className="h-2.5 w-2.5" /> Accept</Button>
            )}
            {trade.status === 'confirmed' && (
              <>
                <Button size="sm" className="h-6 text-[9px] gap-0.5 bg-emerald-600 hover:bg-emerald-700" onClick={onComplete}><Check className="h-2.5 w-2.5" /> Complete</Button>
                {onEscrow && (
                  <Button size="sm" variant="outline" className="h-6 text-[9px] gap-0.5" onClick={onEscrow}><Shield className="h-2.5 w-2.5" /> Escrow</Button>
                )}
              </>
            )}
            {trade.chat_room_id && onOpenChat && (
              <Button size="sm" variant="outline" className="h-6 text-[9px] gap-0.5" onClick={() => onOpenChat(trade.chat_room_id!)}><MessageCircle className="h-2.5 w-2.5" /> Chat</Button>
            )}
            <Button size="sm" variant="ghost" className="h-6 text-[9px] text-destructive gap-0.5" onClick={onCancel}><X className="h-2.5 w-2.5" /> Cancel</Button>
          </div>
        )}
        {!isActive && trade.status === 'completed' && onReview && (
          <div className="flex flex-col gap-0.5 shrink-0">
            <Button size="sm" variant="outline" className="h-6 text-[9px] gap-0.5" onClick={onReview}><Star className="h-2.5 w-2.5" /> Review</Button>
            {trade.chat_room_id && onOpenChat && (
              <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-0.5" onClick={() => onOpenChat(trade.chat_room_id!)}><MessageCircle className="h-2.5 w-2.5" /> Chat</Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Escrow Sheet ──
function EscrowSheet({ tradeId, trade, userId, onClose }: {
  tradeId: string | null; trade: OtcTrade | null; userId: string | null; onClose: () => void;
}) {
  const { escrows, myDeposit, counterDeposit, bothDeposited, deposit } = useOtcEscrow(tradeId);

  if (!tradeId || !trade || !userId) return null;

  const finalAmount = trade.counter_amount ?? trade.amount;
  const isInitiator = trade.initiator_user_id === userId;

  return (
    <Sheet open={!!tradeId} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[80dvh]">
        <SheetHeader><SheetTitle className="text-sm">Escrow for Trade</SheetTitle></SheetHeader>
        <div className="space-y-3 mt-3">
          <div className="text-xs bg-muted/50 rounded-lg p-3 space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">Amount:</span><span className="font-bold">{fmtAmt(finalAmount)} {trade.side === 'cash' ? trade.currency : 'USDT'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Your deposit:</span>
              {myDeposit?.status === 'deposited' ? (
                <Badge className="bg-green-500/10 text-green-600 text-[9px]"><ShieldCheck className="h-2.5 w-2.5 mr-0.5" />Deposited</Badge>
              ) : (
                <Badge variant="outline" className="text-[9px]"><Clock className="h-2.5 w-2.5 mr-0.5" />Pending</Badge>
              )}
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Counterparty:</span>
              {counterDeposit?.status === 'deposited' ? (
                <Badge className="bg-green-500/10 text-green-600 text-[9px]"><ShieldCheck className="h-2.5 w-2.5 mr-0.5" />Deposited</Badge>
              ) : (
                <Badge variant="outline" className="text-[9px]"><Clock className="h-2.5 w-2.5 mr-0.5" />Waiting</Badge>
              )}
            </div>
          </div>

          {bothDeposited && (
            <div className="text-center text-xs bg-green-500/10 rounded-lg p-2.5 text-green-600 font-bold">
              ✅ Both parties deposited — trade can be completed safely
            </div>
          )}

          {!myDeposit || myDeposit.status !== 'deposited' ? (
            <Button className="w-full gap-1.5" size="sm"
              disabled={deposit.isPending}
              onClick={() => deposit.mutate({
                trade_id: tradeId,
                side: trade.side,
                amount: finalAmount,
                currency: trade.currency,
              }, { onSuccess: () => toast.success('Escrow deposited!') })}
            >
              {deposit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
              Deposit to Escrow
            </Button>
          ) : (
            <div className="text-center text-xs text-muted-foreground">Your escrow is locked. Waiting for counterparty.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Dialogs ──

function CreateListingDialog({ open, onClose, onCreate, isPending, suggestedRate }: {
  open: boolean; onClose: () => void; onCreate: (i: CreateListingInput) => void; isPending: boolean; suggestedRate?: number | null;
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
        <DialogHeader><DialogTitle className="text-sm font-bold">Post New Listing</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={side === 'cash' ? 'default' : 'outline'} onClick={() => setSide('cash')} className="flex-1 text-xs">💵 I have Cash</Button>
            <Button size="sm" variant={side === 'usdt' ? 'default' : 'outline'} onClick={() => setSide('usdt')} className="flex-1 text-xs">🪙 I have USDT</Button>
          </div>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" placeholder="Min amount" value={amountMin} onChange={e => setAmountMin(e.target.value)} className="h-8 text-xs" />
            <Input type="number" placeholder="Max amount" value={amountMax} onChange={e => setAmountMax(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Input type="number" placeholder={`Rate (${currency}/USDT)`} value={rate} onChange={e => setRate(e.target.value)} className="h-8 text-xs" />
            {suggestedRate && currency === 'QAR' && (
              <button type="button" onClick={() => setRate(suggestedRate.toFixed(3))} className="text-[10px] text-primary hover:underline">
                💡 Use P2P market rate: {suggestedRate.toFixed(3)}
              </button>
            )}
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">Payment Methods</label>
            <div className="flex flex-wrap gap-1">
              {PAYMENT_METHODS.map(m => (
                <Badge key={m} variant={methods.includes(m) ? 'default' : 'outline'} className="cursor-pointer text-[10px] px-1.5" onClick={() => toggleMethod(m)}>{m}</Badge>
              ))}
            </div>
          </div>
          <Textarea placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="text-xs min-h-[60px]" />
        </div>
        <DialogFooter>
          <Button onClick={() => {
            if (!amountMin || !amountMax || !rate) return toast.error('Fill all required fields');
            onCreate({ side, currency, amount_min: Number(amountMin), amount_max: Number(amountMax), rate: Number(rate), payment_methods: methods, note: note || undefined });
          }} disabled={isPending} size="sm" className="w-full gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Post Listing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendOfferDialog({ listing, onClose, onSend, isPending }: {
  listing: OtcListing | null; onClose: () => void; onSend: (i: SendOfferInput) => void; isPending: boolean;
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
        <DialogHeader><DialogTitle className="text-sm font-bold">Send Offer to {listing.merchant_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs bg-muted/50 rounded-lg p-2.5 space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Listing:</span><span className="font-bold">{listing.side === 'cash' ? '💵 Cash' : '🪙 USDT'} · {listing.currency}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Range:</span><span className="font-bold">{fmtAmt(listing.amount_min)} – {fmtAmt(listing.amount_max)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Rate:</span><span className="font-bold text-primary">{listing.rate}</span></div>
            {(listing.otc_completed_trades ?? 0) > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Reputation:</span><ReputationBadge trades={listing.otc_completed_trades ?? 0} rate={listing.otc_completion_rate ?? 0} /></div>
            )}
          </div>
          <Input type="number" placeholder={`Amount (${listing.amount_min} – ${listing.amount_max})`} value={amount} onChange={e => setAmount(e.target.value)} className="h-8 text-xs" />
          <Input type="number" placeholder={`Rate (default: ${listing.rate})`} value={rate} onChange={e => setRate(e.target.value)} className="h-8 text-xs" />
          {amountVal > 0 && (
            <div className="text-xs text-center p-2 bg-primary/5 rounded-lg">Total: <span className="font-bold text-primary">{fmtAmt(total)} {listing.currency}</span></div>
          )}
          <Textarea placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="text-xs min-h-[50px]" />
        </div>
        <DialogFooter>
          <Button onClick={() => {
            if (!amountVal) return toast.error('Enter an amount');
            onSend({ listing_id: listing.id, responder_user_id: listing.user_id, responder_merchant_id: listing.merchant_id, side: listing.side, currency: listing.currency, amount: amountVal, rate: rateVal, total, note: note || undefined });
          }} disabled={isPending} size="sm" className="w-full gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send Offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CounterOfferDialog({ trade, onClose, onCounter, isPending }: {
  trade: OtcTrade | null; onClose: () => void; onCounter: (i: CounterOfferInput) => void; isPending: boolean;
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
        <DialogHeader><DialogTitle className="text-sm font-bold">Counter Offer</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs bg-muted/50 rounded-lg p-2.5 space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Original:</span><span className="font-bold">{fmtAmt(trade.amount)} @ {trade.rate}</span></div>
          </div>
          <Input type="number" placeholder={`Counter amount (${trade.amount})`} value={amount} onChange={e => setAmount(e.target.value)} className="h-8 text-xs" />
          <Input type="number" placeholder={`Counter rate (${trade.rate})`} value={rate} onChange={e => setRate(e.target.value)} className="h-8 text-xs" />
          <div className="text-xs text-center p-2 bg-amber-500/5 rounded-lg">Counter: <span className="font-bold text-amber-600">{fmtAmt(total)} {trade.currency}</span></div>
          <Textarea placeholder="Note" value={note} onChange={e => setNote(e.target.value)} className="text-xs min-h-[50px]" />
        </div>
        <DialogFooter>
          <Button onClick={() => { onCounter({ trade_id: trade.id, counter_amount: amountVal, counter_rate: rateVal, counter_total: total, counter_note: note || undefined }); }}
            disabled={isPending} size="sm" variant="outline" className="w-full gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Send Counter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Market Depth Section ──
function MarketDepthSection({ listings }: { listings: OtcListing[] }) {
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
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Market Depth by Currency</h3>
      {depthByCurrency.map(([currency, depth]) => {
        const totalVolume = depth.cashVolume + depth.usdtVolume;
        const cashPct = totalVolume > 0 ? (depth.cashVolume / totalVolume * 100) : 50;
        return (
          <Card key={currency} className="p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold">{currency}</span>
              <span className="text-[10px] text-muted-foreground">Avg rate: <span className="font-bold text-primary">{depth.avgRate.toFixed(3)}</span></span>
            </div>
            {/* Depth bar */}
            <div className="flex h-4 rounded-full overflow-hidden bg-muted mb-1">
              <div className="bg-green-500/60 transition-all" style={{ width: `${cashPct}%` }} />
              <div className="bg-blue-500/60 transition-all" style={{ width: `${100 - cashPct}%` }} />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>💵 {depth.cashCount} listings · {fmtAmt(depth.cashVolume)}</span>
              <span>🪙 {depth.usdtCount} listings · {fmtAmt(depth.usdtVolume)}</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
