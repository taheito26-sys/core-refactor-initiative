import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';

export default function CustomerOrdersPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [orderType, setOrderType] = useState('buy');
  const [merchantId, setMerchantId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USDT');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');

  // Active connections for the merchant selector
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

  // Orders
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

  const placeOrder = useMutation({
    mutationFn: async () => {
      const conn = connections.find((c: any) => c.merchant_id === merchantId);
      if (!conn) throw new Error('Select a connected merchant');
      const { error } = await supabase.from('customer_orders').insert({
        customer_user_id: userId!,
        merchant_id: merchantId,
        connection_id: conn.id,
        order_type: orderType,
        amount: parseFloat(amount),
        currency,
        rate: rate ? parseFloat(rate) : null,
        total: rate ? parseFloat(amount) * parseFloat(rate) : null,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order placed!');
      setShowForm(false);
      setAmount('');
      setRate('');
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to place order'),
  });

  const statusColor = (s: string) => {
    if (s === 'completed') return 'default';
    if (s === 'confirmed') return 'secondary';
    if (s === 'cancelled') return 'destructive';
    return 'outline';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Orders</h1>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-1" /> New Order
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Place an Order</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={orderType} onValueChange={setOrderType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                  </SelectContent>
                </Select>
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
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
              <div className="space-y-2">
                <Label>Rate (optional)</Label>
                <Input type="number" placeholder="3.65" value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Input placeholder="Optional note..." value={note} onChange={(e) => setNote(e.target.value)} />
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
        <div className="space-y-3">
          {orders.map((order: any) => (
            <Card key={order.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium capitalize">
                    {order.order_type} · {order.amount} {order.currency}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {order.rate ? `Rate: ${order.rate}` : 'Market rate'} · {new Date(order.created_at).toLocaleDateString()}
                  </p>
                  {order.note && <p className="text-xs text-muted-foreground mt-1">{order.note}</p>}
                </div>
                <Badge variant={statusColor(order.status)}>{order.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
