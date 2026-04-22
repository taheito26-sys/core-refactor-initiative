import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-context';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  FileImage,
  Loader2,
  Timer,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  acceptCustomerQuote,
  cancelCustomerOrder,
  deriveCustomerOrderMeta,
  getEligibleCustomerCashAccountsForOrder,
  getCustomerOrderDestinationCurrency,
  formatCustomerDate,
  formatCustomerNumber,
  getCustomerOrderReceivedAmount,
  getCustomerOrderSentAmount,
  getCustomerOrder,
  getCurrencyForCountry,
  getDisplayedCustomerRate,
  getDisplayedCustomerTotal,
  rejectCustomerQuote,
  type CustomerOrderRow,
} from '@/features/customer/customer-portal';

const STEP_KEYS = [
  'pending_quote',
  'quoted',
  'quote_accepted',
  'awaiting_payment',
  'payment_sent',
  'completed',
  'quote_rejected',
  'cancelled',
] as const;

const STEPS: { key: (typeof STEP_KEYS)[number]; label: string; icon: LucideIcon }[] = [
  { key: 'pending_quote', label: 'Order created', icon: Circle },
  { key: 'quoted', label: 'Quote sent', icon: Clock },
  { key: 'quote_accepted', label: 'Quote accepted', icon: CheckCircle2 },
  { key: 'awaiting_payment', label: 'Awaiting payment', icon: Timer },
  { key: 'payment_sent', label: 'Payment sent', icon: Upload },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
  { key: 'quote_rejected', label: 'Quote rejected', icon: Ban },
  { key: 'cancelled', label: 'Cancelled', icon: Ban },
];

interface Props {
  orderId: string;
  merchantName: string;
  onBack: () => void;
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold text-foreground">{value}</span>
    </div>
  );
}

function normalizeOrderStatus(status: string) {
  if (status === 'pending' || status === 'confirmed') {
    return status;
  }
  if (STEP_KEYS.includes(status as (typeof STEP_KEYS)[number])) {
    return status;
  }
  return 'pending_quote';
}

