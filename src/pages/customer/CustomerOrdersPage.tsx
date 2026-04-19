import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Loader2, Plus, ShoppingCart, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-context';
import OrderDetailView from './components/OrderDetailView';
import {
  acceptCustomerQuote,
  createCustomerOrder,
  createCustomerOrderWithGuide,
  deriveCustomerOrderMeta,
  formatCustomerDate,
  formatCustomerNumber,
  getCompatibleRails,
  getCorridorLabel,
  getCurrencyForCountry,
  getDisplayedCustomerRate,
  getDisplayedCustomerTotal,
  getGuidePricingForCustomerOrder,
  listCustomerConnections,
  listCustomerOrders,
  rejectCustomerQuote,
  type CustomerCountry,
  type CustomerOrderRow,
  type GuidePricingResult,
} from '@/features/customer/customer-portal';
import { CUSTOMER_COUNTRIES } from '@/features/customer/customer-portal';

type OrderDraft = {
  orderType: 'buy' | 'sell';
  merchantId: string;
  amount: string;
  rate: string;
  note: string;
  sendCountry: CustomerCountry;
  receiveCountry: CustomerCountry;
  payoutRail: string;
};

function getStatusBadgeVariant(status: string) {
  if (status === 'completed') return 'default';
  if (status === 'cancelled' || status === 'quote_rejected') return 'destructive';
  return 'secondary';
}

function formatQuoteStatus(status: string) {
  return status.replace(/_/g, ' ');
}

function QuoteSummary({
  guide,
  language,
  corridorLabel,
  receiveCurrency,
}: {
  guide: GuidePricingResult | null;
  language: 'en' | 'ar';
  corridorLabel: string;
  receiveCurrency: string;
}) {
  if (!guide || guide.guideRate == null || guide.guideTotal == null) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/60 p-4 text-sm text-muted-foreground">
        Guide unavailable. Merchant quote only.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-gradient-to-br from-primary/10 via-transparent to-transparent p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">
        Based on current market guide pricing
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Guide Rate</div>
          <div className="mt-1 text-lg font-black text-foreground">
            {formatCustomerNumber(guide.guideRate, language, 4)}
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Estimated You Receive</div>
          <div className="mt-1 text-lg font-black text-foreground">
            {formatCustomerNumber(guide.guideTotal, language, 2)} {receiveCurrency}
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Pricing Source</div>
          <div className="mt-1 text-lg font-black text-foreground">
            {guide.guideSource ?? 'INSTAPAY_V1'}
          </div>
        </div>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        Final rate will be confirmed by the merchant.
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">{corridorLabel}</div>
    </div>
  );
}

