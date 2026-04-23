/**
 * PhasedClientOrderCard
 *
 * A single compact card for phased orders on the customer portal.
 * Replaces the default order card + separate ParentOrderCard with ONE integrated card.
 *
 * Key rules:
 * - ONE card per parent_order_id (no duplicates)
 * - All totals derived from persisted phase snapshots (never from order.fx_rate * order.amount)
 * - Collapsed: total QAR, total EGP, progress %, weighted avg FX, status
 * - Expandable: phase rows with consumed QAR, delivered EGP, QAR→EGP FX
 * - Realtime updates via useParentOrderSummary + useOrderExecutions hooks
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useParentOrderSummary } from '../hooks/useParentOrderSummary';
import { useOrderExecutions } from '../hooks/useOrderExecutions';
import { formatCustomerNumber } from '@/features/customer/customer-portal';

interface PhasedClientOrderCardProps {
  orderId: string;
  parentQarAmount: number;
  sendCurrency: string;
  receiveCurrency: string;
  workflowStatus: string | null;
  lang: 'en' | 'ar';
  createdAt: string;
  note?: string | null;
  /** Render slot for action buttons (approve/reject/edit) */
  actions?: React.ReactNode;
}

function fmtAmt(value: number, lang: 'en' | 'ar'): string {
  return formatCustomerNumber(value, lang, 0);
}

function currencyLabel(cur: string, lang: 'en' | 'ar') {
  const labels: Record<string, { en: string; ar: string }> = {
    QAR: { en: 'QAR', ar: 'قطري' },
    EGP: { en: 'EGP', ar: 'جنية' },
  };
  return labels[cur] ? (lang === 'ar' ? labels[cur].ar : labels[cur].en) : cur;
}

function getStatusConfig(status: string | null) {
  const configs: Record<string, { tone: string; badge: string; label: { en: string; ar: string } }> = {
    pending_customer_approval: {
      tone: 'border-amber-500/18 bg-[#0d1730]',
      badge: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
      label: { en: 'Awaiting Approval', ar: 'بانتظار الموافقة' },
    },
    pending_merchant_approval: {
      tone: 'border-sky-500/18 bg-[#0d1730]',
      badge: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
      label: { en: 'Awaiting Merchant', ar: 'بانتظار التاجر' },
    },
    approved: {
      tone: 'border-emerald-500/18 bg-[#0d1730]',
      badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
      label: { en: 'Approved', ar: 'تمت الموافقة' },
    },
    rejected: {
      tone: 'border-rose-500/18 bg-[#0d1730]',
      badge: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
      label: { en: 'Rejected', ar: 'مرفوض' },
    },
    cancelled: {
      tone: 'border-slate-500/18 bg-[#0d1730]',
      badge: 'border-slate-500/25 bg-slate-500/10 text-slate-300',
      label: { en: 'Cancelled', ar: 'ملغي' },
    },
  };
  return configs[status || 'cancelled'] || configs.cancelled;
}

function getFulfillmentLabel(status: string | null, lang: 'en' | 'ar') {
  switch (status) {
    case 'fully_fulfilled': return lang === 'ar' ? 'مكتمل التسليم' : 'Fully delivered';
    case 'partially_fulfilled': return lang === 'ar' ? 'تسليم جزئي' : 'Partially delivered';
    default: return lang === 'ar' ? 'لم يبدأ' : 'Not started';
  }
}

