import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import OrderDetailView from './components/OrderDetailView';
import {
  buildCustomerOrderPayload,
  createCustomerOrder,
  deriveCustomerOrderMeta,
  formatCustomerDate,
  formatCustomerNumber,
  getCompatibleRails,
  getCorridorLabel,
  getCurrencyForCountry,
  listCustomerConnections,
  listCustomerOrders,
  type CustomerCountry,
  type CustomerOrderRow,
} from '@/features/customer/customer-portal';
import { CUSTOMER_COUNTRIES } from '@/features/customer/customer-portal';
import { useTheme } from '@/lib/theme-context';

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

function CorridorPreview({
  sendCountry,
  receiveCountry,
  amount,
  rate,
  language,
}: {
  sendCountry: CustomerCountry;
  receiveCountry: CustomerCountry;
  amount: number;
  rate: number | null;
  language: 'en' | 'ar';
}) {
  const sendCurrency = getCurrencyForCountry(sendCountry);
  const receiveCurrency = getCurrencyForCountry(receiveCountry);
  const received = rate && rate > 0 ? amount * rate : null;
  return (
    <div className="rounded-xl border border-border/60 bg-gradient-to-br from-primary/10 via-transparent to-transparent p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">{getCorridorLabel(sendCountry, receiveCountry)}</div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{sendCountry}</div>
          <div className="mt-1 text-lg font-black text-foreground">
            {formatCustomerNumber(amount, language, 2)} {sendCurrency}
          </div>
        </div>
        <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{receiveCountry}</div>
          <div className="mt-1 text-lg font-black text-foreground">
            {received !== null ? `${formatCustomerNumber(received, language, 2)} ${receiveCurrency}` : `— ${receiveCurrency}`}
          </div>
        </div>
      </div>
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
        const parsed = JSON.parse(repeatOrder) as Partial<OrderDraft> & { order_type?: 'buy' | 'sell'; send_country?: string; receive_country?: string; payout_rail?: string };
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
      payoutRail: prev.payoutRail || (getCompatibleRails(prev.sendCountry ?? fallback, prev.receiveCountry)[0]?.value ?? ''),
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
  const estimatedReceived = Number.isFinite(parsedAmount) && Number.isFinite(parsedRate) && parsedRate > 0
    ? parsedAmount * parsedRate
    : null;

  useEffect(() => {
    if (!availableRails.some((rail) => rail.value === draft.payoutRail)) {
      setDraft((prev) => ({ ...prev, payoutRail: availableRails[0]?.value ?? '' }));
    }
  }, [availableRails, draft.payoutRail]);

  const placeOrder = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Missing user session');
      if (!draft.merchantId) throw new Error(t('selectMerchant'));
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error(t('enterValidAmount'));
      const conn = connections.find((item: any) => item.merchant_id === draft.merchantId);
      if (!conn) throw new Error(t('selectConnectedMerchant'));

      const { data, error } = await createCustomerOrder({
        customerUserId: userId,
        merchantId: draft.merchantId,
        connectionId: conn.id,
        orderType: draft.orderType,
        amount: parsedAmount,
        rate: Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null,
        note: draft.note.trim() || null,
        sendCountry: draft.sendCountry,
        receiveCountry: draft.receiveCountry,
        sendCurrency,
        receiveCurrency,
        payoutRail: selectedRail || null,
        corridorLabel: getCorridorLabel(draft.sendCountry, draft.receiveCountry),
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
                onClick={() => setDraft((prev) => ({ ...prev, orderType: 'buy' }))}
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
                <Select value={draft.sendCountry} onValueChange={(sendCountry) => setDraft((prev) => ({ ...prev, sendCountry: sendCountry as CustomerCountry, payoutRail: getCompatibleRails(sendCountry, prev.receiveCountry)[0]?.value ?? '' }))}>
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
                <Select value={draft.receiveCountry} onValueChange={(receiveCountry) => setDraft((prev) => ({ ...prev, receiveCountry: receiveCountry as CustomerCountry, payoutRail: getCompatibleRails(prev.sendCountry, receiveCountry)[0]?.value ?? '' }))}>
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

            <div className="grid grid-cols-2 gap-3">
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

            {Number.isFinite(parsedAmount) && parsedAmount > 0 && (
              <CorridorPreview
                sendCountry={draft.sendCountry}
                receiveCountry={draft.receiveCountry}
                amount={parsedAmount}
                rate={Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null}
                language={language}
              />
            )}

            {Number.isFinite(parsedAmount) && Number.isFinite(parsedRate) && parsedAmount > 0 && parsedRate > 0 && (
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">{t('estimatedTotal')}</p>
                <p className="text-lg font-black text-foreground">
                  {formatCustomerNumber(estimatedReceived ?? 0, language, 2)} {receiveCurrency}
                </p>
              </div>
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
            return (
              <Card
                key={order.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedOrderId(order.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full shrink-0',
                        order.order_type === 'buy' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive',
                      )}>
                        {order.order_type === 'buy' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {meta.corridorLabel} · {formatCustomerNumber(order.amount, language, 2)} {meta.sendCurrency}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {order.payout_rail ?? t('nA')} · {order.rate ? `${t('rate')} ${formatCustomerNumber(order.rate, language, 3)}` : t('marketRate')}
                          {order.total ? ` · ${t('total')}: ${formatCustomerNumber(order.total, language, 2)} ${meta.receiveCurrency}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatCustomerDate(order.created_at, language)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={order.status === 'completed' ? 'default' : order.status === 'cancelled' ? 'destructive' : 'secondary'} className="text-xs capitalize">
                        {order.status.replace(/_/g, ' ')}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
