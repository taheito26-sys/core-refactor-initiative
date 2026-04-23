/**
 * ParentOrderCard
 *
 * For the CUSTOMER portal: shows a compact progress card for phased orders.
 * Clicking expands to show phase details.
 * Only renders content for phased orders — returns null for complete orders.
 *
 * USDT-based progress: fulfilled_usdt / required_usdt
 * Displays: total QAR, total EGP, progress %, weighted avg FX, phase breakdown
 */

import { useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useParentOrderSummary } from '../hooks/useParentOrderSummary';
import { useOrderExecutions } from '../hooks/useOrderExecutions';

interface ParentOrderCardProps {
  parentOrderId: string;
  parentQarAmount: number;
  fulfillmentMode?: string | null;
}

function fmtAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ParentOrderCard({
  parentOrderId,
  parentQarAmount,
  fulfillmentMode,
}: ParentOrderCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Only render for phased orders
  if (fulfillmentMode !== 'phased') {
    return null;
  }

  return <PhasedOrderProgress parentOrderId={parentOrderId} expanded={expanded} onToggle={() => setExpanded(prev => !prev)} />;
}

/** Inner component that uses hooks (avoids conditional hook calls) */
function PhasedOrderProgress({
  parentOrderId,
  expanded,
  onToggle,
}: {
  parentOrderId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { data: summary, isLoading, error } = useParentOrderSummary(parentOrderId);
  const { data: executions = [] } = useOrderExecutions(parentOrderId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-blue-500/5 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading progress...
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>📦 Phased delivery</span>
          <span>·</span>
          <span>No phases yet</span>
        </div>
        <Progress value={0} className="mt-1.5 h-1.5" />
      </div>
    );
  }

  const progressPct = summary.progress_percent ?? 0;
  const isFull = summary.fulfillment_status === 'fully_fulfilled';
  const totalEgp = summary.total_egp_received ?? 0;
  const fulfilledQar = summary.fulfilled_qar ?? 0;
  const totalFulfilledUsdt = summary.total_fulfilled_usdt ?? 0;
  const requiredUsdt = summary.required_usdt ?? 0;

  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 space-y-1.5">
      {/* Compact progress header */}
      <button
        type="button"
        className="w-full text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </span>
            <span className="font-medium">
              {isFull ? '📦 Fully delivered' : '📦 Phased delivery'}
            </span>
          </div>
          <span className="font-semibold text-primary">{progressPct.toFixed(0)}%</span>
        </div>
      </button>

      {/* Summary line */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">
          {fmtAmount(fulfilledQar)} / {fmtAmount(summary.parent_qar_amount)} QAR
        </span>
        {totalEgp > 0 && (
          <span className="font-medium text-emerald-600">
            {fmtAmount(totalEgp)} EGP
          </span>
        )}
        {requiredUsdt > 0 && (
          <span className="text-muted-foreground">
            USDT: {fmtAmount(totalFulfilledUsdt)}/{fmtAmount(requiredUsdt)}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <Progress value={progressPct} className="h-1.5" />

      {/* Expanded: show phase breakdown */}
      {expanded && executions.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-blue-500/10">
          {executions.map((exec) => {
            const egp = exec.executed_egp ?? exec.egp_received_amount ?? 0;
            const qar = exec.phase_consumed_qar ?? exec.sold_qar_amount ?? 0;
            const fx = exec.phase_qar_egp_fx ?? exec.fx_rate_qar_to_egp ?? 0;

            return (
              <div key={exec.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {exec.sequence_number}
                  </span>
                  <span className="font-medium">{fmtAmount(qar)} QAR</span>
                  <span className="text-muted-foreground">@ {fx.toFixed(4)}</span>
                </div>
                <span className="font-medium text-emerald-600">{fmtAmount(egp)} EGP</span>
              </div>
            );
          })}
          {/* Weighted avg FX */}
          {summary.weighted_avg_fx && (
            <div className="flex items-center justify-between text-xs pt-1 border-t border-blue-500/10">
              <span className="text-muted-foreground">Weighted Avg FX</span>
              <span className="font-semibold">{summary.weighted_avg_fx.toFixed(4)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
