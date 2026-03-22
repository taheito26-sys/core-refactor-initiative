import { useState } from 'react';
import { format } from 'date-fns';
import { Package, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrders } from '@/features/orders/hooks/useOrders';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusVariant(status: string) {
  switch (status) {
    case 'active': return 'default';
    case 'completed': return 'secondary';
    case 'cancelled': return 'destructive';
    default: return 'outline';
  }
}

export default function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const { data: orders, isLoading } = useOrders(statusFilter);

  return (
    <div className="app-page-shell">
      <div className="app-page-content space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold font-display text-foreground">Orders</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your trades and orders</p>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {isLoading ? (
            [1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2"><Skeleton className="h-4 w-16" /></CardHeader>
                <CardContent><Skeleton className="h-7 w-12" /></CardContent>
              </Card>
            ))
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Total</CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xl font-bold font-display">{orders?.length ?? 0}</span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Pending</CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xl font-bold font-display text-yellow-600">
                    {orders?.filter((o) => o.status === 'pending').length ?? 0}
                  </span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Active</CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xl font-bold font-display text-primary">
                    {orders?.filter((o) => o.status === 'active').length ?? 0}
                  </span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Completed</CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xl font-bold font-display">
                    {orders?.filter((o) => o.status === 'completed').length ?? 0}
                  </span>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Orders Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display flex items-center gap-2">
              <Package className="h-4 w-4" />
              Order List
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
            ) : !orders?.length ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No orders found. Deals created within relationships will appear here.
              </div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {order.deal_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(order.amount).toLocaleString()} {order.currency}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(order.status)} className="capitalize text-xs">
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                          {format(new Date(order.created_at), 'MMM d, yyyy')}
                        </TableCell>
                      </TableRow>
                    ))}
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
