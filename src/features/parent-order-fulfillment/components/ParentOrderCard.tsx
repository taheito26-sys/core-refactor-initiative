/**
 * ParentOrderCard
 *
 * Renders a collapsed summary row for a parent order. On click, expands
 * to show the ExpandedExecutionTable with all child executions.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.5
 */

import { useState, lazy, Suspense } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useParentOrderSummary } from '../hooks/useParentOrderSummary';
import type { FulfillmentStatus } from '../types';

// Lazy-load the execution table — only rendered when expanded (Req 6.5)
const ExpandedExecutionTable = lazy(
  () =>
    import('./ExpandedExecutionTable').then((m) => ({
      default: m.ExpandedExecutionTable,
    })),
);

interface ParentOrderCardProps {
  parentOrderId: string;
  parentQarAmount: number;
}

/** Badge color mapping for fulfillment status. */
const STATUS_BADGE: Record<
  FulfillmentStatus,
  { label: string; className: string }
> = {
  unfulfilled: {
    label: 'Unfulfilled',
    className: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  partially_fulfilled: {
    label: 'Partial',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  fully_fulfilled: {
    label: 'Fulfilled',
    className: 'bg-green-100 text-green-800 border-green-200',
  },
};

function fmtAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtRate(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 4,
  });
}

export function ParentOrderCard({
  parentOrderId,
  parentQarAmount,
}: ParentOrderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { summary, isLoading, error } = useParentOrderSummary(
    parentOrderId,
    parentQarAmount,
  );

  if (isLoading) {
    return (
      <Card className="animate-pulse">
        <CardContent className="p-4">
          <div className="h-6 bg-muted rounded w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (error || !summary) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          Failed to load order summary
        </CardContent>
      </Card>
    );
  }

  const statusBadge = STATUS_BADGE[summary.fulfillment_status];

  return (
    <Card>
      {/* Collapsed summary row — clickable to toggle */}
      <CardContent className="p-4">
        <button
          type="button"
          className="w-full text-left"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-3">
            {/* Expand/collapse chevron */}
            <span className="text-muted-foreground">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>

            {/* Summary metrics */}
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Fulfilled</span>
                <p className="font-mono font-medium">
                  {fmtAmount(summary.fulfilled_qar)} QAR
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Remaining</span>
                <p className="font-mono font-medium">
                  {fmtAmount(summary.remaining_qar)} QAR
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Avg FX</span>
                <p className="font-mono font-medium">
                  {summary.weighted_avg_fx !== null
                    ? fmtRate(summary.weighted_avg_fx)
                    : '—'}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">EGP Received</span>
                <p className="font-mono font-medium">
                  {fmtAmount(summary.total_egp_received)}
                </p>
              </div>
            </div>

            {/* Status badge + execution count */}
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={statusBadge.className}>
                {statusBadge.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {summary.fill_count} exec{summary.fill_count !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <Progress
              value={summary.progress_percent}
              className="h-2"
            />
            <p className="text-xs text-muted-foreground mt-1 text-right">
              {summary.progress_percent.toFixed(1)}%
            </p>
          </div>
        </button>

        {/* Expanded execution table — lazy loaded */}
        {expanded && (
          <div className="mt-4 border-t pt-4">
            <Suspense
              fallback={
                <div className="text-sm text-muted-foreground py-4 text-center">
                  Loading executions…
                </div>
              }
            >
              <ExpandedExecutionTable
                executions={summary.executions}
                parentQarAmount={parentQarAmount}
              />
            </Suspense>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
