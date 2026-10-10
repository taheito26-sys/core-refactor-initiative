import { useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useExchangeP2POrders } from '@/features/exchanges/hooks/useExchangeP2POrders';
import { agoLabel, dailyRegister, eventsByDay, onlineState, qatarClock, type DailyRow, type MerchantSnapshot, type OrderEvent, type WatchedMerchant } from './merchant-watch';
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

/** Reads the clipboard on a tap; returns '' when the browser refuses. */
async function readClipboard(): Promise<string> {
  try { return (await navigator.clipboard.readText()).trim(); } catch { return ''; }
}

function WaitingTile({ merchant, lang, busy, onIdentify, onRemove }: {
  merchant: WatchedMerchant; lang: 'en' | 'ar'; busy: boolean; onIdentify: (link: string) => void; onRemove: () => void;
}) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [link, setLink] = useState('');
  const paste = async () => {
    const text = await readClipboard();
    if (text) { setLink(text); onIdentify(text); }
  };
  return (
    <div className="rounded-xl border border-dashed border-amber-500/50 bg-amber-500/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" />
            <span className="truncate text-sm font-bold" dir="ltr">{merchant.nick}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {L('Binance hides this merchant’s id behind the masked name. To start now: open their profile in Binance, tap Share, copy the link, and paste it here. Otherwise tracking starts by itself when they list an ad.',
              'تُخفي Binance معرّف هذا التاجر خلف الاسم المقنّع. للبدء الآن: افتح ملفه في Binance، اضغط مشاركة، انسخ الرابط والصقه هنا. وإلا يبدأ التتبّع تلقائيًا عند عرضه إعلانًا.')}
          </p>
          <div className="mt-2 flex gap-1.5">
            <Input value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && link.trim()) onIdentify(link.trim()); }}
              placeholder={L('Profile link or merchant id', 'رابط الملف أو معرّف التاجر')} dir="ltr" className="h-8 text-xs" />
            <Button size="sm" variant="outline" disabled={busy} onClick={paste}>{L('Paste', 'لصق')}</Button>
            <Button size="sm" disabled={busy || !link.trim()} onClick={() => onIdentify(link.trim())}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : L('Track', 'تتبّع')}
            </Button>
          </div>
        </div>
        <button type="button" onClick={onRemove} aria-label={L('Stop following', 'إلغاء المتابعة')} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function MerchantTile({ merchant, snaps, daily, events, lang, onRemove }: {
  merchant: WatchedMerchant; snaps: MerchantSnapshot[]; daily: DailyRow[]; events: OrderEvent[]; lang: 'en' | 'ar'; onRemove: () => void;
}) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [logOpen, setLogOpen] = useState(false);
  const latest = snaps.at(-1);
  const state = onlineState(latest);
  // Every day since this merchant was followed, newest first.
  const register = dailyRegister(daily, { since: new Date(merchant.created_at).getTime() });
  const week = register.slice(0, 7).reverse();
  const bars = [...Array.from({ length: 7 - week.length }, () => null), ...week.map(d => d.orders)] as Array<number | null>;
  const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', opts);
  const labels = [...Array.from({ length: 7 - week.length }, () => ''), ...week.map(d => dayLabel(d.day, { weekday: 'narrow' }))];
  const todayAll = register[0]?.orders ?? null;
  const todaySold = register[0]?.sold ?? null;
  const since = daily.length > 0 ? daily[0] : undefined;
  const totalAdded = register.reduce((sum, d) => sum + d.orders, 0);
  const eventsOfDay = eventsByDay(events);

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

      <DayBars values={bars} labels={labels} lang={lang} />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{L('Orders completed per day, last 7 days', 'الطلبات المكتملة يوميًا، آخر 7 أيام')}</span>
        {latest?.finish_rate != null && <span>{L('Completion', 'الإتمام')} {(latest.finish_rate * 100).toFixed(1)}%</span>}
      </div>

      <button type="button" onClick={() => setLogOpen(o => !o)} className="w-full rounded-md border border-border/50 px-2 py-1.5 text-start text-[11px] font-semibold hover:bg-muted/40">
        {logOpen ? '▾' : '▸'} {L('Daily log', 'السجل اليومي')}
        <span className="ms-1 font-normal text-muted-foreground">
          {L(`+${totalAdded} orders since you followed`, `+${totalAdded} طلب منذ المتابعة`)}
        </span>
      </button>
      {logOpen && (
        <div className="space-y-1.5">
          {since?.baseline_total != null && (
            <p className="text-[10px] text-muted-foreground">
              {L(`Tracking since ${new Date(merchant.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, from ${fmt(since.baseline_total)} orders. Times are Qatar time (UTC+3).`,
                `التتبّع منذ ${new Date(merchant.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}، من ${fmt(since.baseline_total)} طلب. الأوقات بتوقيت قطر (UTC+3).`)}
            </p>
          )}
          <div className="overflow-hidden rounded-md border border-border/40">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 bg-muted/30 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
              <span>{L('Day', 'اليوم')}</span><span className="text-end">{L('Orders', 'الطلبات')}</span><span className="text-end">{L('Sold', 'باع')}</span><span className="text-end">{L('Total', 'الإجمالي')}</span>
            </div>
            {register.map(d => (
              <div key={d.day} className="border-t border-border/30">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 bg-muted/20 px-2 py-1 text-[11px] font-semibold tabular-nums">
                  <span>{dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span className={cn('text-end font-mono font-bold', d.orders > 0 && 'text-primary')}>+{d.orders}</span>
                  <span className="text-end font-mono text-muted-foreground">+{d.sold}</span>
                  <span className="text-end font-mono text-muted-foreground">{fmt(d.endTotal)}</span>
                </div>
                {(eventsOfDay.get(d.day) ?? []).map(e => (
                  <div key={e.id} className="flex items-baseline justify-between gap-2 px-2 py-0.5 text-[10.5px] tabular-nums">
                    <span className="font-mono font-bold" dir="ltr">{qatarClock(e.detected_at)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground" dir="ltr">
                      {`${L('after', 'بعد')} ${qatarClock(e.prev_read_at)}`}
                    </span>
                    <span className="font-mono font-semibold text-primary">+{e.orders}{e.sells ? ` (${L('sold', 'باع')} ${e.sells})` : ''}</span>
                    <span className="font-mono text-muted-foreground">{fmt(e.total_after)}</span>
                  </div>
                ))}
              </div>
            ))}
            {register.length === 0 && <div className="px-2 py-2 text-[11px] text-muted-foreground">{L('Waiting for the first reading…', 'بانتظار أول قراءة…')}</div>}
          </div>
        </div>
      )}
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
  const { watched, byMerchant, dailyByMerchant, eventsByMerchant, loading, unavailable, add, identify, remove, refresh } = useMerchantWatch();
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
                <div className="text-[11px] font-semibold">{L('Binance hides the rest of the name, so I cannot be sure. Pick the right merchant, or paste their profile link:', 'تُخفي Binance بقية الاسم فلا أستطيع الجزم. اختر التاجر الصحيح أو الصق رابط ملفه:')}</div>
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
              <Button variant="outline" disabled={add.isPending} onClick={async () => {
                const text = await readClipboard();
                if (text) { setQuery(text); add.mutate({ query: text }, { onSuccess: (r) => { if (r.kind === 'added') setQuery(''); } }); }
              }}>{L('Paste', 'لصق')}</Button>
              <Button onClick={submit} disabled={!query.trim() || add.isPending}>
                {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : L('Add', 'إضافة')}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {L('Binance hides part of the name in your order history. The most reliable way: open the merchant’s profile in Binance, tap Share, copy the link and paste it here. It works even when they have no ad. A merchant who is advertising is also found from the name.',
                'تُخفي Binance جزءًا من الاسم في سجل طلباتك. الأضمن: افتح ملف التاجر في Binance، اضغط مشاركة، انسخ الرابط والصقه هنا. ينجح حتى بلا إعلان. ويُعثر أيضًا على التاجر المعلن من اسمه.')}
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
            ? <MerchantTile key={m.id} merchant={m} snaps={byMerchant.get(m.user_no) ?? []} daily={dailyByMerchant.get(m.user_no) ?? []} events={eventsByMerchant.get(m.user_no) ?? []} lang={lang} onRemove={() => remove.mutate(m.id)} />
            : <WaitingTile key={m.id} merchant={m} lang={lang} busy={identify.isPending && identify.variables?.id === m.id}
                onIdentify={link => identify.mutate({ id: m.id, link })} onRemove={() => remove.mutate(m.id)} />))}
        </div>
      </CardContent>
    </Card>
  );
}
