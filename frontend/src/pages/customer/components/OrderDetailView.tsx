import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Clock, Upload, CheckCircle2, XCircle,
  AlertTriangle, FileImage, Loader2, Timer, CircleDot,
  Circle, Ban
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ── status pipeline ─── */
const STEPS = [
  { key: 'pending', label: 'Created', icon: CircleDot },
  { key: 'awaiting_payment', label: 'Awaiting Payment', icon: Clock },
  { key: 'payment_sent', label: 'Payment Sent', icon: Upload },
  { key: 'confirmed', label: 'Confirmed', icon: CheckCircle2 },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
] as const;

const stepIndex = (status: string) => {
  const idx = STEPS.findIndex((s) => s.key === status);
  return idx === -1 ? 0 : idx;
};

interface Props {
  orderId: string;
  merchantName: string;
  onBack: () => void;
}

export default function OrderDetailView({ orderId, merchantName, onBack }: Props) {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  /* ── order data ─── */
  const { data: order, isLoading } = useQuery({
    queryKey: ['customer-order-detail', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_orders')
        .select('*')
        .eq('id', orderId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  /* ── events timeline ─── */
  const { data: events = [] } = useQuery({
    queryKey: ['customer-order-events', orderId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_order_events')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      return data ?? [];
    },
  });

  /* ── countdown timer ─── */
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!order?.expires_at) return;
    const calc = () => {
      const diff = new Date(order.expires_at!).getTime() - Date.now();
      setTimeLeft(diff > 0 ? diff : 0);
    };
    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [order?.expires_at]);

  const fmtTimer = (ms: number) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  /* ── payment proof upload ─── */
  const handleProofUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      toast.error('Only images and PDF files are allowed');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File must be under 5 MB');
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${userId}/${orderId}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('payment-proofs')
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage
        .from('payment-proofs')
        .getPublicUrl(path);

      // Update order
      const { error: updErr } = await supabase
        .from('customer_orders')
        .update({
          payment_proof_url: urlData.publicUrl,
          payment_proof_uploaded_at: new Date().toISOString(),
          status: 'payment_sent' as any,
        })
        .eq('id', orderId);
      if (updErr) throw updErr;

      // Log event
      await supabase.from('customer_order_events').insert({
        order_id: orderId,
        event_type: 'payment_uploaded',
        actor_user_id: userId,
        metadata: { file_name: file.name, file_type: file.type },
      });

      toast.success('Payment proof uploaded');
      qc.invalidateQueries({ queryKey: ['customer-order-detail', orderId] });
      qc.invalidateQueries({ queryKey: ['customer-order-events', orderId] });
      qc.invalidateQueries({ queryKey: ['customer-orders'] });
    } catch (err: any) {
      toast.error(err?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /* ── cancel order ─── */
  const cancelOrder = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('customer_orders')
        .update({ status: 'cancelled' as any })
        .eq('id', orderId);
      if (error) throw error;
      await supabase.from('customer_order_events').insert({
        order_id: orderId,
        event_type: 'order_cancelled',
        actor_user_id: userId!,
      });
    },
    onSuccess: () => {
      toast.success('Order cancelled');
      qc.invalidateQueries({ queryKey: ['customer-order-detail', orderId] });
      qc.invalidateQueries({ queryKey: ['customer-order-events', orderId] });
      qc.invalidateQueries({ queryKey: ['customer-orders'] });
    },
    onError: (err: any) => toast.error(err?.message ?? 'Cancel failed'),
  });

  const canCancel = order && ['pending', 'awaiting_payment'].includes(order.status);
  const canUploadProof = order && ['pending', 'awaiting_payment'].includes(order.status);
  const isCancelled = order?.status === 'cancelled';
  const currentStep = order ? stepIndex(order.status) : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Order not found</p>
        <Button variant="ghost" className="mt-4" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold capitalize truncate">
            {order.order_type} · {order.amount} {order.currency}
          </h2>
          <p className="text-sm text-muted-foreground">{merchantName}</p>
        </div>
        {isCancelled ? (
          <Badge variant="destructive">Cancelled</Badge>
        ) : (
          <Badge variant="secondary" className="capitalize">{order.status.replace('_', ' ')}</Badge>
        )}
      </div>

      {/* Countdown timer */}
      {order.expires_at && timeLeft !== null && !isCancelled && order.status !== 'completed' && (
        <Card className={cn(
          'border',
          timeLeft === 0 ? 'border-destructive bg-destructive/5' : 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10'
        )}>
          <CardContent className="flex items-center gap-3 p-3">
            <Timer className={cn('h-5 w-5', timeLeft === 0 ? 'text-destructive' : 'text-amber-600')} />
            {timeLeft === 0 ? (
              <span className="text-sm font-medium text-destructive">
                Merchant confirmation expired
              </span>
            ) : (
              <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Merchant must confirm in <span className="font-mono font-bold">{fmtTimer(timeLeft)}</span>
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {/* Status stepper */}
      {!isCancelled && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Order Progress</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="space-y-0">
              {STEPS.map((step, idx) => {
                const done = idx <= currentStep;
                const active = idx === currentStep;
                const Icon = step.icon;
                return (
                  <div key={step.key} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors',
                        done
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/30 text-muted-foreground/40'
                      )}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      {idx < STEPS.length - 1 && (
                        <div className={cn(
                          'w-0.5 h-6',
                          idx < currentStep ? 'bg-primary' : 'bg-muted-foreground/20'
                        )} />
                      )}
                    </div>
                    <div className={cn('pt-0.5', active ? 'font-semibold' : '')}>
                      <p className={cn('text-sm', done ? 'text-foreground' : 'text-muted-foreground')}>
                        {step.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Order details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Type" value={order.order_type.toUpperCase()} />
          <Row label="Amount" value={`${order.amount} ${order.currency}`} />
          {order.rate && <Row label="Rate" value={order.rate} />}
          {order.total && <Row label="Total" value={Number(order.total).toLocaleString()} />}
          <Row label="Created" value={new Date(order.created_at).toLocaleString()} />
          {order.confirmed_at && <Row label="Confirmed" value={new Date(order.confirmed_at).toLocaleString()} />}
          {order.note && <Row label="Note" value={order.note} />}
        </CardContent>
      </Card>

      {/* Payment proof */}
      {canUploadProof && !order.payment_proof_url && (
        <Card className="border-dashed border-primary/30">
          <CardContent className="flex flex-col items-center gap-3 py-6">
            <FileImage className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">Upload payment proof (image or PDF)</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleProofUpload}
            />
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {uploading ? 'Uploading…' : 'Choose File'}
            </Button>
          </CardContent>
        </Card>
      )}

      {order.payment_proof_url && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-green-700 dark:text-green-400 font-medium">Payment proof uploaded</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {order.payment_proof_uploaded_at
                  ? new Date(order.payment_proof_uploaded_at).toLocaleString()
                  : ''}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {canCancel && (
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => cancelOrder.mutate()}
          disabled={cancelOrder.isPending}
        >
          {cancelOrder.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
          Cancel Order
        </Button>
      )}

      {/* Timeline */}
      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events.map((ev: any) => (
              <div key={ev.id} className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Circle className="h-3 w-3 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium capitalize">
                    {ev.event_type.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
