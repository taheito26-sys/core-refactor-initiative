import { Warehouse, DollarSign, Clock, TrendingUp, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { useStockSummary, useStockDeals } from '@/features/stock/hooks/useStock';

function statusVariant(status: string) {
  switch (status) {
    case 'active': return 'default';
    case 'completed': return 'secondary';
    case 'cancelled': return 'destructive';
    default: return 'outline';
  }
}

export default function StockPage() {
  const { data: summary, isLoading: summaryLoading } = useStockSummary();
  const { data: deals, isLoading: dealsLoading } = useStockDeals();

  return (
    <div className="app-page-shell">
      <div className="app-page-content space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground">Stock</h1>
          <p className="text-sm text-muted-foreground mt-1">Inventory and capital overview</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {summaryLoading ? (
            [1, 2, 3, 4, 5].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2"><Skeleton className="h-4 w-20" /></CardHeader>
                <CardContent><Skeleton className="h-7 w-16" /></CardContent>
              </Card>
            ))
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5" /> Total Deployed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xl font-bold font-display">
                    {summary?.totalDeployed.toLocaleString() ?? 0}
                  </span>
                  <p className="text-[10px] text-muted-foreground">{summary?.currency}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Pending
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xl font-bold font-display text-yellow-600">
                    {summary?.pendingAmount.toLocaleString() ?? 0}
                  </span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" /> Settled
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xl font-bold font-display">
                    {summary?.settledAmount.toLocaleString() ?? 0}
                  </span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5" /> Profit
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xl font-bold font-display text-primary">
                    {summary?.profitAmount.toLocaleString() ?? 0}
                  </span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Warehouse className="h-3.5 w-3.5" /> Active Deals
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xl font-bold font-display">
                    {summary?.activeDealCount ?? 0}
                  </span>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Deals Breakdown Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display flex items-center gap-2">
              <Warehouse className="h-4 w-4" />
              Capital Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dealsLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
            ) : !deals?.length ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No stock data yet. Capital will be tracked as deals are created.
              </div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Settled</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="hidden sm:table-cell">Progress</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deals.map((deal) => {
                      const progress = deal.amount > 0 ? Math.min(100, (deal.settled / deal.amount) * 100) : 0;
                      return (
                        <TableRow key={deal.id}>
                          <TableCell>
                            <div>
                              <span className="font-medium text-sm">{deal.title}</span>
                              <p className="text-[10px] text-muted-foreground">
                                {format(new Date(deal.created_at), 'MMM d, yyyy')}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {deal.amount.toLocaleString()} {deal.currency}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {deal.settled.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-primary">
                            {deal.profit > 0 ? `+${deal.profit.toLocaleString()}` : deal.profit.toLocaleString()}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <div className="flex items-center gap-2">
                              <Progress value={progress} className="h-1.5 w-16" />
                              <span className="text-[10px] text-muted-foreground">{progress.toFixed(0)}%</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(deal.status)} className="capitalize text-xs">
                              {deal.status}
                            </Badge>
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
      </div>
    </div>
  );
}
