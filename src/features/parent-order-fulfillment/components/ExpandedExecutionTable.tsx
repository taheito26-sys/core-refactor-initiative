/**
 * ExpandedExecutionTable
 *
 * Renders a table of child OrderExecution rows for a parent order.
 * Shown lazily when the user expands a ParentOrderCard.
 *
 * Requirements: 6.2, 6.3, 6.4
 */

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { OrderExecution, ExecutionStatus, MarketType } from '../types';

interface ExpandedExecutionTableProps {
  executions: OrderExecution[];
  parentQarAmount: number;
}

/** Format a number to a fixed number of decimal places. */
function fmtAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format FX rate with 3–4 decimal places. */
function fmtRate(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 4,
  });
}

/** Format an ISO date string to a readable date. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const STATUS_COLORS: Record<ExecutionStatus, string> = {
  completed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
};

const MARKET_LABELS: Record<MarketType, string> = {
  instapay_v1: 'InstaPay',
  p2p: 'P2P',
  bank: 'Bank',
  manual: 'Manual',
};

export function ExpandedExecutionTable({
  executions,
  parentQarAmount,
}: ExpandedExecutionTableProps) {
  // Compute footer aggregates from completed executions only
  const completed = executions.filter((e) => e.status === 'completed');
  const totalSold = completed.reduce((sum, e) => sum + e.sold_qar_amount, 0);
  const totalEgp = completed.reduce((sum, e) => sum + e.egp_received_amount, 0);
  const remaining = parentQarAmount - totalSold;
  const weightedAvgFx = totalSold > 0 ? totalEgp / totalSold : null;
  const completionPct = parentQarAmount > 0 ? (totalSold / parentQarAmount) * 100 : 0;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Sold QAR</TableHead>
          <TableHead className="text-right">FX Rate</TableHead>
          <TableHead className="text-right">EGP Received</TableHead>
          <TableHead>Market</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {executions.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
              No executions yet
            </TableCell>
          </TableRow>
        ) : (
          executions.map((exec) => (
            <TableRow key={exec.id}>
              <TableCell className="font-mono text-muted-foreground">
                {exec.sequence_number}
              </TableCell>
              <TableCell>{fmtDate(exec.executed_at)}</TableCell>
              <TableCell className="text-right font-mono">
                {fmtAmount(exec.sold_qar_amount)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmtRate(exec.fx_rate_qar_to_egp)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmtAmount(exec.egp_received_amount)}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {MARKET_LABELS[exec.market_type] ?? exec.market_type}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={STATUS_COLORS[exec.status] ?? ''}
                >
                  {exec.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
      {executions.length > 0 && (
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2} className="font-semibold">
              Totals
            </TableCell>
            <TableCell className="text-right font-mono font-semibold">
              {fmtAmount(totalSold)}
            </TableCell>
            <TableCell className="text-right font-mono font-semibold">
              {weightedAvgFx !== null ? fmtRate(weightedAvgFx) : '—'}
            </TableCell>
            <TableCell className="text-right font-mono font-semibold">
              {fmtAmount(totalEgp)}
            </TableCell>
            <TableCell colSpan={2} className="text-sm text-muted-foreground">
              Remaining: {fmtAmount(remaining)} QAR · {completionPct.toFixed(1)}% complete
            </TableCell>
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
