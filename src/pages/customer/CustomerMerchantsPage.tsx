import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, UserPlus, Store, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function CustomerMerchantsPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [searchCode, setSearchCode] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);

  // Connected merchants
  const { data: connections = [] } = useQuery({
    queryKey: ['customer-connections', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_merchant_connections')
        .select('*')
        .eq('customer_user_id', userId!)
        .order('created_at', { ascending: false });
      if (!data) return [];
      // Fetch merchant profiles for each connection
      const merchantIds = data.map((c: any) => c.merchant_id);
      if (merchantIds.length === 0) return [];
      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, nickname, region, merchant_code')
        .in('merchant_id', merchantIds);
      const profileMap = new Map((profiles ?? []).map((p: any) => [p.merchant_id, p]));
      return data.map((c: any) => ({ ...c, merchant: profileMap.get(c.merchant_id) }));
    },
    enabled: !!userId,
  });

  // Search merchant
  const handleSearch = async () => {
    if (!searchCode.trim()) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const { data } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, nickname, region, merchant_code')
        .or(`merchant_code.eq.${searchCode.trim()},merchant_id.eq.${searchCode.trim()}`)
        .limit(1)
        .maybeSingle();
      if (data) {
        setSearchResult(data);
      } else {
        toast.error('Merchant not found');
      }
    } catch {
      toast.error('Search failed');
    } finally {
      setSearching(false);
    }
  };

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: async (merchantId: string) => {
      const { error } = await supabase.from('customer_merchant_connections').insert({
        customer_user_id: userId!,
        merchant_id: merchantId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Connection request sent!');
      setSearchResult(null);
      setSearchCode('');
      queryClient.invalidateQueries({ queryKey: ['customer-connections'] });
    },
    onError: (err: any) => {
      if (err?.message?.includes('duplicate')) {
        toast.error('Already connected to this merchant');
      } else {
        toast.error(err?.message || 'Failed to connect');
      }
    },
  });

  const isAlreadyConnected = (merchantId: string) =>
    connections.some((c: any) => c.merchant_id === merchantId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Merchants</h1>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Find a Merchant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter Merchant ID or Code..."
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
            </Button>
          </div>

          {searchResult && (
            <div className="mt-4 flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">{searchResult.display_name}</p>
                <p className="text-sm text-muted-foreground">
                  {searchResult.region} · {searchResult.merchant_code || searchResult.merchant_id}
                </p>
              </div>
              {isAlreadyConnected(searchResult.merchant_id) ? (
                <Badge variant="secondary">Connected</Badge>
              ) : (
                <Button
                  size="sm"
                  onClick={() => connectMutation.mutate(searchResult.merchant_id)}
                  disabled={connectMutation.isPending}
                >
                  <UserPlus className="h-4 w-4 mr-1" /> Connect
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connected merchants */}
      <div className="space-y-3">
        {connections.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Store className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">No merchants connected yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Search by Merchant ID or Code above to get started
              </p>
            </CardContent>
          </Card>
        ) : (
          connections.map((conn: any) => (
            <Card key={conn.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{conn.merchant?.display_name ?? conn.merchant_id}</p>
                  <p className="text-sm text-muted-foreground">
                    {conn.merchant?.region ?? '—'} · {conn.merchant?.merchant_code || conn.merchant_id}
                  </p>
                </div>
                <Badge variant={conn.status === 'active' ? 'default' : 'secondary'}>
                  {conn.status}
                </Badge>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
