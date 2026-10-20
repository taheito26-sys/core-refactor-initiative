import { useMemo, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { agoLabel, dailyRegister, displayName, lastOnlineAt, onlineState, qatarDateTime } from '@/features/p2p/merchant-watch/merchant-watch';
import { MerchantNameEditor } from '@/features/p2p/merchant-watch/MerchantNameEditor';
import { useMerchantWatch } from '@/features/p2p/merchant-watch/useMerchantWatch';
import { BarChart3, Clock, Percent, ShoppingCart, Star, type LucideIcon } from 'lucide-react';
import { DhSelect } from './home/DhSelect';
import { dashboardDefaultPinned, merchantKpiOptions, resolvePinned, togglePinned, type KpiIcon, type KpiOption, type WatchedKpiSource } from '../kpi-catalog';
import { Sparkline } from './home/Sparkline';

const ICONS: Record<KpiIcon, LucideIcon> = { orders: ShoppingCart, online: Clock, conversion: Percent, clients: Star };
export type KpiPeriod = 'today' | '7d' | '30d';

const storageKey = (userId: string | null | undefined) => `dashboard-pinned-kpis:${userId ?? 'anon'}`;

function readPinned(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : null;
  } catch { return null; }
}

/**
 * User-chosen KPI boxes: any tracker figure the dashboard passes in plus the
 * daily order counts of the merchants followed on the P2P page.
 */
export function CustomKpis({ trackerOptions, lang, period, onPeriod }: { trackerOptions: KpiOption[]; lang: 'en' | 'ar'; period: KpiPeriod; onPeriod: (p: KpiPeriod) => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { userId } = useAuth();
  const key = storageKey(userId);
  const { watched, dailyByMerchant, byMerchant, rename } = useMerchantWatch();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[] | null>(() => readPinned(key));
  const [picking, setPicking] = useState(false);

  const sources = useMemo<WatchedKpiSource[]>(() => watched.filter(m => m.user_no).map(m => {
    const register = dailyRegister(dailyByMerchant.get(m.user_no!) ?? [], { since: new Date(m.created_at).getTime() });
    const latest = byMerchant.get(m.user_no!)?.at(-1);
    const seenAt = lastOnlineAt(latest);
    const state = onlineState(latest);
    return {
      userNo: m.user_no!, nick: displayName(m), binanceNick: m.nick, aka: m.aka ?? [],
      online: state.online,
      lastOnline: !latest || seenAt == null ? null : state.online ? L('Online now', 'متصل الآن') : agoLabel(Math.round((Date.now() - seenAt) / 1000), lang),
      lastOnlineExact: seenAt == null ? null : `${state.online ? L('now', 'الآن') : qatarDateTime(seenAt, lang)} · ${L('Qatar time', 'بتوقيت قطر')}`,
      today: register[0]?.orders ?? null, soldToday: register[0]?.sold ?? null,
      total: latest?.total_orders ?? null, month: latest?.month_orders ?? null,
    };
  }), [watched, dailyByMerchant, byMerchant, lang]);

  const options = useMemo(() => [...trackerOptions, ...merchantKpiOptions(sources, L('Followed P2P merchants', 'تجار P2P المتابَعون'))], [trackerOptions, sources, lang]);

  const update = (next: string[]) => {
    setPinned(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable: the choice lasts for this visit */ }
  };

  // Until the user picks something, the four boxes of the dashboard home are shown.
  const effectivePinned = pinned ?? dashboardDefaultPinned();
  const shown = resolvePinned(effectivePinned, options);
  const groups = Array.from(new Set(options.map(o => o.group)));

  return (
    <section className="dh-card dh-kpis">
      <header className="dh-kpis-head">
        <h2><svg className="dh-bars" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="11" width="5.5" height="11" rx="1.6" /><rect x="9.2" y="3" width="5.5" height="19" rx="1.6" /><rect x="16.5" y="8" width="5.5" height="14" rx="1.6" /></svg>{L('My KPIs', 'مؤشراتي')}</h2>
        <DhSelect
          value={period}
          onChange={onPeriod}
          ariaLabel={L('Period', 'الفترة')}
          options={[{ value: 'today', label: L('Today', 'اليوم') }, { value: '7d', label: L('7 Days', '7 أيام') }, { value: '30d', label: L('30 Days', '30 يوماً') }]}
          action={{ label: picking ? L('Done', 'تم') : L('Choose boxes…', 'اختيار المؤشرات…'), onClick: () => setPicking(p => !p) }}
        />
      </header>
      {shown.length === 0 && !picking && (
        <div className="dh-kempty">{L('Pick any figure to show here.', 'اختر أي رقم ليظهر هنا.')}</div>
      )}
      {shown.length > 0 && (
        <div className="dh-kgrid">
          {shown.map(o => {
            const Icon = o.icon ? ICONS[o.icon] : BarChart3;
            const tone = o.tone ?? 'brand';
            return (
              <div key={o.id} className="dh-kbox" style={{ ['--tone' as string]: `var(--${tone})` }}>
                <span className="dh-ic"><Icon /></span>
                <div className="dh-kbox-t">
                  <h3>{o.label}</h3>
                  <div className={`dh-val ${o.strong ? 'strong' : ''}`}><b>{o.value}</b></div>
                </div>
                <div className="dh-kbox-b">
                  {o.spark && o.spark.some(v => v !== 0) ? <Sparkline className="dh-kbox-spark" values={o.spark} color={`var(--${tone})`} /> : <span className="dh-kbox-spark" />}
                  {o.sub && <div className="dh-sub">{o.sub}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {picking && (
        <div className="dh-kpick">
          {watched.filter(m => m.user_no).length > 0 && (
            <div>
              <div className="grp">{L('Edit merchant names', 'تعديل أسماء التجار')}</div>
              <div className="opts">
                {watched.filter(m => m.user_no).map(m => editingId === m.id ? (
                  <MerchantNameEditor key={m.id} merchant={m} lang={lang} busy={rename.isPending}
                    onCancel={() => setEditingId(null)}
                    onSave={(alias, aka) => rename.mutate({ id: m.id, alias, aka }, { onSuccess: () => setEditingId(null) })} />
                ) : (
                  <button key={m.id} type="button" onClick={() => setEditingId(m.id)}>
                    ✎ {displayName(m)}{m.alias ? ` (${m.nick})` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          {groups.map(g => (
            <div key={g}>
              <div className="grp">{g}</div>
              <div className="opts">
                {options.filter(o => o.group === g).map(o => {
                  const on = effectivePinned.includes(o.id);
                  return (
                    <button key={o.id} type="button" className={on ? 'on' : ''}
                      onClick={() => update(togglePinned(effectivePinned, o.id))}>
                      {on ? '✓ ' : ''}{o.label} · {o.value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
