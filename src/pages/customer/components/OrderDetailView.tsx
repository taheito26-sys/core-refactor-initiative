import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
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
  deriveCustomerOrderMeta,
  formatCustomerDate,
  formatCustomerNumber,
  getCustomerOrderReceivedAmount,
  getCustomerOrderSentAmount,
  getCustomerOrder,
  getCurrencyForCountry,
  type CustomerOrderRow,
} from '@/features/customer/customer-portal';

const STEPS: { key: string; labelKey: string; icon: LucideIcon }[] = [
  { key: 'pending', labelKey: 'orderCreated', icon: Circle },
  { key: 'awaiting_payment', labelKey: 'awaitingPayment', icon: Clock },
  { key: 'payment_sent', labelKey: 'paymentSent', icon: Upload },
  { key: 'confirmed', labelKey: 'confirmed', icon: CheckCircle2 },
  { key: 'completed', labelKey: 'completed', icon: CheckCircle2 },
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
      <span className="font-semibold text-right text-foreground">{value}</span>
    </div>
  );
}

export default function OrderDetailView({ orderId, merchantName, onBack }: Props) {
  const { userId } = useAuth();
  const { settings } = useTheme();
  const t = useT();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const language = settings.language === 'ar' ? 'ar' : 'en';
  const [uploading, setUploading] = useState(false);

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

  const meta = useMemo(() => {
    if (!order) return null;
    return deriveCustomerOrderMeta(order, settings.language === 'ar' ? 'Qatar' : undefined);
  }, [order, settings.language]);

  const sendAmount = order ? getCustomerOrderSentAmount(order) : 0;
  const receiveAmount = order ? getCustomerOrderReceivedAmount(order) : 0;
  const sendCurrency = order?.send_currency ?? getCurrencyForCountry(meta?.sendCountry);
  const receiveCurrency = order?.receive_currency ?? getCurrencyForCountry(meta?.receiveCountry);
  const isQatarToEgypt =
    meta?.sendCountry === 'Qatar' &&
    meta?.receiveCountry === 'Egypt' &&
    receiveCurrency === 'EGP';
  const currentStep = order ? Math.max(0, STEPS.findIndex((item) => item.key === order.status)) : 0;

  const timeLeft = useMemo(() => {
    if (!order?.expires_at) return null;
    const diff = new Date(order.expires_at).getTime() - Date.now();
    return diff > 0 ? diff : 0;
  }, [order?.expires_at]);

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
        event_type: 'payment_uploaded',
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

  const cancelOrder = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('customer_orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId)
        .eq('customer_user_id', userId!);
      if (error) throw error;
      await supabase.from('customer_order_events').insert({
        order_id: orderId,
        event_type: 'order_cancelled',
        actor_user_id: userId!,
      });
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

  const canCancel = ['pending', 'awaiting_payment'].includes(order.status);
  const canUploadProof = ['pending', 'awaiting_payment'].includes(order.status);
  const showCorridorCard = isQatarToEgypt || meta.sendCountry === 'Qatar' || meta.receiveCountry === 'Egypt';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('back')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-black text-foreground">
            {meta.corridorLabel} · {formatCustomerNumber(sendAmount, language, 2)} {sendCurrency}
          </div>
          <div className="truncate text-sm text-muted-foreground">{merchantName}</div>
        </div>
        <Badge variant={order.status === 'completed' ? 'default' : order.status === 'cancelled' ? 'destructive' : 'secondary'} className="capitalize">
          {order.status.replace(/_/g, ' ')}
        </Badge>
      </div>

      {showCorridorCard && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('corridorCard')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">
              {meta.corridorLabel}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{meta.sendCountry}</div>
                <div className="mt-1 text-lg font-black text-foreground">
                  {formatCustomerNumber(sendAmount, language, 2)} {sendCurrency}
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
              <div className="text-right">
                <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{meta.receiveCountry}</div>
                <div className="mt-1 text-lg font-black text-foreground">
                  {formatCustomerNumber(receiveAmount, language, 2)} {receiveCurrency}
                </div>
              </div>
            </div>
            <div className="grid gap-2 rounded-xl border border-border/60 bg-card/80 p-3 text-xs sm:grid-cols-2">
              <Row label={t('payoutRail')} value={order.payout_rail ?? t('nA')} />
              <Row label={t('receiveCurrency')} value={receiveCurrency} />
            </div>
          </CardContent>
        </Card>
      )}

      {order.expires_at && timeLeft !== null && order.status !== 'completed' && order.status !== 'cancelled' && (
        <Card className={cn('border', timeLeft === 0 ? 'border-destructive bg-destructive/5' : 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10')}>
          <CardContent className="flex items-center gap-3 p-3">
            <Timer className={cn('h-5 w-5', timeLeft === 0 ? 'text-destructive' : 'text-amber-600')} />
            <span className="text-sm font-medium">
              {timeLeft === 0 ? t('confirmationExpired') : `${t('merchantConfirmIn')} ${Math.floor(timeLeft / 60000)}:${String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, '0')}`}
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('orderProgress')}</CardTitle>
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
                  <p className={cn('text-sm', done ? 'text-foreground' : 'text-muted-foreground')}>
                    {t(step.labelKey as never)}
                  </p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('details')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Row label={t('merchant')} value={merchantName} />
          <Row label={t('sendCountry')} value={meta.sendCountry} />
          <Row label={t('receiveCountry')} value={meta.receiveCountry} />
          <Row label={t('sendCurrency')} value={sendCurrency} />
          <Row label={t('receiveCurrency')} value={receiveCurrency} />
          <Row label={t('payoutRail')} value={order.payout_rail ?? t('nA')} />
          <Row label={t('corridorLabel')} value={meta.corridorLabel} />
          <Row label={t('amount')} value={`${formatCustomerNumber(sendAmount, language, 2)} ${sendCurrency}`} />
          {order.rate !== null && <Row label={t('rate')} value={formatCustomerNumber(order.rate, language, 3)} />}
          {order.total !== null && <Row label={t('total')} value={`${formatCustomerNumber(receiveAmount, language, 2)} ${receiveCurrency}`} />}
          <Row label={t('created')} value={formatCustomerDate(order.created_at, language)} />
          {order.confirmed_at && <Row label={t('confirmed')} value={formatCustomerDate(order.confirmed_at, language)} />}
          {order.note && <Row label={t('note')} value={order.note} />}
        </CardContent>
      </Card>

      {canUploadProof && !order.payment_proof_url && (
        <Card className="border-dashed border-primary/30">
          <CardContent className="flex flex-col items-center gap-3 py-6">
            <FileImage className="h-8 w-8 text-muted-foreground" />
            <p className="text-center text-sm text-muted-foreground">{t('uploadPaymentProof')}</p>
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
            <CardTitle className="text-sm">{t('timeline')}</CardTitle>
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
