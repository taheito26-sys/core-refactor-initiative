import { useMemo } from 'react';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { batchCycleTime, computeFIFO, fmtDate, fmtDur, fmtP, fmtQ, fmtU, type TrackerState } from '@/lib/tracker-helpers';
import '@/styles/tracker.css';

interface Props {
  trackerState: TrackerState | null;
}

export function AdminStockMirror({ trackerState }: Props) {
  const { settings } = useTheme();
  const t = useT();
  const state = trackerState;
  const derived = useMemo(() => state ? computeFIFO(state.batches, state.trades) : null, [state]);

  const perf = useMemo(() => {
    if (!state || !derived) return [];
    return state.batches
      .map((b) => {
        const db = derived.batches.find((x) => x.id === b.id);
        const rem = db ? Math.max(0, db.remainingUSDT) : b.initialUSDT;
        const used = b.initialUSDT - rem;
        let profit = 0;
        for (const [, c] of derived.tradeCalc) {
          if (!c.ok) continue;
          const s = c.slices.find((sl) => sl.batchId === b.id);
          if (s) profit += s.qty * c.ppu;
        }
        return { ...b, remaining: rem, used, profit };
      })
      .sort((a, b) => b.ts - a.ts);
  }, [state, derived]);

  const suppliersForPanel = useMemo(() => state ? [...new Set(state.batches.map((b) => b.source.trim()).filter(Boolean))] : [], [state]);
  const rLabel = state ? (state.range || settings.range) : settings.range;

  if (!state || !derived) {
    return <div className="tracker-root" style={{ padding: 12 }}><div className="empty"><div className="empty-t">No stock data.</div></div></div>;
  }

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{t('batches')}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('fifoProgress')}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}><span className="pill">{rLabel}</span></div>
        </div>

        {perf.length === 0 ? (
          <div className="empty"><div className="empty-t">{t('noBatchesShort')}</div><div className="empty-s">{t('addFirstPurchase')}</div></div>
        ) : (
          <div className="tableWrap"><table><thead><tr>
            <th>{t('date')}</th><th>{t('source')}</th><th className="r">{t('total')}</th><th className="r">{t('buy')}</th><th className="r">{t('rem')}</th><th>{t('usage')}</th><th className="r">{t('profit')}</th><th>{t('statusEdit')}</th>
          </tr></thead><tbody>
            {perf.map((b) => {
              const rem = Number.isFinite(b.remaining) ? b.remaining : b.initialUSDT;
              const pct = b.initialUSDT > 0 ? rem / b.initialUSDT : 0;
              const prog = Math.max(0, Math.min(100, pct * 100));
              const ct = batchCycleTime(state, derived, b.id);
              const st = rem <= 1e-9 ? t('depleted') : rem < b.initialUSDT ? t('partial') : t('fresh');
              const stCls = rem <= 1e-9 ? 'bad' : rem < b.initialUSDT ? 'warn' : 'good';
              return (
                <tr key={b.id}>
                  <td className="mono">{fmtDate(b.ts)}</td>
                  <td>{b.source || '—'}</td>
                  <td className="mono r">{fmtU(b.initialUSDT)}</td>
                  <td className="mono r">{fmtP(b.buyPriceQAR)}</td>
                  <td className="mono r">{fmtU(rem)}</td>
                  <td><div className="prog"><span style={{ width: `${prog.toFixed(0)}%` }} /></div><div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{prog.toFixed(0)}% {t('remainingPct')}</div></td>
                  <td className="mono r" style={{ color: (b.profit || 0) >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>{(b.profit || 0) >= 0 ? '+' : ''}{fmtQ(b.profit || 0)}</td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}><span className={`pill ${stCls}`}>{st}</span>{ct !== null && <span className="cycle-badge">{fmtDur(ct)}</span>}</div></td>
                </tr>
              );
            })}
          </tbody></table></div>
        )}

        {suppliersForPanel.length > 0 && (
          <div className="panel" style={{ marginTop: 9 }}>
            <div className="panel-head"><h2>📦 {t('suppliers')}</h2><span className="pill">{t('autoTracked')}</span></div>
            <div className="panel-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {suppliersForPanel.map((s) => <span key={s} className="pill">{s}</span>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
