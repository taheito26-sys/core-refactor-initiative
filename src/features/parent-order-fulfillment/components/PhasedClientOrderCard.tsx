/**
 * PhasedClientOrderCard
 *
 * Single integrated card for phased orders on the customer portal.
 * - ONE card per parent_order_id
 * - All totals derived from persisted phase snapshots
 * - 3-column header: Received | Rate | Delivered
 * - Entire card is clickable to expand/collapse phases
 * - Chevron in accent color
 * - Phase rows: full-width with prominent rate display
 */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
      tone: 'border-amber-500/20 bg-[#0d1730]',
      badge: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
      label: { en: 'Awaiting Approval', ar: 'بانتظار الموافقة' },
    },
    pending_merchant_approval: {
      tone: 'border-sky-500/20 bg-[#0d1730]',
      badge: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
      label: { en: 'Awaiting Merchant', ar: 'بانتظار التاجر' },
    },
    approved: {
      tone: 'border-emerald-500/20 bg-[#0d1730]',
      badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
      label: { en: 'Approved', ar: 'تمت الموافقة' },
    },
    rejected: {
      tone: 'border-rose-500/20 bg-[#0d1730]',
      badge: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
      label: { en: 'Rejected', ar: 'مرفوض' },
    },
    cancelled: {
      tone: 'border-slate-500/20 bg-[#0d1730]',
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

  const totalEgp = summary?.total_egp_received ?? 0;
  const fulfilledQar = summary?.fulfilled_qar ?? 0;
  const progressPct = summary?.progress_percent ?? 0;
  const weightedAvgFx = summary?.weighted_avg_fx ?? null;
  const fulfillmentStatus = summary?.fulfillment_status ?? 'unfulfilled';
  const isFull = fulfillmentStatus === 'fully_fulfilled';
  const hasPhases = executions.length > 0;

  const dateLabel = new Intl.DateTimeFormat(isRtl ? 'ar-EG' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(createdAt));

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={cn(
        'overflow-hidden rounded-[20px] border text-[12px] text-slate-100 cursor-pointer select-none',
        statusCfg.tone,
        isRtl && 'text-right',
      )}
      onClick={() => hasPhases && setExpanded(prev => !prev)}
    >
      {/* Inner padding wrapper — stops action buttons from triggering collapse */}
      <div className="px-3 py-2.5">

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

        {/* 3-column amounts: Received | Rate | Delivered */}
        <div className={cn('mt-2 grid grid-cols-3 gap-1.5')}>
          {/* Received */}
          <div className="rounded-xl bg-white/[0.04] px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.08em] text-slate-400">{L('Received', 'المستلم')}</div>
            <div className="mt-1 text-[15px] font-black leading-none text-slate-50">
              {fmtAmt(parentQarAmount, lang)}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-slate-300">{currencyLabel(sendCurrency, lang)}</div>
          </div>

          {/* Rate */}
          <div className="rounded-xl bg-white/[0.04] px-2 py-1.5 text-center">
            <div className="text-[9px] uppercase tracking-[0.08em] text-slate-400">{L('Rate', 'السعر')}</div>
            <div className="mt-1 text-[13px] font-black leading-none text-sky-300">
              {summaryLoading ? '...' : weightedAvgFx ? weightedAvgFx.toFixed(2) : '—'}
            </div>
            <div className="mt-0.5 text-[9px] text-slate-400">
              1 {currencyLabel(sendCurrency, lang)} = ? {currencyLabel(receiveCurrency, lang)}
            </div>
          </div>

          {/* Delivered */}
          <div className={cn('rounded-xl bg-white/[0.04] px-2 py-1.5', isRtl ? 'text-left' : 'text-right')}>
            <div className="text-[9px] uppercase tracking-[0.08em] text-slate-400">{L('Delivered', 'المرسل')}</div>
            <div className="mt-1 text-[15px] font-black leading-none text-slate-50">
              {summaryLoading ? '...' : totalEgp > 0 ? fmtAmt(totalEgp, lang) : '—'}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-slate-300">{currencyLabel(receiveCurrency, lang)}</div>
          </div>
        </div>

        {/* Progress row — chevron in accent color */}
        <div className={cn('mt-2 flex items-center justify-between text-[11px]', isRtl && 'flex-row-reverse')}>
          <div className="flex items-center gap-1.5">
            {/* Accent-colored chevron */}
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-200 text-sky-400',
                expanded ? 'rotate-0' : '-rotate-90',
              )}
            />
            <span className="font-medium text-slate-200">
              {fmtAmt(fulfilledQar, lang)} / {fmtAmt(parentQarAmount, lang)} {currencyLabel(sendCurrency, lang)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-emerald-400">{progressPct.toFixed(0)}%</span>
            <span className="text-slate-400">{getFulfillmentLabel(fulfillmentStatus, lang)}</span>
          </div>
        </div>
        <Progress value={progressPct} className="mt-1 h-1.5" />

        {/* Note */}
        {note && (
          <div className={cn('mt-1.5 text-[10px] text-slate-400 italic', isRtl && 'text-right')}>
            💬 {note}
          </div>
        )}

        {/* Action buttons — stop propagation so they don't toggle expand */}
        {actions && (
          <div className="mt-2 border-t border-white/5 pt-2" onClick={e => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>

      {/* Expanded phase breakdown — full width, outside padding */}
      {expanded && hasPhases && (
        <div className="border-t border-white/8 bg-white/[0.02]">
          {executions.map((exec, idx) => {
            const egp = exec.executed_egp ?? exec.egp_received_amount ?? 0;
            const qar = exec.phase_consumed_qar ?? exec.sold_qar_amount ?? 0;
            const fx = exec.phase_qar_egp_fx ?? exec.fx_rate_qar_to_egp ?? 0;
            const isLast = idx === executions.length - 1;

            // Arabic-Eastern numerals when AR
            const fmtNum = (n: number, decimals = 0) =>
              isRtl
                ? Math.round(n).toLocaleString('ar-EG', { maximumFractionDigits: decimals })
                : Math.round(n).toLocaleString('en-US');
            const fmtRate = (n: number) =>
              isRtl
                ? n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : n.toFixed(2);

            // Currency labels
            const sendLbl = isRtl ? 'ريال' : sendCurrency;
            const recvLbl = isRtl ? 'جنية' : receiveCurrency;

            return (
              <div
                key={exec.id}
                dir={isRtl ? 'rtl' : 'ltr'}
                className={cn('px-3 py-2', !isLast && 'border-b border-white/5')}
              >
                <div className="flex items-center justify-between gap-2">
                  {/* Phase badge + sent amount */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[9px] font-bold text-sky-400">
                      {exec.sequence_number}
                    </span>
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-slate-100 tabular-nums">{fmtNum(qar)}</span>
                      <span className="text-[9px] text-slate-500 ml-0.5">{sendLbl}</span>
                    </div>
                  </div>

                  {/* Rate */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <span className="text-[9px] text-slate-500">@</span>
                    <span className="text-[11px] font-bold text-sky-300 tabular-nums">{fmtRate(fx)}</span>
                  </div>

                  {/* Received amount */}
                  <div className={cn('min-w-0', isRtl ? 'text-left' : 'text-right')}>
                    <span className="text-[11px] font-bold text-emerald-400 tabular-nums">{fmtNum(egp)}</span>
                    <span className="text-[9px] text-slate-500 ml-0.5">{recvLbl}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Weighted avg FX footer */}
          {weightedAvgFx && (
            <div
              dir={isRtl ? 'rtl' : 'ltr'}
              className="flex items-center justify-between px-3 py-2 border-t border-white/8"
            >
              <span className="text-[9px] text-slate-500">{L('Avg Rate', 'متوسط السعر')}</span>
              <span className="text-[11px] font-bold text-sky-300 tabular-nums">
                {isRtl
                  ? weightedAvgFx.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : weightedAvgFx.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