export default function CustomerOrdersPage() {
  const { userId, customerProfile } = useAuth();
  const navigate = useNavigate();
  const { settings } = useTheme();
  const t = useT();
  const queryClient = useQueryClient();
  const language = settings.language === 'ar' ? 'ar' : 'en';

  const [showForm, setShowForm] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OrderDraft>({
    orderType: 'buy',
    merchantId: '',
    amount: '',
    rate: '',
    note: '',
    sendCountry: (customerProfile?.country as CustomerCountry) ?? CUSTOMER_COUNTRIES[0],
    receiveCountry: 'Egypt',
    payoutRail: '',
  });

  useEffect(() => {
    const quickOrder = localStorage.getItem('customer_quick_order');
    if (quickOrder === 'buy' || quickOrder === 'sell') {
      localStorage.removeItem('customer_quick_order');
      setDraft((prev) => ({ ...prev, orderType: quickOrder }));
      setShowForm(true);
    }

    const repeatOrder = localStorage.getItem('customer_repeat_order');
    if (repeatOrder) {
      localStorage.removeItem('customer_repeat_order');
      try {
        const parsed = JSON.parse(repeatOrder) as Partial<OrderDraft> & {
          order_type?: 'buy' | 'sell';
          send_country?: string;
          receive_country?: string;
          payout_rail?: string;
        };
        setDraft((prev) => ({
          ...prev,
          orderType: parsed.order_type ?? parsed.orderType ?? 'buy',
          merchantId: parsed.merchantId ?? '',
          amount: String((parsed as any).amount ?? ''),
          rate: String(parsed.rate ?? ''),
          note: parsed.note ?? '',
          sendCountry: (parsed.send_country as CustomerCountry) ?? prev.sendCountry,
          receiveCountry: (parsed.receive_country as CustomerCountry) ?? prev.receiveCountry,
          payoutRail: parsed.payout_rail ?? '',
        }));
        setShowForm(true);
      } catch {
        // best effort
      }
    }
  }, []);

  const { data: connections = [] } = useQuery({
    queryKey: ['customer-active-connections', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await listCustomerConnections(userId);
      if (error) return [];
      return (data ?? []).filter((conn) => conn.status === 'active');
    },
    enabled: !!userId,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['customer-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await listCustomerOrders(userId);
      if (error) return [];
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!userId,
  });

  useEffect(() => {
    const fallback = (customerProfile?.country as CustomerCountry) ?? CUSTOMER_COUNTRIES[0];
    setDraft((prev) => ({
      ...prev,
      sendCountry: prev.sendCountry ?? fallback,
      payoutRail: prev.payoutRail || getCompatibleRails(prev.sendCountry ?? fallback, prev.receiveCountry)[0]?.value || '',
    }));
  }, [customerProfile?.country]);

  const parsedAmount = Number(draft.amount);
  const parsedRate = Number(draft.rate);
  const sendCurrency = getCurrencyForCountry(draft.sendCountry);
  const receiveCurrency = getCurrencyForCountry(draft.receiveCountry);
  const availableRails = useMemo(
    () => getCompatibleRails(draft.sendCountry, draft.receiveCountry),
    [draft.receiveCountry, draft.sendCountry],
  );
  const selectedRail = availableRails.find((item) => item.value === draft.payoutRail)?.value ?? availableRails[0]?.value ?? '';
  const corridorLabel = getCorridorLabel(draft.sendCountry, draft.receiveCountry);

  useEffect(() => {
    if (!availableRails.some((rail) => rail.value === draft.payoutRail)) {
      setDraft((prev) => ({ ...prev, payoutRail: availableRails[0]?.value ?? '' }));
    }
  }, [availableRails, draft.payoutRail]);

  useEffect(() => {
    if (draft.orderType === 'buy') {
      setDraft((prev) => (prev.rate ? { ...prev, rate: '' } : prev));
    }
  }, [draft.orderType]);

  const guideQuery = useQuery({
    queryKey: ['customer-guide-pricing', draft.amount, draft.sendCountry, draft.receiveCountry, selectedRail],
    queryFn: async () => {
      if (draft.orderType !== 'buy' || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return null;
      return getGuidePricingForCustomerOrder({
        customerUserId: userId ?? '',
        merchantId: draft.merchantId || '',
        connectionId: '',
        orderType: 'buy',
        amount: parsedAmount,
        rate: null,
        note: draft.note.trim() || null,
        sendCountry: draft.sendCountry,
        receiveCountry: draft.receiveCountry,
        sendCurrency,
        receiveCurrency,
        payoutRail: selectedRail || null,
        corridorLabel,
      });
    },
    enabled: draft.orderType === 'buy' && Number.isFinite(parsedAmount) && parsedAmount > 0,
  });

  const currentGuide = guideQuery.data ?? null;

  const placeOrder = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Missing user session');
      if (!draft.merchantId) throw new Error(t('selectMerchant'));
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error(t('enterValidAmount'));
      const conn = connections.find((item: any) => item.merchant_id === draft.merchantId);
      if (!conn) throw new Error(t('selectConnectedMerchant'));

      if (draft.orderType === 'buy') {
        const { data, error } = await createCustomerOrderWithGuide({
          customerUserId: userId,
          merchantId: draft.merchantId,
          connectionId: conn.id,
          orderType: 'buy',
          amount: parsedAmount,
          rate: null,
          note: draft.note.trim() || null,
          sendCountry: draft.sendCountry,
          receiveCountry: draft.receiveCountry,
          sendCurrency,
          receiveCurrency,
          payoutRail: selectedRail || null,
          corridorLabel,
        });
        if (error) throw error;
        return data;
      }

      const { data, error } = await createCustomerOrder({
        customerUserId: userId,
        merchantId: draft.merchantId,
        connectionId: conn.id,
        orderType: 'sell',
        amount: parsedAmount,
        rate: Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null,
        note: draft.note.trim() || null,
        sendCountry: draft.sendCountry,
        receiveCountry: draft.receiveCountry,
        sendCurrency,
        receiveCurrency,
        payoutRail: selectedRail || null,
        corridorLabel,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(t('orderPlaced'));
      setShowForm(false);
      setDraft({
        orderType: 'buy',
        merchantId: '',
        amount: '',
        rate: '',
        note: '',
        sendCountry: (customerProfile?.country as CustomerCountry) ?? CUSTOMER_COUNTRIES[0],
        receiveCountry: 'Egypt',
        payoutRail: '',
      });
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
      queryClient.invalidateQueries({ queryKey: ['customer-dashboard-orders'] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? t('orderFailed'));
    },
  });

  const respondToQuote = useMutation({
    mutationFn: async (payload: { order: CustomerOrderRow; kind: 'accept' | 'reject'; reason?: string | null }) => {
      if (!userId) throw new Error('Missing user session');
      if (payload.kind === 'accept') {
        const { error } = await acceptCustomerQuote(payload.order, userId);
        if (error) throw error;
      } else {
        const { error } = await rejectCustomerQuote(payload.order, userId, payload.reason ?? null);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Quote updated');
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
      queryClient.invalidateQueries({ queryKey: ['customer-dashboard-orders'] });
    },
    onError: (error: any) => toast.error(error?.message ?? 'Failed to update quote'),
  });

  if (selectedOrderId) {
    const order = orders.find((item) => item.id === selectedOrderId);
    return (
      <OrderDetailView
        orderId={selectedOrderId}
        merchantName={connections.find((item: any) => item.merchant_id === order?.merchant_id)?.merchant_id ?? order?.merchant_id ?? t('merchant')}
        onBack={() => setSelectedOrderId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">{t('orders')}</h1>
          <p className="text-sm text-muted-foreground">{t('customerOrdersSubtitle')}</p>
        </div>
        <Button onClick={() => setShowForm((value) => !value)} className="gap-2">
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? t('close') : t('newOrder')}
        </Button>
      </div>

      {showForm && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('placeOrder')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={draft.orderType === 'buy' ? 'default' : 'outline'}
                className="gap-2"
                onClick={() => setDraft((prev) => ({ ...prev, orderType: 'buy', rate: '' }))}
              >
                <ArrowDownLeft className="h-4 w-4" />
                {t('buy')}
              </Button>
              <Button
                type="button"
                variant={draft.orderType === 'sell' ? 'default' : 'outline'}
                className="gap-2"
                onClick={() => setDraft((prev) => ({ ...prev, orderType: 'sell' }))}
              >
                <ArrowUpRight className="h-4 w-4" />
                {t('sell')}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>{t('merchant')}</Label>
              <Select value={draft.merchantId} onValueChange={(merchantId) => setDraft((prev) => ({ ...prev, merchantId }))}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectMerchant')} />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((conn: any) => (
                    <SelectItem key={conn.merchant_id} value={conn.merchant_id}>
                      {conn.merchantName ?? conn.merchant_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {connections.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('noConnectedMerchants')}{' '}
                  <button type="button" className="font-semibold text-primary" onClick={() => navigate('/c/merchants')}>
                    {t('connectOneFirst')}
                  </button>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('sendCountry')}</Label>
                <Select
                  value={draft.sendCountry}
                  onValueChange={(sendCountry) => setDraft((prev) => ({
                    ...prev,
                    sendCountry: sendCountry as CustomerCountry,
                    payoutRail: getCompatibleRails(sendCountry, prev.receiveCountry)[0]?.value ?? '',
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_COUNTRIES.map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('receiveCountry')}</Label>
                <Select
                  value={draft.receiveCountry}
                  onValueChange={(receiveCountry) => setDraft((prev) => ({
                    ...prev,
                    receiveCountry: receiveCountry as CustomerCountry,
                    payoutRail: getCompatibleRails(prev.sendCountry, receiveCountry)[0]?.value ?? '',
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_COUNTRIES.map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className={cn('grid gap-3', draft.orderType === 'buy' ? 'grid-cols-1' : 'grid-cols-2')}>
              <div className="space-y-2">
                <Label>{t('amount')}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={draft.amount}
                  onChange={(event) => setDraft((prev) => ({ ...prev, amount: event.target.value }))}
                />
              </div>
              {draft.orderType === 'sell' && (
                <div className="space-y-2">
                  <Label>{t('rate')}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.000"
                    value={draft.rate}
                    onChange={(event) => setDraft((prev) => ({ ...prev, rate: event.target.value }))}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('sendCurrency')}</Label>
                <Input value={sendCurrency} disabled />
              </div>
              <div className="space-y-2">
                <Label>{t('receiveCurrency')}</Label>
                <Input value={receiveCurrency} disabled />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('payoutRail')}</Label>
              <Select value={selectedRail} onValueChange={(payoutRail) => setDraft((prev) => ({ ...prev, payoutRail }))}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectRail')} />
                </SelectTrigger>
                <SelectContent>
                  {availableRails.map((rail) => (
                    <SelectItem key={rail.value} value={rail.value}>
                      {t(rail.labelKey as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">{t('railsFilteredByCorridor')}</div>
            </div>

            {draft.orderType === 'buy' && (
              <QuoteSummary
                guide={currentGuide}
                language={language}
                corridorLabel={corridorLabel}
                receiveCurrency={receiveCurrency}
              />
            )}

            <div className="space-y-2">
              <Label>{t('noteOptional')}</Label>
              <Input
                placeholder={t('addNote')}
                value={draft.note}
                onChange={(event) => setDraft((prev) => ({ ...prev, note: event.target.value }))}
              />
            </div>

            <Button
              onClick={() => placeOrder.mutate()}
              disabled={!draft.amount || !draft.merchantId || !selectedRail || placeOrder.isPending}
              className="w-full"
            >
              {placeOrder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('placeOrder')}
            </Button>
          </CardContent>
        </Card>
      )}

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ShoppingCart className="mb-3 h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">{t('noOrdersYet')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('connectMerchantPrompt')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => {
            const meta = deriveCustomerOrderMeta(order, customerProfile?.country);
            const displayedRate = getDisplayedCustomerRate(order);
            const displayedTotal = getDisplayedCustomerTotal(order);
            const isGuideOrder = order.status === 'pending_quote';
            const isQuotedOrLater = ['quoted', 'quote_accepted', 'quote_rejected', 'awaiting_payment', 'payment_sent', 'completed'].includes(order.status);

            return (
              <Card
                key={order.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => setSelectedOrderId(order.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-full shrink-0',
                          order.order_type === 'buy' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive',
                        )}
                      >
                        {order.order_type === 'buy' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {meta.corridorLabel} - {formatCustomerNumber(order.amount, language, 2)} {meta.sendCurrency}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {order.payout_rail ?? t('nA')}
                          {' - '}
                          {isGuideOrder
                            ? `Guide Rate ${displayedRate != null ? formatCustomerNumber(displayedRate, language, 4) : '-'}`
                            : `Final Rate ${displayedRate != null ? formatCustomerNumber(displayedRate, language, 4) : '-'}`}
                          {displayedTotal != null
                            ? ` - ${isGuideOrder ? 'Estimated You Receive' : isQuotedOrLater ? 'Final Total' : 'Total'}: ${formatCustomerNumber(displayedTotal, language, 2)} ${meta.receiveCurrency}`
                            : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatCustomerDate(order.created_at, language)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={getStatusBadgeVariant(order.status)} className="text-xs capitalize">
                        {formatQuoteStatus(order.status)}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  {isGuideOrder && (
                    <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                      <div className="font-semibold text-foreground">Guide Rate</div>
                      <div className="mt-1">Source: {order.guide_source ?? 'INSTAPAY_V1'}</div>
                      <div>Based on current market guide pricing</div>
                    </div>
                  )}

                  {order.status === 'quoted' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          respondToQuote.mutate({ order, kind: 'accept' });
                        }}
                        disabled={respondToQuote.isPending}
                      >
                        Accept Quote
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          const reason = window.prompt('Optional rejection reason')?.trim() || null;
                          respondToQuote.mutate({ order, kind: 'reject', reason });
                        }}
                        disabled={respondToQuote.isPending}
                      >
                        Reject Quote
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