export default function OrderDetailView({ orderId, merchantName, onBack }: Props) {
  const { userId } = useAuth();
  const navigate = useNavigate();
  const { settings } = useTheme();
  const t = useT();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const language = settings.language === 'ar' ? 'ar' : 'en';
  const [uploading, setUploading] = useState(false);
  const [selectedCashAccountId, setSelectedCashAccountId] = useState('');

  const { data: order, isLoading } = useQuery({
    queryKey: ['customer-order-detail', orderId, userId],
    queryFn: async () => {
      const { data, error } = await getCustomerOrder(orderId);
      if (error) throw error;
      if (data?.customer_user_id !== userId) return null;
      return data as CustomerOrderRow;
    },
    enabled: !!orderId && !!userId,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['customer-order-events', orderId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_order_events')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!order && !!userId,
  });

  const { data: cashAccounts = [], isLoading: isCashAccountsLoading } = useQuery({
    queryKey: ['customer-cash-accounts', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('cash_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId && order?.status === 'quoted',
  });

  const meta = useMemo(() => {
    if (!order) return null;
    return deriveCustomerOrderMeta(order, settings.language === 'ar' ? 'Qatar' : undefined);
  }, [order, settings.language]);

  const sendAmount = order ? getCustomerOrderSentAmount(order) : 0;
  const receiveAmount = order ? getCustomerOrderReceivedAmount(order) : 0;
  const sendCurrency = order?.send_currency ?? getCurrencyForCountry(meta?.sendCountry);
  const receiveCurrency = order?.receive_currency ?? getCurrencyForCountry(meta?.receiveCountry);
  const currentStatus = normalizeOrderStatus(order?.status ?? 'pending_quote');
  const currentStep = Math.max(0, STEPS.findIndex((item) => item.key === currentStatus));

  const quoteRate = getDisplayedCustomerRate(order ?? {});
  const quoteTotal = getDisplayedCustomerTotal(order ?? {});
  const eligibleCashAccounts = useMemo(() => {
    if (!order) return [];
    return getEligibleCustomerCashAccountsForOrder(order, cashAccounts);
  }, [cashAccounts, order]);
  const destinationCurrency = getCustomerOrderDestinationCurrency(order ?? {});

  useEffect(() => {
    if (!eligibleCashAccounts.length) {
      setSelectedCashAccountId('');
      return;
    }

    if (!eligibleCashAccounts.some((account) => account.id === selectedCashAccountId)) {
      setSelectedCashAccountId(eligibleCashAccounts[0].id);
    }
  }, [eligibleCashAccounts, selectedCashAccountId]);

  const handleProofUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !userId) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      toast.error(t('uploadImagesOrPdf'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('fileTooLarge'));
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${userId}/${orderId}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('payment-proofs')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(path);
      const { error: updateError } = await supabase
        .from('customer_orders')
        .update({
          payment_proof_url: urlData.publicUrl,
          payment_proof_uploaded_at: new Date().toISOString(),
          status: 'payment_sent',
        })
        .eq('id', orderId)
        .eq('customer_user_id', userId);
      if (updateError) throw updateError;

      await supabase.from('customer_order_events').insert({
        order_id: orderId,
        event_type: 'customer_marked_payment_sent',
        actor_user_id: userId,
        metadata: { file_name: file.name, file_type: file.type },
      });

      toast.success(t('proofUploaded'));
      queryClient.invalidateQueries({ queryKey: ['customer-order-detail', orderId, userId] });
      queryClient.invalidateQueries({ queryKey: ['customer-order-events', orderId, userId] });
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
    } catch (error: any) {
      toast.error(error?.message ?? t('uploadFailed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const acceptQuote = useMutation({
    mutationFn: async () => {
      if (!order || !userId) return;
      const { error } = await acceptCustomerQuote(order, userId, selectedCashAccountId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Quote accepted');
      queryClient.invalidateQueries({ queryKey: ['customer-order-detail', orderId, userId] });
      queryClient.invalidateQueries({ queryKey: ['customer-order-events', orderId, userId] });
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
    },
    onError: (error: any) => toast.error(error?.message ?? 'Failed to accept quote'),
  });

  const rejectQuote = useMutation({
    mutationFn: async () => {
      if (!order || !userId) return;
      const reason = window.prompt('Optional rejection reason')?.trim() || null;
      const { error } = await rejectCustomerQuote(order, userId, reason);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Quote rejected');
      queryClient.invalidateQueries({ queryKey: ['customer-order-detail', orderId, userId] });
      queryClient.invalidateQueries({ queryKey: ['customer-order-events', orderId, userId] });
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
    },
    onError: (error: any) => toast.error(error?.message ?? 'Failed to reject quote'),
  });

  const cancelOrder = useMutation({
    mutationFn: async () => {
      if (!order || !userId) return;
      const { error } = await cancelCustomerOrder(order, userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t('orderCancelled'));
      queryClient.invalidateQueries({ queryKey: ['customer-order-detail', orderId, userId] });
      queryClient.invalidateQueries({ queryKey: ['customer-order-events', orderId, userId] });
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
    },
    onError: (error: any) => toast.error(error?.message ?? t('cancelFailed')),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order || !meta) {
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-muted-foreground">{t('orderNotFound')}</p>
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
      </div>
    );
  }

  const canCancel = ['pending_quote', 'quoted', 'payment_sent', 'pending'].includes(currentStatus);
  const canUploadProof = ['awaiting_payment', 'pending'].includes(currentStatus);
  const showGuideCard = currentStatus === 'pending_quote';
  const showQuoteCard = ['quoted', 'quote_accepted', 'quote_rejected', 'awaiting_payment', 'payment_sent', 'completed'].includes(currentStatus);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('back')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-black text-foreground">
            {meta.corridorLabel} - {formatCustomerNumber(sendAmount, language, 2)} {sendCurrency}
          </div>
          <div className="truncate text-sm text-muted-foreground">{merchantName}</div>
        </div>
        <Badge
          variant={currentStatus === 'completed' ? 'default' : currentStatus === 'cancelled' || currentStatus === 'quote_rejected' ? 'destructive' : 'secondary'}
          className="capitalize"
        >
          {currentStatus.replace(/_/g, ' ')}
        </Badge>
      </div>

      {showGuideCard && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Guide pricing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">
              {meta.corridorLabel}
            </div>
            <div className="grid gap-2 rounded-xl border border-border/60 bg-card/80 p-3 text-xs sm:grid-cols-2">
              <Row label="Guide Rate" value={quoteRate != null ? formatCustomerNumber(quoteRate, language, 4) : '-'} />
              <Row label="Estimated You Receive" value={quoteTotal != null ? `${formatCustomerNumber(quoteTotal, language, 2)} ${receiveCurrency}` : '-'} />
              <Row label="Pricing Source" value={order.guide_source ?? 'INSTAPAY_V1'} />
              <Row label="Final rate" value="Final rate will be confirmed by the merchant" />
            </div>
          </CardContent>
        </Card>
      )}

      {showQuoteCard && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quote details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">
              {meta.corridorLabel}
            </div>
            <div className="grid gap-2 rounded-xl border border-border/60 bg-card/80 p-3 text-xs sm:grid-cols-2">
              <Row label="Final Rate" value={quoteRate != null ? formatCustomerNumber(quoteRate, language, 4) : '-'} />
              <Row label="Final Total" value={quoteTotal != null ? `${formatCustomerNumber(quoteTotal, language, 2)} ${receiveCurrency}` : '-'} />
              <Row label="Quote note" value={order.final_quote_note ?? '-'} />
            </div>
          </CardContent>
        </Card>
      )}

      {order.final_quote_note && currentStatus !== 'quoted' && (
        <Card>
          <CardContent className="p-3 text-sm text-muted-foreground">
            {order.final_quote_note}
          </CardContent>
        </Card>
      )}

      {currentStatus === 'quoted' && (
        <Card className="border-primary/20">
          <CardContent className="space-y-3 p-3">
            <div className="space-y-2 rounded-xl border border-border/60 bg-background/60 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">
                Destination cash account
              </div>
              {isCashAccountsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading eligible cash accounts...
                </div>
              ) : eligibleCashAccounts.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    No eligible client cash account is available for this order.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => navigate('/c/wallet')} className="gap-2">
                      Create New Cash Account
                    </Button>
                    <Button variant="outline" onClick={onBack}>
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {eligibleCashAccounts.map((account) => {
                    const isSelected = selectedCashAccountId === account.id;
                    return (
                      <button
                        key={account.id}
                        type="button"
                        onClick={() => setSelectedCashAccountId(account.id)}
                        className={cn(
                          'rounded-xl border px-3 py-3 text-left transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border/60 bg-card text-muted-foreground hover:border-primary/40',
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-foreground">{account.name}</div>
                          {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                        </div>
                        <div className="mt-1 text-xs">
                          {account.currency} · {account.type}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {destinationCurrency && (
                <div className="text-xs text-muted-foreground">
                  Accepted funds will settle in {destinationCurrency}.
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => acceptQuote.mutate()}
                disabled={acceptQuote.isPending || !selectedCashAccountId || eligibleCashAccounts.length === 0}
                className="gap-2"
              >
                {acceptQuote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Accept Quote
              </Button>
              <Button
                variant="outline"
                onClick={() => rejectQuote.mutate()}
                disabled={rejectQuote.isPending}
                className="gap-2"
              >
                {rejectQuote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                Reject Quote
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Order progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const done = index <= currentStep;
            return (
              <div key={step.key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={cn('flex h-7 w-7 items-center justify-center rounded-full border-2', done ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30 text-muted-foreground/40')}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  {index < STEPS.length - 1 && <div className={cn('h-6 w-0.5', index < currentStep ? 'bg-primary' : 'bg-muted-foreground/20')} />}
                </div>
                <div className={cn('pt-0.5', done ? 'font-semibold' : '')}>
                  <p className={cn('text-sm', done ? 'text-foreground' : 'text-muted-foreground')}>{step.label}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Row label="Merchant" value={merchantName} />
          <Row label="Send country" value={meta.sendCountry} />
          <Row label="Receive country" value={meta.receiveCountry} />
          <Row label="Send currency" value={sendCurrency} />
          <Row label="Receive currency" value={receiveCurrency} />
          <Row label="Payout rail" value={order.payout_rail ?? t('nA')} />
          <Row label="Corridor" value={meta.corridorLabel} />
          <Row label="Amount" value={`${formatCustomerNumber(sendAmount, language, 2)} ${sendCurrency}`} />
          {quoteRate != null && <Row label={currentStatus === 'pending_quote' ? 'Guide Rate' : 'Final Rate'} value={formatCustomerNumber(quoteRate, language, 4)} />}
          {quoteTotal != null && <Row label={currentStatus === 'pending_quote' ? 'Estimated You Receive' : 'Final Total'} value={`${formatCustomerNumber(receiveAmount || quoteTotal, language, 2)} ${receiveCurrency}`} />}
          {order.note && <Row label="Note" value={order.note} />}
          {order.final_quote_note && <Row label="Merchant quote note" value={order.final_quote_note} />}
          {order.customer_accepted_quote_at && <Row label="Customer accepted" value={formatCustomerDate(order.customer_accepted_quote_at, language)} />}
          {order.customer_rejected_quote_at && <Row label="Customer rejected" value={formatCustomerDate(order.customer_rejected_quote_at, language)} />}
          {order.quote_rejection_reason && <Row label="Rejection reason" value={order.quote_rejection_reason} />}
          {order.quoted_by_user_id && <Row label="Quoted by" value={order.quoted_by_user_id} />}
          <Row label="Created" value={formatCustomerDate(order.created_at, language)} />
        </CardContent>
      </Card>

      {canUploadProof && !order.payment_proof_url && (
        <Card className="border-dashed border-primary/30">
          <CardContent className="flex flex-col items-center gap-3 py-6">
            <FileImage className="h-8 w-8 text-muted-foreground" />
            <p className="text-center text-sm text-muted-foreground">Upload payment proof and mark payment sent</p>
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleProofUpload} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {uploading ? t('uploading') : t('chooseFile')}
            </Button>
          </CardContent>
        </Card>
      )}

      {order.payment_proof_url && (
        <Card>
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="font-medium text-green-700 dark:text-green-400">{t('proofUploaded')}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {order.payment_proof_uploaded_at ? formatCustomerDate(order.payment_proof_uploaded_at, language) : ''}
            </span>
          </CardContent>
        </Card>
      )}

      {canCancel && (
        <Button variant="destructive" className="w-full gap-2" onClick={() => cancelOrder.mutate()} disabled={cancelOrder.isPending}>
          {cancelOrder.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
          {t('cancelOrder')}
        </Button>
      )}

      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events.map((event: any) => (
              <div key={event.id} className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Circle className="h-3 w-3 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium capitalize">{String(event.event_type).replace(/_/g, ' ')}</p>
                  <p className="text-xs text-muted-foreground">{formatCustomerDate(event.created_at, language)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