export function PhasedClientOrderCard({
  orderId,
  parentQarAmount,
  sendCurrency,
  receiveCurrency,
  workflowStatus,
  lang,
  createdAt,
  note,
  actions,
}: PhasedClientOrderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: summary, isLoading: summaryLoading } = useParentOrderSummary(orderId);
  const { data: executions = [] } = useOrderExecutions(orderId);

  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const statusCfg = getStatusConfig(workflowStatus);
  const isRtl = lang === 'ar';

  // Derive all display values from phase snapshots (NEVER from order.fx_rate * order.amount)
  const totalEgp = summary?.total_egp_received ?? 0;
  const fulfilledQar = summary?.fulfilled_qar ?? 0;
  const progressPct = summary?.progress_percent ?? 0;
  const weightedAvgFx = summary?.weighted_avg_fx ?? null;
  const fulfillmentStatus = summary?.fulfillment_status ?? 'unfulfilled';
  const fillCount = summary?.fill_count ?? 0;
  const isFull = fulfillmentStatus === 'fully_fulfilled';

  const dateLabel = new Intl.DateTimeFormat(isRtl ? 'ar-EG' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(createdAt));

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={cn(
        'overflow-hidden rounded-[20px] border px-3 py-2.5 text-[12px] text-slate-100',
        statusCfg.tone,
        isRtl && 'text-right',
      )}
    >
      {/* Header: status badge + date */}
      <div className={cn('flex items-start justify-between gap-2', isRtl && 'flex-row-reverse')}>
        <div className="flex items-center gap-1.5">
          {isFull && (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] leading-none text-emerald-400">✓</span>
          )}
          <span className={cn('inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold', statusCfg.badge)}>
            {statusCfg.label[lang]}
          </span>
        </div>
        <span className="text-[10px] font-medium text-slate-300">{dateLabel}</span>
      </div>

      {/* Amounts: Received QAR + Delivered EGP (derived from phases) */}
      <div className={cn('mt-2 grid grid-cols-2 gap-2', isRtl && 'text-right')}>
        <div className="rounded-xl bg-white/[0.03] px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-[0.08em] text-slate-400">{L('Received', 'المستلم')}</div>
          <div className="mt-1 text-[17px] font-black leading-none text-slate-50">
            {fmtAmt(parentQarAmount, lang)}
          </div>
          <div className="mt-0.5 text-[10px] font-semibold text-slate-300">{currencyLabel(sendCurrency, lang)}</div>
        </div>
        <div className={cn('rounded-xl bg-white/[0.03] px-2 py-1.5', isRtl ? 'text-left' : 'text-right')}>
          <div className="text-[9px] uppercase tracking-[0.08em] text-slate-400">{L('Delivered', 'المرسل')}</div>
          <div className="mt-1 text-[17px] font-black leading-none text-slate-50">
            {summaryLoading ? '...' : totalEgp > 0 ? fmtAmt(totalEgp, lang) : '—'}
          </div>
          <div className="mt-0.5 text-[10px] font-semibold text-slate-300">{currencyLabel(receiveCurrency, lang)}</div>
        </div>
      </div>

      {/* FX Rate line — derived weighted avg, not order.fx_rate */}
      {weightedAvgFx && (
        <div className={cn('mt-1.5 text-[10px] leading-4 text-slate-400', isRtl && 'text-right')}>
          1 {currencyLabel(sendCurrency, lang)} = {formatCustomerNumber(weightedAvgFx, lang, 2)} {currencyLabel(receiveCurrency, lang)}
        </div>
      )}

      {/* Progress section — clickable to expand */}
      <button
        type="button"
        className="mt-2 w-full text-left"
        onClick={() => setExpanded(prev => !prev)}
        aria-expanded={expanded}
      >
        <div className={cn('flex items-center justify-between text-[11px]', isRtl && 'flex-row-reverse')}>
          <div className="flex items-center gap-1.5">
            {expanded ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
            <span className="font-medium text-slate-200">
              {fmtAmt(fulfilledQar, lang)} / {fmtAmt(parentQarAmount, lang)} {currencyLabel(sendCurrency, lang)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-emerald-400">{progressPct.toFixed(0)}%</span>
            <span className="text-slate-400">
              {isFull ? '📦 ' : ''}{getFulfillmentLabel(fulfillmentStatus, lang)}
            </span>
            {expanded ? null : <ChevronDown className="h-3 w-3 text-slate-500" />}
          </div>
        </div>
        <Progress value={progressPct} className="mt-1 h-1.5" />
      </button>

      {/* Expanded: phase breakdown */}
      {expanded && executions.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
          {executions.map((exec) => {
            const egp = exec.executed_egp ?? exec.egp_received_amount ?? 0;
            const qar = exec.phase_consumed_qar ?? exec.sold_qar_amount ?? 0;
            const fx = exec.phase_qar_egp_fx ?? exec.fx_rate_qar_to_egp ?? 0;

            return (
              <div key={exec.id} className={cn('flex items-center justify-between text-[11px]', isRtl && 'flex-row-reverse')}>
                <div className="flex items-center gap-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                    {exec.sequence_number}
                  </span>
                  <span className="font-medium text-slate-200">{fmtAmt(qar, lang)} {currencyLabel(sendCurrency, lang)}</span>
                  <span className="text-slate-500">@ {fx.toFixed(2)}</span>
                </div>
                <span className="font-semibold text-emerald-400">{fmtAmt(egp, lang)} {currencyLabel(receiveCurrency, lang)}</span>
              </div>
            );
          })}
          {/* Weighted avg FX footer */}
          {weightedAvgFx && (
            <div className={cn('flex items-center justify-between text-[10px] pt-1 border-t border-white/5', isRtl && 'flex-row-reverse')}>
              <span className="text-slate-400">{L('Weighted Avg FX', 'متوسط سعر الصرف')}</span>
              <span className="font-bold text-slate-200">{weightedAvgFx.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Note */}
      {note && (
        <div className={cn('mt-1.5 text-[10px] text-slate-400 italic', isRtl && 'text-right')}>
          💬 {note}
        </div>
      )}

      {/* Action buttons slot */}
      {actions && (
        <div className="mt-2 border-t border-white/5 pt-2">
          {actions}
        </div>
      )}
    </div>
  );
}
