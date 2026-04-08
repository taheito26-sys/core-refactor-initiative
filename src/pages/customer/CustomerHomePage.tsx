import { useAuth } from '@/features/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Store, ShoppingCart, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

export default function CustomerHomePage() {
  const { customerProfile, userId } = useAuth();
  const navigate = useNavigate();

  const { data: stats } = useQuery({
    queryKey: ['customer-home-stats', userId],
    queryFn: async () => {
      const [{ count: connectionCount }, { count: orderCount }] = await Promise.all([
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
      ]);
      return { connections: connectionCount ?? 0, pendingOrders: orderCount ?? 0 };
    },
    enabled: !!userId,
  });

  const cards = [
    { title: 'My Merchants', value: stats?.connections ?? 0, icon: Store, path: '/c/merchants', color: 'text-blue-500' },
    { title: 'Active Orders', value: stats?.pendingOrders ?? 0, icon: ShoppingCart, path: '/c/orders', color: 'text-green-500' },
    { title: 'Messages', value: '—', icon: MessageCircle, path: '/c/chat', color: 'text-purple-500' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Welcome, {customerProfile?.display_name} 👋
        </h1>
        <p className="text-muted-foreground mt-1">
          Find merchants, check rates, and manage your orders.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {cards.map((card) => (
          <Card
            key={card.path}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(card.path)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={cn('h-5 w-5', card.color)} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ');
}
