import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { ZoomControls } from '@/components/shared/ZoomControls';
import { PeriodPicker } from '@/components/shared/PeriodPicker';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { useDashboardFilters } from '../../dashboard-filters';
import type { DashPoint, OrderScope } from '../../dashboard-model';

/** The orders-and-period filter the funnel button in the top bar opens. */
export function DashboardFilterSheet() {
  const t = useT();
  const { filterOpen, setFilterOpen, scope, setScope, customFrom, customTo, setCustom, reset } = useDashboardFilters();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  if (!filterOpen) return null;
  const scopes: Array<{ id: OrderScope; label: string }> = [
    { id: 'all', label: t('dhAllOrders') },
    { id: 'own', label: t('dhOwnOrders') },
    { id: 'partner', label: t('dhPartnerOrders') },
  ];
  return (
    <div className="dh-sheet-scrim" onClick={() => setFilterOpen(false)}>
      <div className="dh-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('dhFilters')}>
        <header className="dh-sheet-head">
          <h2><SlidersHorizontal />{t('dhFilters')}</h2>
          <button type="button" onClick={() => setFilterOpen(false)} aria-label={t('dhClose')}><X /></button>
        </header>
        <div className="dh-sheet-sec">
          <label>{t('dhOrdersShown')}</label>
          <div className="dh-seg">
            {scopes.map(s => (
              <button key={s.id} type="button" className={scope === s.id ? 'on' : ''} onClick={() => setScope(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>
        <div className="dh-sheet-sec">
          <label>{t('dhCustomPeriod')}</label>
          <PeriodPicker
            from={customFrom}
            to={customTo}
            onChange={(from, to) => setCustom(from, to)}
            lang={lang}
            title={t('dhCustomPeriod')}
            emptyLabel={t('dhCustomPeriod')}
          />
          <p className="dh-sheet-hint">{t('dhCustomHint')}</p>
        </div>
        <div className="dh-sheet-sec dh-sheet-zoom">
          <label>{t('dhZoomLabel')}</label>
          <ZoomControls />
        </div>
        <footer className="dh-sheet-foot">
          <button type="button" className="dh-btn ghost" onClick={reset}>{t('dhReset')}</button>
          <button type="button" className="dh-btn" onClick={() => setFilterOpen(false)}>{t('dhApply')}</button>
        </footer>
      </div>
    </div>
  );
}

/** The client-and-order search the magnifier in the top bar opens: a result jumps to the Orders page for that client. */
export function DashboardSearchSheet({ points }: { points: DashPoint[] }) {
  const t = useT();
  const { update } = useTheme();
  const navigate = useNavigate();
  const { searchOpen, setSearchOpen } = useDashboardFilters();
  const [q, setQ] = useState('');

  const clients = useMemo(() => {
    const map = new Map<string, { orders: number; net: number }>();
    for (const p of points) {
      if (!p.client) continue;
      const row = map.get(p.client) ?? { orders: 0, net: 0 };
      row.orders += 1;
      row.net += p.net;
      map.set(p.client, row);
    }
    return [...map.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.orders - a.orders);
  }, [points]);

  if (!searchOpen) return null;
  const needle = q.trim().toLowerCase();
  const matches = (needle ? clients.filter(c => c.name.toLowerCase().includes(needle)) : clients).slice(0, 8);
  const go = (query: string) => {
    update({ searchQuery: query });
    setSearchOpen(false);
    navigate('/trading/orders');
  };
  return (
    <div className="dh-sheet-scrim" onClick={() => setSearchOpen(false)}>
      <div className="dh-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('dhSearchTitle')}>
        <header className="dh-sheet-head">
          <h2><Search />{t('dhSearchTitle')}</h2>
          <button type="button" onClick={() => setSearchOpen(false)} aria-label={t('dhClose')}><X /></button>
        </header>
        <form className="dh-search" onSubmit={e => { e.preventDefault(); if (q.trim()) go(q.trim()); }}>
          <Search />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('dhSearchPlaceholder')} />
        </form>
        <ul className="dh-results">
          {q.trim() && (
            <li><button type="button" onClick={() => go(q.trim())}><b>{t('dhSearchOrdersFor')} “{q.trim()}”</b></button></li>
          )}
          {matches.map(c => (
            <li key={c.name}>
              <button type="button" onClick={() => go(c.name)}>
                <span className="dh-avatar">{c.name.slice(0, 1).toUpperCase()}</span>
                <span className="dh-results-n">{c.name}</span>
                <span className="dh-results-m">{c.orders} {t('dhOrdersWord')}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && !q.trim() && <li className="dh-results-empty">{t('noDataAvailable')}</li>}
        </ul>
      </div>
    </div>
  );
}
