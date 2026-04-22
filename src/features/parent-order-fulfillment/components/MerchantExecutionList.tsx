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
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 px-4 py-3 text-center text-sm text-muted-foreground">
        No executions added yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Execution List */}
      <div className="space-y-1.5">
        {executions.map((execution) => (
          <div
            key={execution.id}
            className="flex items-center justify-between rounded-lg border border-border/50 bg-card px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {execution.sequence_number}
              </div>
              <div>
                <div className="font-semibold">{execution.sold_qar_amount.toFixed(2)} QAR</div>
                <div className="text-xs text-muted-foreground">
                  {formatFxRateDisplay(execution.fx_rate_qar_to_egp, 'QAR', 'EGP', language)}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-emerald-600">{execution.egp_received_amount.toFixed(2)} EGP</div>
              <div className="text-xs text-muted-foreground capitalize">{execution.market_type.replace('_', ' ')}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary Footer */}
      {summary && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-semibold text-primary">{summary.progress_percent.toFixed(1)}%</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Fulfilled</span>
            <span className="font-semibold">{summary.fulfilled_qar.toFixed(2)} / {summary.parent_qar_amount.toFixed(2)} QAR</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Remaining</span>
            <span className="font-semibold text-amber-600">{summary.remaining_qar.toFixed(2)} QAR</span>
          </div>
          {summary.weighted_avg_fx && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Weighted Avg FX</span>
              <span className="font-semibold">{formatFxRateDisplay(summary.weighted_avg_fx, 'QAR', 'EGP', language)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Total EGP</span>
            <span className="font-semibold text-emerald-600">{summary.total_egp_received.toFixed(2)} EGP</span>
          </div>
        </div>
      )}
    </div>
  );
}
