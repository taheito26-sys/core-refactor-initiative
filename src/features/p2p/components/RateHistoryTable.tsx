import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { type P2PSnapshotRow } from '../hooks/useP2PRateHistory';

interface RateHistoryTableProps {
  data: P2PSnapshotRow[] | undefined;
  isLoading: boolean;
}

export function RateHistoryTable({ data, isLoading }: RateHistoryTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-display">Order Book Preview</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : !data?.length ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No rate snapshots available for this market yet.
          </div>
        ) : (
          <div className="overflow-auto max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Buy</TableHead>
                  <TableHead className="text-right">Sell</TableHead>
                  <TableHead className="text-right">Spread</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => {
                  const spread =
                    row.buyRate != null && row.sellRate != null
                      ? row.sellRate - row.buyRate
                      : null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(row.fetched_at), 'MMM d, HH:mm')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.buyRate?.toFixed(4) ?? '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.sellRate?.toFixed(4) ?? '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {spread != null ? spread.toFixed(4) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
