import { useOrderExecutions } from '../hooks/useOrderExecutions';
import { useParentOrderSummary } from '../hooks/useParentOrderSummary';
import { Loader2 } from 'lucide-react';
import { formatFxRateDisplay } from '@/lib/currency-locale';

interface Props {
  parentOrderId: string;
  language?: 'en' | 'ar';
}

export function MerchantExecutionList({ parentOrderId, language = 'en' }: Props) {
  const { data: executions = [], isLoading: executionsLoading } = useOrderExecutions(parentOrderId);
  const { data: summary, isLoading: summaryLoading } = useParentOrderSummary(parentOrderId);

  if (executionsLoading || summaryLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading...
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No executions yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Compact execution chips */}
      <div className="flex flex-wrap gap-1.5">
        {executions.map((execution) => (
          <div
            key={execution.id}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-2 py-1 text-xs"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              {execution.sequence_number}
            </span>
            <span className="font-semibold">{execution.sold_qar_amount.toFixed(0)}</span>
            <span className="text-muted-foreground">@</span>
            <span className="font-medium">{execution.fx_rate_qar_to_egp.toFixed(4)}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-semibold text-emerald-600">{execution.egp_received_amount.toFixed(0)}</span>
          </div>
        ))}
      </div>

      {/* Compact summary */}
      {summary && (
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Progress:</span>
            <span className="font-semibold text-primary">{summary.progress_percent.toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Fulfilled:</span>
            <span className="font-semibold">{summary.fulfilled_qar.toFixed(0)}/{summary.parent_qar_amount.toFixed(0)}</span>
          </div>
          {summary.remaining_qar > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Remaining:</span>
              <span className="font-semibold text-amber-600">{summary.remaining_qar.toFixed(0)}</span>
            </div>
          )}
          {summary.weighted_avg_fx && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Avg FX:</span>
              <span className="font-semibold">{summary.weighted_avg_fx.toFixed(4)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
