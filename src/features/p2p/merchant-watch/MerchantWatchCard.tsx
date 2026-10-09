import { useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useExchangeP2POrders } from '@/features/exchanges/hooks/useExchangeP2POrders';
import { agoLabel, onlineState, ordersPerDay, type MerchantSnapshot, type WatchedMerchant } from './merchant-watch';
import { useMerchantWatch } from './useMerchantWatch';

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));

function DayBars({ values, labels, lang }: { values: Array<number | null>; labels: string[]; lang: 'en' | 'ar' }) {
  const max = Math.max(1, ...values.map(v => v ?? 0));
  const W = 224, H = 46, gap = 6, bw = (W - gap * (values.length - 1)) / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label={lang === 'ar' ? 'الطلبات يوميًا' : 'Orders per day'}>
      {values.map((v, i) => {
        const h = v == null ? 0 : Math.max(v > 0 ? 3 : 1, (v / max) * H);
        const x = i * (bw + gap);
        const today = i === values.length - 1;
        return (
          <g key={i}>
            <rect x={x} y={H - h} width={bw} height={h} rx={2} fill={today ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.45)'} />
            {v != null && v > 0 && (
              <text x={x + bw / 2} y={H - h - 2} textAnchor="middle" fontSize="8" fill="hsl(var(--foreground))">{v}</text>
            )}
            <text x={x + bw / 2} y={H + 11} textAnchor="middle" fontSize="7.5" fill="hsl(var(--muted-foreground))">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function WaitingTile({ merchant, lang, onRemove }: { merchant: WatchedMerchant; lang: 'en' | 'ar'; onRemove: () => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  return (
    <div className="rounded-xl border border-dashed border-amber-500/50 bg-amber-500/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" />
            <span className="truncate text-sm font-bold" dir="ltr">{merchant.nick}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {L('Waiting for this merchant to list an ad. Binance only shows merchants who are advertising, so tracking starts the moment they do (checked every few minutes).',
              'بانتظار أن يعرض هذا التاجر إعلانًا. لا تُظهر Binance إلا التجّار المعلنين، فيبدأ التتبّع فور ظهوره (يُفحص كل بضع دقائق).')}
          </p>
        </div>
        <button type="button" onClick={onRemove} aria-label={L('Stop following', 'إلغاء المتابعة')} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function MerchantTile({ merchant, snaps, lang, onRemove }: { merchant: WatchedMerchant; snaps: MerchantSnapshot[]; lang: 'en' | 'ar'; onRemove: () => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const latest = snaps.at(-1);
  const state = onlineState(latest);
  const total = ordersPerDay(snaps, { days: 7, field: 'total_orders' });
  const sold = ordersPerDay(snaps, { days: 1, field: 'sell_orders' });
  const todayAll = total.at(-1)?.orders ?? null;
  const todaySold = sold.at(0)?.orders ?? null;
  const labels = total.map(d => new Date(`${d.day}T00:00`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'narrow' }));

  return (
    <div className={cn('rounded-xl border p-3 space-y-2.5', state.online ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border/50 bg-card')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', state.online ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40')} />
            <span className="truncate text-sm font-bold" dir="ltr">{merchant.nick}</span>
          </div>
          <div className={cn('text-[11px] mt-0.5', state.online ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {!latest
              ? L('Waiting for the first reading…', 'بانتظار أول قراءة…')
              : state.online
                ? L('Online now', 'متصل الآن')
                : `${L('Offline · last seen', 'غير متصل · آخر ظهور')} ${agoLabel(state.lastSeenSeconds, lang)}`}
            {latest && state.stale && <span className="ms-1 text-amber-600">({L('reading is old', 'القراءة قديمة')})</span>}
          </div>
        </div>
        <button type="button" onClick={onRemove} aria-label={L('Stop following', 'إلغاء المتابعة')} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[
          { label: L('Today', 'اليوم'), value: todayAll == null ? '—' : `+${todayAll}`, strong: (todayAll ?? 0) > 0 },
          { label: L('Sold today', 'باع اليوم'), value: todaySold == null ? '—' : `+${todaySold}`, strong: (todaySold ?? 0) > 0 },
          { label: L('Total', 'الإجمالي'), value: fmt(latest?.total_orders) },
          { label: L('30 days', '30 يوم'), value: fmt(latest?.month_orders) },
        ].map(s => (
          <div key={s.label} className="rounded-md border border-border/40 px-1 py-1.5">
            <div className={cn('font-mono text-sm font-extrabold tabular-nums', s.strong && 'text-primary')}>{s.value}</div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <DayBars values={total.map(d => d.orders)} labels={labels} lang={lang} />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{L('Orders completed per day, last 7 days', 'الطلبات المكتملة يوميًا، آخر 7 أيام')}</span>
        {latest?.finish_rate != null && <span>{L('Completion', 'الإتمام')} {(latest.finish_rate * 100).toFixed(1)}%</span>}
      </div>
    </div>
  );
}

/**
 * The Binance P2P merchants this user follows: whether each is online right
 * now and how many orders they complete each day. The user picks who to follow,
 * from merchants they have traded with or by name, id or profile link.
 */
export function MerchantWatchCard() {
  const t = useT();
  const lang: 'en' | 'ar' = t.lang === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { watched, byMerchant, loading, unavailable, add, remove, refresh } = useMerchantWatch();
  const { data: orders } = useExchangeP2POrders({ includeDismissed: true });
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Merchants this user bought USDT from, most traded first, minus the ones already followed.
  const traded = useMemo(() => {
    const followed = new Set(watched.map(w => w.nick.trim().toLowerCase()));
    const counts = new Map<string, { count: number; advNos: Set<string>; fiats: Set<string> }>();
    for (const o of orders ?? []) {
      if (o.exchange !== 'binance' || o.side !== 'buy' || !o.counterparty?.trim()) continue;
      const name = o.counterparty.trim();
      const entry = counts.get(name) ?? { count: 0, advNos: new Set<string>(), fiats: new Set<string>() };
      entry.count += 1;
      if (o.fiat) entry.fiats.add(String(o.fiat).toUpperCase());
      // The ad number Binance recorded on the order points at the exact merchant even when the name is masked.
      const advNo = (o.raw as { advNo?: unknown } | null | undefined)?.advNo;
      if (advNo) entry.advNos.add(String(advNo));
      counts.set(name, entry);
    }
    return [...counts.entries()]
      .filter(([name]) => !followed.has(name.toLowerCase()))
      .map(([name, v]) => ({ name, count: v.count, advNos: [...v.advNos], fiats: [...v.fiats] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [orders, watched]);

  const submit = () => {
    const q = query.trim();
    if (!q || add.isPending) return;
    add.mutate({ query: q }, { onSuccess: (r) => { if (r.kind === 'added') setQuery(''); } });
  };
  const doRefresh = async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">{L('My merchants', 'تجّاري')}</CardTitle>
        <div className="flex gap-1.5">
          {watched.length > 0 && (
            <Button size="sm" variant="outline" onClick={doRefresh} disabled={refreshing} aria-label={L('Refresh now', 'تحديث الآن')}>
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button size="sm" onClick={() => setAdding(a => !a)}>
            <Plus className="me-1 h-3.5 w-3.5" />{L('Follow a merchant', 'متابعة تاجر')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="space-y-2 rounded-lg border border-border/50 p-3">
            {traded.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{L('Merchants you bought from', 'تجّار اشتريت منهم')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {traded.map(({ name, count, advNos, fiats }) => (
                    <button key={name} type="button" disabled={add.isPending} onClick={() => add.mutate({ query: name, advNos, fiats })}
                      className="rounded-full border border-border/60 px-2.5 py-1 text-xs hover:border-primary hover:bg-primary/10 disabled:opacity-50" dir="ltr">
                      {name} <span className="text-muted-foreground">· {count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {add.data?.kind === 'choose' && (
              <div className="space-y-1.5 rounded-md border border-primary/40 bg-primary/5 p-2">
                <div className="text-[11px] font-semibold">{L('Several merchants match. Pick the right one:', 'عدة تجّار يطابقون. اختر الصحيح:')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {add.data.candidates.map(c => (
                    <button key={c.userNo} type="button" disabled={add.isPending} onClick={() => add.mutate({ query: c.userNo })}
                      className="rounded-full border border-border/60 bg-card px-2.5 py-1 text-xs hover:border-primary disabled:opacity-50" dir="ltr">
                      {c.nick} <span className="text-muted-foreground">· {fmt(c.monthOrders)} / 30d</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-1.5">
              <Input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                placeholder={L('Nickname, merchant id or profile link', 'الاسم أو معرّف التاجر أو رابط الملف')} dir="ltr" />
              <Button onClick={submit} disabled={!query.trim() || add.isPending}>
                {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : L('Add', 'إضافة')}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {L('Binance hides part of the name in your order history. A merchant is identified while they have an ad listed. If they have none, they stay on your list and tracking starts when they list one. You can also paste the link from their Binance profile page.',
                'تُخفي Binance جزءًا من الاسم في سجل طلباتك. يُتعرّف على التاجر ما دام له إعلان معروض، وإلا يبقى في قائمتك ويبدأ التتبّع حين يعرض إعلانًا. ويمكنك لصق رابط ملفه في Binance.')}
            </p>
          </div>
        )}

        {unavailable && <p className="text-xs text-amber-600">{L('The merchant list is not available yet. Try again in a moment.', 'قائمة التجّار غير متاحة بعد. حاول بعد قليل.')}</p>}
        {loading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {!loading && !unavailable && watched.length === 0 && (
          <p className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            {L('Follow the merchants you trade with to see when they are online and how many orders they complete every day.',
              'تابع التجّار الذين تتعامل معهم لترى متى يكونون متصلين وكم طلبًا ينفّذون كل يوم.')}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {watched.map(m => (m.user_no
            ? <MerchantTile key={m.id} merchant={m} snaps={byMerchant.get(m.user_no) ?? []} lang={lang} onRemove={() => remove.mutate(m.id)} />
            : <WaitingTile key={m.id} merchant={m} lang={lang} onRemove={() => remove.mutate(m.id)} />))}
        </div>
      </CardContent>
    </Card>
  );
}
