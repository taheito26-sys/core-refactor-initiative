import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Search, UserPlus, Store, Loader2, Star, StarOff,
  ChevronDown, ChevronUp, CheckCircle2, Clock, XCircle,
  TrendingUp, Circle
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function CustomerMerchantsPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [searchCode, setSearchCode] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [metricsCache, setMetricsCache] = useState<Record<string, any>>({});
  const [metricsLoading, setMetricsLoading] = useState<string | null>(null);

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

  // Sort: preferred first, then by name
  const sorted = [...connections].sort((a: any, b: any) => {
    if (a.is_preferred && !b.is_preferred) return -1;
    if (!a.is_preferred && b.is_preferred) return 1;
    return (a.merchant?.display_name ?? '').localeCompare(b.merchant?.display_name ?? '');
  });

  // Search
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
      if (data) setSearchResult(data);
      else toast.error('Merchant not found');
    } catch {
      toast.error('Search failed');
    } finally {
      setSearching(false);
    }
  };

  // Connect
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
      if (err?.message?.includes('duplicate')) toast.error('Already connected');
      else toast.error(err?.message || 'Failed to connect');
    },
  });

  // Toggle preferred
  const togglePreferred = useMutation({
    mutationFn: async ({ connId, value }: { connId: string; value: boolean }) => {
      const { error } = await supabase
        .from('customer_merchant_connections')
        .update({ is_preferred: value })
        .eq('id', connId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-connections'] });
    },
    onError: () => toast.error('Failed to update preference'),
  });

  // Fetch trust metrics
  const loadMetrics = async (merchantId: string) => {
    if (metricsCache[merchantId]) return;
    setMetricsLoading(merchantId);
    try {
      const { data, error } = await supabase.rpc('merchant_trust_metrics', {
        p_merchant_id: merchantId,
        p_customer_user_id: userId!,
      });
      if (error) throw error;
      setMetricsCache((prev) => ({ ...prev, [merchantId]: data }));
    } catch {
      toast.error('Could not load metrics');
    } finally {
      setMetricsLoading(null);
    }
  };

  const handleExpand = (conn: any) => {
    const id = conn.id;
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      loadMetrics(conn.merchant_id);
    }
  };

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
      <div className="space-y-2">
        {sorted.length === 0 ? (
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
          sorted.map((conn: any) => {
            const expanded = expandedId === conn.id;
            const metrics = metricsCache[conn.merchant_id];
            const loading = metricsLoading === conn.merchant_id;

            return (
              <Card key={conn.id} className="overflow-hidden">
                <CardContent className="p-0">
                  {/* Main row */}
                  <div className="flex items-center gap-3 p-3">
                    {/* Avatar */}
                    <div className="relative">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold shrink-0">
                        {conn.merchant?.display_name?.[0]?.toUpperCase() ?? 'M'}
                      </div>
                      {/* Availability dot — placeholder, always shows active for connected */}
                      {conn.status === 'active' && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium truncate">{conn.merchant?.display_name ?? conn.merchant_id}</p>
                        {conn.is_preferred && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {conn.merchant?.region ?? '—'} · {conn.merchant?.merchant_code || conn.merchant_id}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreferred.mutate({ connId: conn.id, value: !conn.is_preferred });
                        }}
                        title={conn.is_preferred ? 'Remove preferred' : 'Mark preferred'}
                      >
                        {conn.is_preferred
                          ? <StarOff className="h-4 w-4 text-amber-500" />
                          : <Star className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleExpand(conn)}
                      >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded trust metrics */}
                  {expanded && (
                    <div className="border-t bg-muted/30 p-3 space-y-3">
                      {loading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : metrics ? (
                        <>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trust Metrics</p>
                          <div className="grid grid-cols-2 gap-3">
                            <MetricCard
                              icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
                              label="Completion Rate"
                              value={`${metrics.completion_rate}%`}
                            />
                            <MetricCard
                              icon={<Clock className="h-4 w-4 text-amber-500" />}
                              label="Avg Response"
                              value={metrics.avg_response_minutes > 0 ? `${metrics.avg_response_minutes} min` : '—'}
                            />
                            <MetricCard
                              icon={<TrendingUp className="h-4 w-4 text-primary" />}
                              label="Total Trades"
                              value={metrics.total_trades}
                            />
                            <MetricCard
                              icon={<XCircle className="h-4 w-4 text-destructive" />}
                              label="Failed Trades"
                              value={metrics.cancelled_trades}
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center">No data available</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-background p-2.5 border">
      {icon}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-bold">{value}</p>
      </div>
    </div>
  );
}
