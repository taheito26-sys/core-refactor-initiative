import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface Props {
  userId: string;
  onBack: () => void;
}

export function AdminCustomerWorkspace({ userId, onBack }: Props) {
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['admin-customer-profile', userId],
    queryFn: async () => {
      const [{ data: p }, { data: cp }] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', userId).single(),
        supabase.from('customer_profiles').select('*').eq('user_id', userId).single(),
      ]);
      return { ...p, ...cp };
    },
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['admin-customer-connections', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_merchant_connections')
        .select('*')
        .eq('customer_user_id', userId)
        .order('created_at', { ascending: false });
      if (!data?.length) return [];
      const merchantIds = data.map((c: any) => c.merchant_id);
      const { data: merchants } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, merchant_code, region')
        .in('merchant_id', merchantIds);
      const mMap = new Map((merchants ?? []).map((m: any) => [m.merchant_id, m]));
      return data.map((c: any) => ({ ...c, merchant: mMap.get(c.merchant_id) }));
    },
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['admin-customer-orders', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_orders')
        .select('*')
        .eq('customer_user_id', userId)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['admin-customer-messages', userId],
    queryFn: async () => {
      const { data: conns } = await supabase
        .from('customer_merchant_connections')
        .select('id')
        .eq('customer_user_id', userId);
      if (!conns?.length) return [];
      const connIds = conns.map((c: any) => c.id);
      const { data } = await supabase
        .from('customer_messages')
        .select('*')
        .in('connection_id', connIds)
        .order('created_at', { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h2 className="text-lg font-semibold text-foreground flex-1">
          Customer Workspace — {profile?.display_name || userId.slice(0, 8)}
        </h2>
      </div>

      {profileLoading ? <Skeleton className="h-24" /> : profile ? (
        <Card>
          <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 text-xs">
            <div><span className="text-muted-foreground">Name</span><p className="font-medium">{profile.display_name}</p></div>
            <div><span className="text-muted-foreground">Email</span><p>{profile.email}</p></div>
            <div><span className="text-muted-foreground">Phone</span><p>{profile.phone ?? '—'}</p></div>
            <div><span className="text-muted-foreground">Region</span><p>{profile.region ?? '—'}</p></div>
            <div><span className="text-muted-foreground">Status</span><p><Badge variant="outline" className="text-[10px]">{profile.status}</Badge></p></div>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="connections" className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
          <TabsTrigger value="connections" className="text-xs">Merchants ({connections.length})</TabsTrigger>
          <TabsTrigger value="orders" className="text-xs">Orders ({orders.length})</TabsTrigger>
          <TabsTrigger value="messages" className="text-xs">Messages ({messages.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="mt-3">
          {!connections.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No connections.</p>
          ) : (
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Merchant</TableHead>
                    <TableHead className="text-xs">Code</TableHead>
                    <TableHead className="text-xs">Region</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Connected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs font-medium">{c.merchant?.display_name ?? c.merchant_id}</TableCell>
                      <TableCell className="text-xs font-mono">{c.merchant?.merchant_code ?? '—'}</TableCell>
                      <TableCell className="text-xs">{c.merchant?.region ?? '—'}</TableCell>
                      <TableCell><Badge variant={c.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{c.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), 'MMM d, yyyy')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="orders" className="mt-3">
          {!orders.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No orders.</p>
          ) : (
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Amount</TableHead>
                    <TableHead className="text-xs">Currency</TableHead>
                    <TableHead className="text-xs">Rate</TableHead>
                    <TableHead className="text-xs">Total</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o: any) => (
                    <TableRow key={o.id}>
                      <TableCell><Badge variant="outline" className="text-[10px]">{o.order_type}</Badge></TableCell>
                      <TableCell className="text-xs">{Number(o.amount).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{o.currency}</TableCell>
                      <TableCell className="text-xs">{o.rate ?? '—'}</TableCell>
                      <TableCell className="text-xs">{o.total ? Number(o.total).toLocaleString() : '—'}</TableCell>
                      <TableCell><Badge variant={o.status === 'completed' ? 'default' : o.status === 'cancelled' ? 'destructive' : 'secondary'} className="text-[10px]">{o.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(o.created_at), 'MMM d, yyyy')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="messages" className="mt-3">
          {!messages.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No messages.</p>
          ) : (
            <div className="border rounded-lg overflow-auto max-h-96">
              <div className="space-y-2 p-3">
                {messages.map((m: any) => (
                  <div key={m.id} className="flex gap-2 text-xs">
                    <Badge variant="outline" className="text-[9px] shrink-0">{m.sender_role}</Badge>
                    <p className="flex-1 text-foreground">{m.content}</p>
                    <span className="text-muted-foreground shrink-0">{format(new Date(m.created_at), 'HH:mm MMM d')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
