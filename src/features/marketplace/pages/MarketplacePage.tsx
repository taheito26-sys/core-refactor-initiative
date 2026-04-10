import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Banknote, Coins, Plus, Loader2, Send, ArrowRightLeft, Users, TrendingUp,
  Pause, Play, Trash2, X, Check, RefreshCw, Clock, AlertTriangle,
  MessageCircle, Star, BarChart3,
} from 'lucide-react';
import { useOtcListings, useMyOtcListings, type OtcListing, type CreateListingInput } from '../hooks/useOtcListings';
import { useOtcTrades, type OtcTrade, type SendOfferInput, type CounterOfferInput } from '../hooks/useOtcTrades';
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

// Currency → MarketId mapping for P2P rate suggestions
const CURRENCY_TO_MARKET: Record<string, string> = {
  QAR: 'qatar', AED: 'uae', EGP: 'egypt', SAR: 'ksa', TRY: 'turkey', OMR: 'oman', GEL: 'georgia', KZT: 'kazakhstan',
};

export default function MarketplacePage() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userId } = useAuth();
  const { listings, isLoading: listingsLoading } = useOtcListings();
  const { myListings, isLoading: myLoading, create, update, remove } = useMyOtcListings();
  const { trades, isLoading: tradesLoading, sendOffer, counterOffer, confirmTrade, completeTrade, cancelTrade } = useOtcTrades();

  // P2P market data for rate suggestions (default to Qatar)
  const { snapshot: qatarSnapshot } = useP2PMarketData('qatar');

  const initialTab = searchParams.get('tab') || 'board';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [sideFilter, setSideFilter] = useState<'all' | 'cash' | 'usdt'>('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showOfferDialog, setShowOfferDialog] = useState<OtcListing | null>(null);
  const [showCounterDialog, setShowCounterDialog] = useState<OtcTrade | null>(null);

  const cashListings = listings.filter(l => l.side === 'cash' && l.user_id !== userId);
  const usdtListings = listings.filter(l => l.side === 'usdt' && l.user_id !== userId);
  const filteredListings = sideFilter === 'cash' ? cashListings : sideFilter === 'usdt' ? usdtListings : listings.filter(l => l.user_id !== userId);

  const activeTrades = trades.filter(t => !['completed', 'cancelled', 'expired'].includes(t.status));
  const completedTrades = trades.filter(t => ['completed', 'cancelled', 'expired'].includes(t.status));

  // Analytics
  const analytics = useMemo(() => {
    const completed = trades.filter(t => t.status === 'completed');
    const totalVolume = completed.reduce((s, t) => s + (t.counter_total ?? t.total), 0);
    const completionRate = trades.length > 0 ? (completed.length / trades.length * 100) : 0;
    return { completedCount: completed.length, totalVolume, completionRate, totalTrades: trades.length };
  }, [trades]);

  // Suggested rate from P2P data
  const suggestedRate = qatarSnapshot?.sellAvg ?? qatarSnapshot?.buyAvg ?? null;

  const handleOpenChat = (roomId: string) => {
    navigate(`/chat?room=${roomId}`);
  };

  return (
    <div className="p-3 md:p-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg md:text-xl font-black tracking-tight">
            {t('marketplace' as any) || 'OTC Marketplace'}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('marketplaceSubtitle' as any) || 'Post liquidity, browse offers, and book trades'}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreateDialog(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('postListing' as any) || 'Post Listing'}</span>
          <span className="sm:hidden">Post</span>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard icon={Banknote} label="Cash Listings" value={cashListings.length} />
        <StatCard icon={Coins} label="USDT Listings" value={usdtListings.length} />
        <StatCard icon={Users} label="Active Merchants" value={new Set(listings.map(l => l.user_id)).size} />
        <StatCard icon={ArrowRightLeft} label="Active Trades" value={activeTrades.length} />
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="board" className="text-xs">
            {t('listingBoard' as any) || 'Board'}
          </TabsTrigger>
          <TabsTrigger value="my-listings" className="text-xs">
            {t('myListings' as any) || 'Mine'}
            {myListings.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{myListings.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="trades" className="text-xs">
            {t('myTrades' as any) || 'Trades'}
            {activeTrades.length > 0 && <Badge variant="destructive" className="ml-1 text-[10px] px-1">{activeTrades.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs">
            <BarChart3 className="h-3 w-3 mr-0.5" />
            Stats
          </TabsTrigger>
        </TabsList>

        {/* Board Tab */}
        <TabsContent value="board" className="space-y-3 mt-3">
          <div className="flex gap-1.5">
            {(['all', 'cash', 'usdt'] as const).map(f => (
              <Button
                key={f}
                size="sm"
                variant={sideFilter === f ? 'default' : 'outline'}
                onClick={() => setSideFilter(f)}
                className="text-xs h-7 px-2.5"
              >
                {f === 'all' ? 'All' : f === 'cash' ? '💵 Cash' : '🪙 USDT'}
              </Button>
            ))}
          </div>

          {listingsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredListings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {t('noListings' as any) || 'No listings available. Be the first to post!'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredListings.map(listing => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  onSendOffer={() => setShowOfferDialog(listing)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* My Listings Tab */}
        <TabsContent value="my-listings" className="space-y-3 mt-3">
          {myLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : myListings.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-muted-foreground text-sm">
                {t('noMyListings' as any) || "You haven't posted any listings yet."}
              </p>
              <Button size="sm" onClick={() => setShowCreateDialog(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Post Listing
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {myListings.map(listing => (
                <MyListingCard
                  key={listing.id}
                  listing={listing}
                  onTogglePause={() => {
                    const newStatus = listing.status === 'active' ? 'paused' : 'active';
                    update.mutate({ id: listing.id, status: newStatus }, {
                      onSuccess: () => toast.success(newStatus === 'paused' ? 'Listing paused' : 'Listing activated'),
                    });
                  }}
                  onDelete={() => {
                    remove.mutate(listing.id, {
                      onSuccess: () => toast.success('Listing removed'),
                    });
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Trades Tab */}
        <TabsContent value="trades" className="space-y-4 mt-3">
          {tradesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : trades.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {t('noTrades' as any) || 'No trades yet. Send an offer to get started!'}
            </div>
          ) : (
            <>
              {activeTrades.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active</h3>
                  {activeTrades.map(trade => (
                    <TradeCard
                      key={trade.id}
                      trade={trade}
                      userId={userId!}
                      onOpenChat={handleOpenChat}
                      onCounter={() => setShowCounterDialog(trade)}
                      onConfirm={() => confirmTrade.mutate(trade.id, { onSuccess: () => toast.success('Trade confirmed!') })}
                      onComplete={() => completeTrade.mutate(trade.id, { onSuccess: () => toast.success('Trade completed!') })}
                      onCancel={() => cancelTrade.mutate(trade.id, { onSuccess: () => toast.info('Trade cancelled') })}
                    />
                  ))}
                </div>
              )}
              {completedTrades.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">History</h3>
                  {completedTrades.map(trade => (
                    <TradeCard key={trade.id} trade={trade} userId={userId!} onOpenChat={handleOpenChat} />
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary/60" />
                <div>
                  <div className="text-lg font-black">{analytics.completedCount}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Completed Trades</div>
                </div>
              </div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary/60" />
                <div>
                  <div className="text-lg font-black">{fmtAmt(analytics.totalVolume)}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Volume</div>
                </div>
              </div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-primary/60" />
                <div>
                  <div className="text-lg font-black">{analytics.completionRate.toFixed(0)}%</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Completion Rate</div>
                </div>
              </div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-primary/60" />
                <div>
                  <div className="text-lg font-black">{analytics.totalTrades}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Trades</div>
                </div>
              </div>
            </Card>
          </div>

          {suggestedRate && (
            <Card className="p-3">
              <div className="text-xs">
                <span className="text-muted-foreground">Live P2P Market Rate (QAR): </span>
                <span className="font-bold text-primary">{suggestedRate.toFixed(3)}</span>
                <span className="text-[10px] text-muted-foreground ml-1">QAR/USDT</span>
              </div>
            </Card>
          )}

          {completedTrades.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recent Completed</h3>
              {completedTrades.slice(0, 10).map(trade => (
                <TradeCard key={trade.id} trade={trade} userId={userId!} onOpenChat={handleOpenChat} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Listing Dialog */}
      <CreateListingDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        suggestedRate={suggestedRate}
        onCreate={(input) => {
          create.mutate(input, {
            onSuccess: () => {
              toast.success('Listing posted!');
              setShowCreateDialog(false);
              setActiveTab('my-listings');
            },
            onError: (err) => toast.error(err.message),
          });
        }}
        isPending={create.isPending}
      />

      {/* Send Offer Dialog */}
      <SendOfferDialog
        listing={showOfferDialog}
        onClose={() => setShowOfferDialog(null)}
        onSend={(input) => {
          sendOffer.mutate(input, {
            onSuccess: () => {
              toast.success('Offer sent!');
              setShowOfferDialog(null);
              setActiveTab('trades');
            },
            onError: (err) => toast.error(err.message),
          });
        }}
        isPending={sendOffer.isPending}
      />

      {/* Counter Offer Dialog */}
      <CounterOfferDialog
        trade={showCounterDialog}
        onClose={() => setShowCounterDialog(null)}
        onCounter={(input) => {
          counterOffer.mutate(input, {
            onSuccess: () => {
              toast.success('Counter offer sent!');
              setShowCounterDialog(null);
            },
            onError: (err) => toast.error(err.message),
          });
        }}
        isPending={counterOffer.isPending}
      />
    </div>
  );
}

// ── Sub-components ──

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card className="p-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary/60" />
        <div>
          <div className="text-lg font-black">{value}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function ListingCard({ listing, onSendOffer }: { listing: OtcListing; onSendOffer: () => void }) {
  const timeAgo = getTimeAgo(listing.updated_at);
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {listing.side === 'cash' ? '💵 Cash' : '🪙 USDT'}
            </Badge>
            <span className="text-xs font-bold">{listing.merchant_name}</span>
            {listing.merchant_nickname && (
              <span className="text-[10px] text-muted-foreground">@{listing.merchant_nickname}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span>
              <span className="text-muted-foreground">Amount: </span>
              <span className="font-bold">{fmtAmt(listing.amount_min)} – {fmtAmt(listing.amount_max)}</span>
              <span className="text-muted-foreground ml-0.5">{listing.side === 'cash' ? listing.currency : 'USDT'}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Rate: </span>
              <span className="font-bold text-primary">{listing.rate}</span>
              <span className="text-muted-foreground ml-0.5">{listing.currency}/USDT</span>
            </span>
          </div>
          {listing.payment_methods.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {listing.payment_methods.map(m => (
                <Badge key={m} variant="secondary" className="text-[9px] px-1 py-0">{m}</Badge>
              ))}
            </div>
          )}
          {listing.note && <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{listing.note}</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Button size="sm" onClick={onSendOffer} className="h-7 text-xs gap-1">
            <Send className="h-3 w-3" /> Offer
          </Button>
          <span className="text-[9px] text-muted-foreground">{timeAgo}</span>
        </div>
      </div>
    </Card>
  );
}

function MyListingCard({ listing, onTogglePause, onDelete }: {
  listing: OtcListing; onTogglePause: () => void; onDelete: () => void;
}) {
  return (
    <Card className={`p-3 ${listing.status === 'paused' ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {listing.side === 'cash' ? '💵 Cash' : '🪙 USDT'}
            </Badge>
            <Badge className={`text-[10px] px-1.5 py-0 ${listing.status === 'active' ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
              {listing.status}
            </Badge>
            <span className="text-xs font-bold">{listing.currency}</span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">Range: </span>
            <span className="font-bold">{fmtAmt(listing.amount_min)} – {fmtAmt(listing.amount_max)}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="text-muted-foreground">Rate: </span>
            <span className="font-bold text-primary">{listing.rate}</span>
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onTogglePause}>
            {listing.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function TradeCard({ trade, userId, onOpenChat, onCounter, onConfirm, onComplete, onCancel }: {
  trade: OtcTrade; userId: string;
  onOpenChat?: (roomId: string) => void;
  onCounter?: () => void; onConfirm?: () => void; onComplete?: () => void; onCancel?: () => void;
}) {
  const isInitiator = trade.initiator_user_id === userId;
  const isActive = !['completed', 'cancelled', 'expired'].includes(trade.status);
  const finalAmount = trade.counter_amount ?? trade.amount;
  const finalRate = trade.counter_rate ?? trade.rate;
  const finalTotal = trade.counter_total ?? trade.total;

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[trade.status] || ''}`}>
              {trade.status}
            </Badge>
            <span className="text-xs font-bold">{trade.counterparty_name}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {trade.side === 'cash' ? '💵' : '🪙'} {trade.currency}
            </Badge>
          </div>
          <div className="text-xs space-y-0.5">
            <div>
              <span className="text-muted-foreground">Amount: </span>
              <span className="font-bold">{fmtAmt(finalAmount)}</span>
              <span className="mx-1.5 text-muted-foreground">@</span>
              <span className="font-bold text-primary">{finalRate}</span>
              <span className="mx-1.5 text-muted-foreground">=</span>
              <span className="font-bold">{fmtAmt(finalTotal)} {trade.currency}</span>
            </div>
            {trade.status === 'countered' && (
              <div className="text-[10px] text-amber-500">
                <RefreshCw className="inline h-3 w-3 mr-0.5" />
                Counter: {fmtAmt(trade.counter_amount!)} @ {trade.counter_rate} = {fmtAmt(trade.counter_total!)} {trade.currency}
              </div>
            )}
            {(trade.note || trade.counter_note) && (
              <p className="text-[10px] text-muted-foreground line-clamp-1">
                {trade.counter_note || trade.note}
              </p>
            )}
          </div>
        </div>

        {isActive && (
          <div className="flex flex-col gap-1 shrink-0">
            {/* Responder can counter or confirm an offer */}
            {trade.status === 'offered' && !isInitiator && (
              <>
                <Button size="sm" className="h-6 text-[10px] gap-0.5" onClick={onConfirm}>
                  <Check className="h-3 w-3" /> Accept
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-0.5" onClick={onCounter}>
                  <RefreshCw className="h-3 w-3" /> Counter
                </Button>
              </>
            )}
            {/* Initiator can confirm a counter offer */}
            {trade.status === 'countered' && isInitiator && (
              <Button size="sm" className="h-6 text-[10px] gap-0.5" onClick={onConfirm}>
                <Check className="h-3 w-3" /> Accept
              </Button>
            )}
            {/* Either party can complete a confirmed trade */}
            {trade.status === 'confirmed' && (
              <Button size="sm" className="h-6 text-[10px] gap-0.5 bg-emerald-600 hover:bg-emerald-700" onClick={onComplete}>
                <Check className="h-3 w-3" /> Complete
              </Button>
            )}
            {/* Chat button */}
            {trade.chat_room_id && onOpenChat && (
              <Button size="sm" variant="outline" className="h-6 text-[10px] gap-0.5" onClick={() => onOpenChat(trade.chat_room_id!)}>
                <MessageCircle className="h-3 w-3" /> Chat
              </Button>
            )}
            {/* Either party can cancel */}
            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive gap-0.5" onClick={onCancel}>
              <X className="h-3 w-3" /> Cancel
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Dialogs ──

function CreateListingDialog({ open, onClose, onCreate, isPending, suggestedRate }: {
  open: boolean; onClose: () => void; onCreate: (i: CreateListingInput) => void; isPending: boolean;
  suggestedRate?: number | null;
}) {
  const [side, setSide] = useState<'cash' | 'usdt'>('cash');
  const [currency, setCurrency] = useState('QAR');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [rate, setRate] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const toggleMethod = (m: string) => setMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);

  const handleSubmit = () => {
    if (!amountMin || !amountMax || !rate) return toast.error('Fill all required fields');
    onCreate({
      side, currency,
      amount_min: Number(amountMin),
      amount_max: Number(amountMax),
      rate: Number(rate),
      payment_methods: methods,
      note: note || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">Post New Listing</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={side === 'cash' ? 'default' : 'outline'} onClick={() => setSide('cash')} className="flex-1 text-xs">
              💵 I have Cash
            </Button>
            <Button size="sm" variant={side === 'usdt' ? 'default' : 'outline'} onClick={() => setSide('usdt')} className="flex-1 text-xs">
              🪙 I have USDT
            </Button>
          </div>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" placeholder="Min amount" value={amountMin} onChange={e => setAmountMin(e.target.value)} className="h-8 text-xs" />
            <Input type="number" placeholder="Max amount" value={amountMax} onChange={e => setAmountMax(e.target.value)} className="h-8 text-xs" />
          </div>
          <Input type="number" placeholder={`Rate (${currency}/USDT)`} value={rate} onChange={e => setRate(e.target.value)} className="h-8 text-xs" />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 block">Payment Methods</label>
            <div className="flex flex-wrap gap-1">
              {PAYMENT_METHODS.map(m => (
                <Badge
                  key={m}
                  variant={methods.includes(m) ? 'default' : 'outline'}
                  className="cursor-pointer text-[10px] px-1.5"
                  onClick={() => toggleMethod(m)}
                >
                  {m}
                </Badge>
              ))}
            </div>
          </div>
          <Textarea placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="text-xs min-h-[60px]" />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending} size="sm" className="w-full gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Post Listing
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">Send Offer to {listing.merchant_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs bg-muted/50 rounded-lg p-2.5 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Listing:</span>
              <span className="font-bold">{listing.side === 'cash' ? '💵 Cash' : '🪙 USDT'} · {listing.currency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Range:</span>
              <span className="font-bold">{fmtAmt(listing.amount_min)} – {fmtAmt(listing.amount_max)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Listed Rate:</span>
              <span className="font-bold text-primary">{listing.rate}</span>
            </div>
          </div>
          <Input
            type="number"
            placeholder={`Amount (${listing.amount_min} – ${listing.amount_max})`}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="h-8 text-xs"
          />
          <Input
            type="number"
            placeholder={`Rate (default: ${listing.rate})`}
            value={rate}
            onChange={e => setRate(e.target.value)}
            className="h-8 text-xs"
          />
          {amountVal > 0 && (
            <div className="text-xs text-center p-2 bg-primary/5 rounded-lg">
              Total: <span className="font-bold text-primary">{fmtAmt(total)} {listing.currency}</span>
            </div>
          )}
          <Textarea placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="text-xs min-h-[50px]" />
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!amountVal) return toast.error('Enter an amount');
              onSend({
                listing_id: listing.id,
                responder_user_id: listing.user_id,
                responder_merchant_id: listing.merchant_id,
                side: listing.side,
                currency: listing.currency,
                amount: amountVal,
                rate: rateVal,
                total,
                note: note || undefined,
              });
            }}
            disabled={isPending}
            size="sm"
            className="w-full gap-1.5"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send Offer
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">Counter Offer</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs bg-muted/50 rounded-lg p-2.5 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Original Amount:</span>
              <span className="font-bold">{fmtAmt(trade.amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Original Rate:</span>
              <span className="font-bold">{trade.rate}</span>
            </div>
          </div>
          <Input type="number" placeholder={`Counter amount (current: ${trade.amount})`} value={amount} onChange={e => setAmount(e.target.value)} className="h-8 text-xs" />
          <Input type="number" placeholder={`Counter rate (current: ${trade.rate})`} value={rate} onChange={e => setRate(e.target.value)} className="h-8 text-xs" />
          <div className="text-xs text-center p-2 bg-amber-500/5 rounded-lg">
            Counter Total: <span className="font-bold text-amber-600">{fmtAmt(total)} {trade.currency}</span>
          </div>
          <Textarea placeholder="Note" value={note} onChange={e => setNote(e.target.value)} className="text-xs min-h-[50px]" />
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onCounter({
                trade_id: trade.id,
                counter_amount: amountVal,
                counter_rate: rateVal,
                counter_total: total,
                counter_note: note || undefined,
              });
            }}
            disabled={isPending}
            size="sm"
            variant="outline"
            className="w-full gap-1.5"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Send Counter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
