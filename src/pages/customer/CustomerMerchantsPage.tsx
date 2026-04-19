import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, UserPlus, Store, Loader2, Star, StarOff, ChevronDown, ChevronUp, CheckCircle2, Clock, XCircle, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';

type MerchantConnection = {
  id: string;
  customer_user_id: string;
  merchant_id: string;
  status: string;
  is_preferred: boolean;
  created_at: string;
  merchant?: {
    merchant_id: string;
    display_name: string;
    region: string | null;
    merchant_code: string | null;
  } | null;
};

export default function CustomerMerchantsPage() {
  const { userId } = useAuth();
  const t = useT();
  const queryClient = useQueryClient();
  const [searchCode, setSearchCode] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [metricsCache, setMetricsCache] = useState<Record<string, any>>({});
  const [metricsLoading, setMetricsLoading] = useState<string | null>(null);

  const { data: connections = [] } = useQuery({
    queryKey: ['customer-connections', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_merchant_connections')
        .select('*')
        .eq('customer_user_id', userId!)
        .order('created_at', { ascending: false });
      if (error) return [] as MerchantConnection[];

      const merchantIds = (data ?? []).map((connection) => connection.merchant_id);
      if (merchantIds.length === 0) return [] as MerchantConnection[];

      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, region, merchant_code')
        .in('merchant_id', merchantIds);
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.merchant_id, profile]));

      return (data ?? []).map((connection) => ({
        ...connection,
        merchant: profileMap.get(connection.merchant_id) ?? null,
      })) as MerchantConnection[];
    },
    enabled: !!userId,
  });

  const sorted = useMemo(
    () => [...connections].sort((a, b) => {
      if (a.is_preferred && !b.is_preferred) return -1;
      if (!a.is_preferred && b.is_preferred) return 1;
      return (a.merchant?.display_name ?? '').localeCompare(b.merchant?.display_name ?? '');
    }),
    [connections],
  );

  const isAlreadyConnected = (merchantId: string) => connections.some((connection) => connection.merchant_id === merchantId);

  const handleSearch = async () => {
    if (!searchCode.trim()) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const { data, error } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, region, merchant_code')
        .or(`merchant_code.eq.${searchCode.trim()},merchant_id.eq.${searchCode.trim()}`)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setSearchResult(data);
    } catch {
      toast.error(t('merchantNotFound'));
    } finally {
      setSearching(false);
    }
  };

  const connectMutation = useMutation({
    mutationFn: async (merchantId: string) => {
      const { data: merchantProfile, error: merchantError } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, user_id, display_name')
        .eq('merchant_id', merchantId)
        .maybeSingle();
      if (merchantError) throw merchantError;

      const { error } = await supabase.from('customer_merchant_connections').insert({
        customer_user_id: userId!,
        merchant_id: merchantId,
      });
      if (error) throw error;

      if (merchantProfile?.user_id) {
        await supabase.from('notifications').insert({
          user_id: merchantProfile.user_id,
          title: 'New customer connection request',
          body: 'Customer requested a connection',
          category: 'customer_connection',
          target_path: '/merchants?tab=clients',
          target_entity_type: 'customer_merchant_connection',
          target_entity_id: merchantId,
        });
      }
    },
    onSuccess: () => {
      toast.success(t('connectionSent'));
      setSearchResult(null);
      setSearchCode('');
      queryClient.invalidateQueries({ queryKey: ['customer-connections'] });
    },
    onError: (error: any) => toast.error(error?.message ?? t('connectFailed')),
  });

  const togglePreferred = useMutation({
    mutationFn: async ({ connId, value }: { connId: string; value: boolean }) => {
      const { error } = await supabase
        .from('customer_merchant_connections')
        .update({ is_preferred: value })
        .eq('id', connId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer-connections'] }),
    onError: () => toast.error(t('updatePreferredFailed')),
  });

  const loadMetrics = async (merchantId: string) => {
    if (metricsCache[merchantId]) return;
    setMetricsLoading(merchantId);
    try {
      const { data, error } = await supabase.rpc('merchant_trust_metrics', {
        p_merchant_id: merchantId,
        p_customer_user_id: userId!,
      });
      if (error) return;
      setMetricsCache((prev) => ({ ...prev, [merchantId]: data }));
    } catch {
      toast.error(t('metricsLoadFailed'));
    } finally {
      setMetricsLoading(null);
    }
  };

  const handleExpand = (connection: MerchantConnection) => {
    if (expandedId === connection.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(connection.id);
    void loadMetrics(connection.merchant_id);
  };

  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="relative border-b border-border/60 px-4 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent" />
          <div className="relative">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">{t('customerMerchants')}</div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground">{t('myMerchants')}</h1>
            <p className="text-sm text-muted-foreground">{t('merchantConnectionSubtitle')}</p>
          </div>
        </div>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" /> {t('findMerchant')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder={t('merchantSearchPlaceholder')}
              value={searchCode}
              onChange={(event) => setSearchCode(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleSearch()}
            />
            <Button onClick={() => void handleSearch()} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : t('search')}
            </Button>
          </div>

          {searchResult && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{searchResult.display_name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {searchResult.region ?? t('nA')} · {searchResult.merchant_code || searchResult.merchant_id}
                </p>
              </div>
              {isAlreadyConnected(searchResult.merchant_id) ? (
                <Badge variant="secondary">{t('connected')}</Badge>
              ) : (
                <Button size="sm" onClick={() => connectMutation.mutate(searchResult.merchant_id)} disabled={connectMutation.isPending}>
                  <UserPlus className="mr-1 h-4 w-4" /> {t('connect')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {sorted.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Store className="mb-3 h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground">{t('noMerchantsConnected')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('merchantSearchHelp')}</p>
            </CardContent>
          </Card>
        ) : (
          sorted.map((connection) => {
            const expanded = expandedId === connection.id;
            const metrics = metricsCache[connection.merchant_id];
            const loading = metricsLoading === connection.merchant_id;

            return (
              <Card key={connection.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => handleExpand(connection)}>
                    <div className="relative">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                        {connection.merchant?.display_name?.[0]?.toUpperCase() ?? 'M'}
                      </div>
                      {connection.status === 'active' && <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-medium text-foreground">{connection.merchant?.display_name ?? connection.merchant_id}</p>
                        {connection.is_preferred && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500" />}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {connection.merchant?.region ?? t('nA')} · {connection.merchant?.merchant_code || connection.merchant_id}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge
                          variant={connection.status === 'active' ? 'default' : connection.status === 'blocked' ? 'destructive' : 'secondary'}
                          className="capitalize"
                        >
                          {connection.status}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {connection.status === 'pending'
                            ? 'Pending customer connection'
                            : connection.status === 'active'
                              ? 'Active customer connection'
                              : 'Blocked customer connection'}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(event) => {
                          event.stopPropagation();
                          togglePreferred.mutate({ connId: connection.id, value: !connection.is_preferred });
                        }}
                      >
                        {connection.is_preferred ? <StarOff className="h-4 w-4 text-amber-500" /> : <Star className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {expanded && (
                    <div className="space-y-3 border-t bg-muted/30 p-3">
                      {loading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : metrics ? (
                        <>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('trustMetrics')}</p>
                          <div className="grid grid-cols-2 gap-3">
                            <MetricCard icon={<CheckCircle2 className="h-4 w-4 text-primary" />} label={t('completionRate')} value={`${metrics.completion_rate}%`} />
                            <MetricCard icon={<Clock className="h-4 w-4 text-amber-500" />} label={t('avgResponse')} value={metrics.avg_response_minutes > 0 ? `${metrics.avg_response_minutes} ${t('minutesShort')}` : '—'} />
                            <MetricCard icon={<TrendingUp className="h-4 w-4 text-primary" />} label={t('totalTrades')} value={metrics.total_trades} />
                            <MetricCard icon={<XCircle className="h-4 w-4 text-destructive" />} label={t('failedTrades')} value={metrics.cancelled_trades} />
                          </div>
                        </>
                      ) : (
                        <p className="text-center text-sm text-muted-foreground">{t('noDataAvailable')}</p>
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

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background p-2.5">
      {icon}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}
