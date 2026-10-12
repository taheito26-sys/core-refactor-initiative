import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { dailyRegister } from '@/features/p2p/merchant-watch/merchant-watch';
import { useMerchantWatch } from '@/features/p2p/merchant-watch/useMerchantWatch';
import { defaultPinned, merchantKpiOptions, resolvePinned, togglePinned, type KpiOption, type WatchedKpiSource } from '../kpi-catalog';

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
export function CustomKpis({ trackerOptions, lang }: { trackerOptions: KpiOption[]; lang: 'en' | 'ar' }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { userId } = useAuth();
  const key = storageKey(userId);
  const { watched, dailyByMerchant, byMerchant } = useMerchantWatch();
  const [pinned, setPinned] = useState<string[] | null>(() => readPinned(key));
  const [picking, setPicking] = useState(false);

  const sources = useMemo<WatchedKpiSource[]>(() => watched.filter(m => m.user_no).map(m => {
    const register = dailyRegister(dailyByMerchant.get(m.user_no!) ?? [], { since: new Date(m.created_at).getTime() });
    const latest = byMerchant.get(m.user_no!)?.at(-1);
    return {
      userNo: m.user_no!, nick: m.nick,
      today: register[0]?.orders ?? null, soldToday: register[0]?.sold ?? null,
      total: latest?.total_orders ?? null, month: latest?.month_orders ?? null,
    };
  }), [watched, dailyByMerchant, byMerchant]);

  const options = useMemo(() => [...trackerOptions, ...merchantKpiOptions(sources, L('Followed P2P merchants', 'تجار P2P المتابَعون'))], [trackerOptions, sources, lang]);

  // Nothing chosen yet: pin the followed merchant's daily count once, as soon as one is identified.
  useEffect(() => {
    if (pinned === null && sources.length > 0) setPinned(defaultPinned(sources));
  }, [pinned, sources]);

  const update = (next: string[]) => {
    setPinned(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable: the choice lasts for this visit */ }
  };

  const shown = resolvePinned(pinned ?? [], options);
  const groups = Array.from(new Set(options.map(o => o.group)));

  return (
    <div className="panel" style={{ padding: 10, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>📌 {L('My KPIs', 'مؤشراتي')}</div>
        <button type="button" className="rowBtn" onClick={() => setPicking(p => !p)}>
          {picking ? L('Done', 'تم') : `＋ ${L('Add / remove', 'إضافة / إزالة')}`}
        </button>
      </div>
      {shown.length === 0 && !picking && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{L('Pick any figure to show here.', 'اختر أي رقم ليظهر هنا.')}</div>
      )}
      {shown.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
          {shown.map(o => (
            <div key={o.id} className="kpi-card">
              <div className="kpi-lbl" style={{ overflowWrap: 'anywhere' }}>{o.label}</div>
              <div className={`kpi-val ${o.strong ? 'good' : ''}`}>{o.value}</div>
              {o.sub && <div className="kpi-sub">{o.sub}</div>}
            </div>
          ))}
        </div>
      )}
      {picking && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map(g => (
            <div key={g}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', marginBottom: 4 }}>{g}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {options.filter(o => o.group === g).map(o => {
                  const on = (pinned ?? []).includes(o.id);
                  return (
                    <button key={o.id} type="button" className={on ? 'btn' : 'rowBtn'} style={{ fontSize: 11 }}
                      onClick={() => update(togglePinned(pinned ?? [], o.id))}>
                      {on ? '✓ ' : ''}{o.label} · {o.value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
