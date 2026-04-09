import { useAuth } from '@/features/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Store, ShoppingCart, MessageCircle, ArrowUpRight, ArrowDownLeft,
  Clock, TrendingUp, Repeat, AlertCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { getRooms } from '@/features/chat/api/chat';

export default function CustomerHomePage() {
  const { customerProfile, userId } = useAuth();
  const navigate = useNavigate();

  const { data: stats } = useQuery({
    queryKey: ['customer-home-stats', userId],
    queryFn: async () => {
      const [
        { count: connectionCount },
        { count: pendingOrderCount },
        { count: completedOrderCount },
        unreadCount,
      ] = await Promise.all([
        supabase
          .from('customer_merchant_connections')
          .select('*', { count: 'exact', head: true })
          .eq('customer_user_id', userId!)
          .eq('status', 'active'),
        supabase
          .from('customer_orders')
          .select('*', { count: 'exact', head: true })
          .eq('customer_user_id', userId!)
          .in('status', ['pending', 'confirmed']),
        supabase
          .from('customer_orders')
          .select('*', { count: 'exact', head: true })
          .eq('customer_user_id', userId!)
          .eq('status', 'completed'),
        getRooms().then((rooms) =>
          rooms.reduce((sum, room) => sum + (room.unread_count ?? 0), 0),
        ),
      ]);
      return {
        connections: connectionCount ?? 0,
        pendingOrders: pendingOrderCount ?? 0,
        completedOrders: completedOrderCount ?? 0,
        unreadMessages: unreadCount ?? 0,
      };
    },
    enabled: !!userId,
  });

  // Recent orders
  const { data: recentOrders = [] } = useQuery({
    queryKey: ['customer-recent-orders', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_orders')
        .select('*')
        .eq('customer_user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(5);
      return data ?? [];
    },
    enabled: !!userId,
  });

  // Last order for "Repeat" action
  const lastOrder = recentOrders[0] ?? null;

  const statusBadge = (s: string) => {
    const map: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      confirmed: 'secondary',
      cancelled: 'destructive',
      pending: 'outline',
    };
    return map[s] ?? 'outline';
  };

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Welcome, {customerProfile?.display_name} 👋
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your trading dashboard — check status, act fast.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-3">
        <Button
          variant="default"
          className="h-auto flex-col gap-1 py-4"
          onClick={() => {
            localStorage.setItem('customer_quick_order', 'buy');
            navigate('/c/orders');
          }}
        >
          <ArrowDownLeft className="h-5 w-5" />
          <span className="text-xs font-medium">Quick Buy</span>
        </Button>
        <Button
          variant="secondary"
          className="h-auto flex-col gap-1 py-4"
          onClick={() => {
            localStorage.setItem('customer_quick_order', 'sell');
            navigate('/c/orders');
          }}
        >
          <ArrowUpRight className="h-5 w-5" />
          <span className="text-xs font-medium">Quick Sell</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto flex-col gap-1 py-4"
          disabled={!lastOrder}
          onClick={() => {
            if (lastOrder) {
              localStorage.setItem('customer_repeat_order', JSON.stringify({
                order_type: lastOrder.order_type,
                merchant_id: lastOrder.merchant_id,
                amount: lastOrder.amount,
                currency: lastOrder.currency,
                rate: lastOrder.rate,
              }));
              navigate('/c/orders');
            }
          }}
        >
          <Repeat className="h-5 w-5" />
          <span className="text-xs font-medium">Repeat</span>
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/c/merchants')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Store className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Merchants</span>
            </div>
            <p className="text-2xl font-bold">{stats?.connections ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/c/orders')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Pending</span>
            </div>
            <p className="text-2xl font-bold">{stats?.pendingOrders ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/c/chat')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <MessageCircle className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Unread</span>
            </div>
            <p className="text-2xl font-bold">{stats?.unreadMessages ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/c/orders')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Completed</span>
            </div>
            <p className="text-2xl font-bold">{stats?.completedOrders ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Pending Orders Alert */}
      {(stats?.pendingOrders ?? 0) > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">
                {stats!.pendingOrders} order{stats!.pendingOrders > 1 ? 's' : ''} awaiting action
              </p>
              <p className="text-xs text-muted-foreground">Check your orders for updates</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/c/orders')}>
              View
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Recent Activity
        </h2>
        {recentOrders.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <ShoppingCart className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No recent orders</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentOrders.map((order: any) => (
              <Card key={order.id} className="cursor-pointer hover:shadow-sm transition-shadow" onClick={() => navigate('/c/orders')}>
                <CardContent className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full',
                      order.order_type === 'buy' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                    )}>
                      {order.order_type === 'buy' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium capitalize">
                        {order.order_type} · {order.amount} {order.currency}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.created_at).toLocaleDateString()} · {order.rate ? `@ ${order.rate}` : 'Market'}
                      </p>
                    </div>
                  </div>
                  <Badge variant={statusBadge(order.status)} className="text-xs">
                    {order.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
