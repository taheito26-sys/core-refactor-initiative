import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Star, StarOff, UserPlus, CheckCircle, Clock, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';

type Connection = {
  id: string;
  merchant_id: string;
  status: string;
  is_preferred: boolean;
  merchant?: { merchant_id: string; display_name: string; region: string | null; merchant_code: string | null } | null;
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  active:  <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />,
  pending: <Clock className="h-3.5 w-3.5 text-amber-500" />,
  blocked: <XCircle className="h-3.5 w-3.5 text-red-500" />,
};

export default function CustomerMerchantsPage() {
  const { userId } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ['c-connections', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_merchant_connections')
        .select('*')
        .eq('customer_user_id', userId!)
        .order('created_at', { ascending: false });
      const ids = (data ?? []).map(c => c.merchant_id);
      if (!ids.length) return [];
      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, region, merchant_code')
        .in('merchant_id', ids);
      const map = new Map((profiles ?? []).map(p => [p.merchant_id, p]));
      return (data ?? []).map(c => ({ ...c, merchant: map.get(c.merchant_id) ?? null }));
    },
    enabled: !!userId,
  });

  const isConnected = (id: string) => connections.some(c => c.merchant_id === id);

  const search = async () => {
    if (!code.trim()) return;
    setSearching(true); setResult(null);
    try {
      const { data } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, region, merchant_code')
        .or(`merchant_code.ilike.${code.trim()},merchant_id.ilike.${code.trim()}`)
        .limit(1)
        .maybeSingle();
      setResult(data ?? null);
      if (!data) toast.error(lang === 'ar' ? 'لم يُعثر على تاجر' : 'Merchant not found');
    } finally { setSearching(false); }
  };

  const connect = useMutation({
    mutationFn: async (merchantId: string) => {
      const { error } = await supabase.from('customer_merchant_connections').insert({
        customer_user_id: userId,
        merchant_id: merchantId,
        status: 'pending',
        is_preferred: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تم إرسال الطلب' : 'Request sent');
      qc.invalidateQueries({ queryKey: ['c-connections', userId] });
      setResult(null); setCode('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const togglePreferred = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase
        .from('customer_merchant_connections')
        .update({ is_preferred: val })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['c-connections', userId] }),
  });

  const sorted = [...connections].sort((a, b) => {
    if (a.is_preferred && !b.is_preferred) return -1;
    if (!a.is_preferred && b.is_preferred) return 1;
    return (a.merchant?.display_name ?? '').localeCompare(b.merchant?.display_name ?? '');
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{lang === 'ar' ? 'التجار' : 'Merchants'}</h1>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder={lang === 'ar' ? 'رمز التاجر…' : 'Merchant code…'}
            className="h-10 w-full rounded-xl border border-border/50 bg-card ps-9 pe-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <button
          onClick={search}
          disabled={searching}
          className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : (lang === 'ar' ? 'بحث' : 'Search')}
        </button>
      </div>

      {/* Search result */}
      {result && (
        <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{result.display_name}</p>
            <p className="text-xs text-muted-foreground">{result.merchant_code} · {result.region}</p>
          </div>
          {isConnected(result.merchant_id) ? (
            <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'مرتبط' : 'Connected'}</span>
          ) : (
            <button
              onClick={() => connect.mutate(result.merchant_id)}
              disabled={connect.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {lang === 'ar' ? 'ربط' : 'Connect'}
            </button>
          )}
        </div>
      )}

      {/* Connection list */}
      {sorted.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {lang === 'ar' ? 'لا يوجد تجار مرتبطون' : 'No merchants yet'}
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(c => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-bold text-foreground">
                {(c.merchant?.display_name?.[0] ?? '?').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{c.merchant?.display_name ?? c.merchant_id}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {STATUS_ICON[c.status] ?? null}
                  <span className="text-[11px] text-muted-foreground">{c.merchant?.region ?? ''}</span>
                </div>
              </div>
              <button
                onClick={() => togglePreferred.mutate({ id: c.id, val: !c.is_preferred })}
                className="shrink-0 p-1 text-muted-foreground hover:text-amber-500 transition-colors"
              >
                {c.is_preferred
                  ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  : <StarOff className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
