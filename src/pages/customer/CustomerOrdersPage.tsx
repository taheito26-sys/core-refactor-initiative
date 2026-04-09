import { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, ShoppingCart, ArrowDownLeft, ArrowUpRight, X, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import OrderDetailView from './components/OrderDetailView';

export default function CustomerOrdersPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderType, setOrderType] = useState('buy');
  const [merchantId, setMerchantId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USDT');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');

  // Quick action from Home page
  useEffect(() => {
    const quickOrder = localStorage.getItem('customer_quick_order');
    if (quickOrder) {
      localStorage.removeItem('customer_quick_order');
      setOrderType(quickOrder);
      setShowForm(true);
    }
    const repeatOrder = localStorage.getItem('customer_repeat_order');
    if (repeatOrder) {
      localStorage.removeItem('customer_repeat_order');
      try {
        const data = JSON.parse(repeatOrder);
        setOrderType(data.order_type ?? 'buy');
        setMerchantId(data.merchant_id ?? '');
        setAmount(String(data.amount ?? ''));
        setRate(data.rate ? String(data.rate) : '');
        setCurrency(data.currency ?? 'USDT');
        setShowForm(true);
      } catch {}
    }
  }, []);

  const { data: connections = [] } = useQuery({
    queryKey: ['customer-active-connections', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_merchant_connections')
        .select('id, merchant_id, status')
        .eq('customer_user_id', userId!)
        .eq('status', 'active');
      if (!data || data.length === 0) return [];
      const mids = data.map((c: any) => c.merchant_id);
      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name')
        .in('merchant_id', mids);
      const pMap = new Map((profiles ?? []).map((p: any) => [p.merchant_id, p.display_name]));
      return data.map((c: any) => ({ ...c, merchantName: pMap.get(c.merchant_id) ?? c.merchant_id }));
    },
    enabled: !!userId,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['customer-orders', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_orders')
        .select('*')
        .eq('customer_user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(50);
      return data ?? [];
    },
    enabled: !!userId,
  });

  const parsedAmount = parseFloat(amount);
  const parsedRate = parseFloat(rate);
  const calculatedTotal = !isNaN(parsedAmount) && !isNaN(parsedRate) && parsedRate > 0
    ? parsedAmount * parsedRate
    : null;

  const placeOrder = useMutation({
    mutationFn: async () => {
      if (!merchantId) throw new Error('Select a merchant');
      if (isNaN(parsedAmount) || parsedAmount <= 0) throw new Error('Enter a valid amount');
      const conn = connections.find((c: any) => c.merchant_id === merchantId);
      if (!conn) throw new Error('Select a connected merchant');

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const { data: inserted, error } = await supabase.from('customer_orders').insert({
        customer_user_id: userId!,
        merchant_id: merchantId,
        connection_id: conn.id,
        order_type: orderType,
        amount: parsedAmount,
        currency,
        rate: !isNaN(parsedRate) && parsedRate > 0 ? parsedRate : null,
        total: calculatedTotal,
        note: note.trim() || null,
        expires_at: expiresAt,
      }).select('id').single();
      if (error) throw error;

      // Log order_created event
      if (inserted) {
        await supabase.from('customer_order_events').insert({
          order_id: inserted.id,
          event_type: 'order_created',
          actor_user_id: userId!,
          metadata: { order_type: orderType, amount: parsedAmount, currency },
        });
      }
    },
    onSuccess: () => {
      toast.success('Order placed!');
      setShowForm(false);
      setAmount('');
      setRate('');
      setNote('');
      setMerchantId('');
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
      queryClient.invalidateQueries({ queryKey: ['customer-home-stats'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to place order'),
  });

  const statusColor = (s: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (s === 'completed') return 'default';
    if (s === 'confirmed' || s === 'payment_sent') return 'secondary';
    if (s === 'cancelled') return 'destructive';
    return 'outline';
  };

  const merchantNames = new Map(connections.map((c: any) => [c.merchant_id, c.merchantName]));

  // Detail view
  if (selectedOrderId) {
    const order = orders.find((o: any) => o.id === selectedOrderId);
    return (
      <OrderDetailView
        orderId={selectedOrderId}
        merchantName={merchantNames.get(order?.merchant_id) ?? order?.merchant_id ?? 'Merchant'}
        onBack={() => setSelectedOrderId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Orders</h1>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
          {showForm ? 'Cancel' : 'New Order'}
        </Button>
      </div>

      {showForm && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Place an Order</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={orderType === 'buy' ? 'default' : 'outline'}
                className="gap-2"
                onClick={() => setOrderType('buy')}
              >
                <ArrowDownLeft className="h-4 w-4" /> Buy
              </Button>
              <Button
                type="button"
                variant={orderType === 'sell' ? 'default' : 'outline'}
                className="gap-2"
                onClick={() => setOrderType('sell')}
              >
                <ArrowUpRight className="h-4 w-4" /> Sell
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Merchant</Label>
              <Select value={merchantId} onValueChange={setMerchantId}>
                <SelectTrigger><SelectValue placeholder="Select merchant" /></SelectTrigger>
                <SelectContent>
                  {connections.map((c: any) => (
                    <SelectItem key={c.merchant_id} value={c.merchant_id}>
                      {c.merchantName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {connections.length === 0 && (
                <p className="text-xs text-muted-foreground">No connected merchants. <span className="text-primary cursor-pointer" onClick={() => window.location.href = '/c/merchants'}>Add one first</span>.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USDT">USDT</SelectItem>
                    <SelectItem value="QAR">QAR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Rate (optional)</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g. 3.65"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>

            {calculatedTotal !== null && (
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Estimated Total</p>
                <p className="text-lg font-bold">
                  {calculatedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    {currency === 'USDT' ? 'QAR' : 'USDT'}
                  </span>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Input placeholder="Add a note..." value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <Button
              onClick={() => placeOrder.mutate()}
              disabled={!amount || !merchantId || placeOrder.isPending}
              className="w-full"
            >
              {placeOrder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Place {orderType === 'buy' ? 'Buy' : 'Sell'} Order
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Orders list */}
      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ShoppingCart className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No orders yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Connect to a merchant and place your first order
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {orders.map((order: any) => (
            <Card
              key={order.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedOrderId(order.id)}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full shrink-0',
                      order.order_type === 'buy' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                    )}>
                      {order.order_type === 'buy' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium capitalize truncate">
                        {order.order_type} · {order.amount} {order.currency}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {merchantNames.get(order.merchant_id) ?? order.merchant_id}
                        {order.rate ? ` · @ ${order.rate}` : ' · Market'}
                        {order.total ? ` · Total: ${order.total.toLocaleString()}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={statusColor(order.status)} className="text-xs capitalize">
                      {order.status.replace('_', ' ')}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
