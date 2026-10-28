import { useState } from 'react';
import { Loader2, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useT } from '@/lib/i18n';
import {
  canRejectApprovedOrder,
  canUnsendOrder,
  retractSharedOrder,
  type ActorRole,
  type RetractMode,
  type WorkflowOrder,
} from '@/features/orders/shared-order-workflow';

interface Props {
  order: WorkflowOrder;
  role: ActorRole;
  /** `co` matches the customer order cards; `pill` matches the merchant tab. */
  variant: 'co' | 'pill';
  onDone: () => void;
}

/** Reject (receiver, after approval) and Unsend (placer) controls, shown on both portals. */
export function OrderRetractControls({ order, role, variant, onDone }: Props) {
  const t = useT();
  const L = (en: string, ar: string) => (t.lang === 'ar' ? ar : en);
  const [mode, setMode] = useState<RetractMode | null>(null);
  const [busy, setBusy] = useState(false);

  const canUnsend = canUnsendOrder(order, role);
  const canReject = canRejectApprovedOrder(order, role);
  if (!canUnsend && !canReject) return null;

  const run = async () => {
    if (!mode) return;
    setBusy(true);
    try {
      await retractSharedOrder({ orderId: order.id, actorRole: role, mode });
      toast.success(mode === 'unsend' ? L('Order unsent', 'تم سحب الطلب') : L('Order rejected', 'تم رفض الطلب'));
      setMode(null);
      onDone();
    } catch (e) {
      toast.error((e as Error)?.message ?? L('Action failed', 'فشلت العملية'));
    } finally {
      setBusy(false);
    }
  };

  const btnClass = (tone: 'bad' | 'neutral') =>
    variant === 'co'
      ? `co-btn ${tone === 'bad' ? 'bad' : ''} wide`
      : `flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${
          tone === 'bad'
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            : 'border-slate-500/30 bg-slate-500/10 text-slate-300'
        }`;

  return (
    <>
      {canReject && (
        <button type="button" className={btnClass('bad')} onClick={(e) => { e.stopPropagation(); setMode('reject'); }}>
          <XCircle className="h-3 w-3" /> {L('Reject', 'رفض')}
        </button>
      )}
      {canUnsend && (
        <button type="button" className={btnClass('neutral')} onClick={(e) => { e.stopPropagation(); setMode('unsend'); }}>
          <Undo2 className="h-3 w-3" /> {L('Unsend', 'سحب الطلب')}
        </button>
      )}

      <AlertDialog open={mode !== null} onOpenChange={(open) => { if (!open && !busy) setMode(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === 'unsend' ? L('Unsend this order?', 'سحب هذا الطلب؟') : L('Reject this order?', 'رفض هذا الطلب؟')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === 'unsend'
                ? L('The other side will no longer see it as an active order.', 'لن يظهر الطرف الآخر هذا الطلب كطلب نشط.')
                : L('The order was already approved. Rejecting cancels it for both sides.', 'تمت الموافقة على الطلب مسبقاً. الرفض يلغيه للطرفين.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{L('Back', 'رجوع')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void run(); }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'unsend' ? L('Unsend', 'سحب') : L('Reject', 'رفض')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
