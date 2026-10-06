import { useMemo, useState } from 'react';
import { ModernSelect } from '@/components/shared/ModernSelect';
import type { TranslationKey } from '@/lib/i18n';
import type { CashAccount, CashLedgerEntry } from '@/lib/tracker-helpers';
import { flowRows, flowToCsv, groupByDay, periodStart, totalsOf, type FlowDirection, type FlowPeriod } from '@/lib/trading/cash-flow';

interface Props {
  ledger: CashLedgerEntry[];
  accounts: CashAccount[];
  typeLabel: (type: string) => string;
  t: (key: TranslationKey) => string;
  isMobile?: boolean;
  onOpenAccount?: (accountId: string) => void;
}

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function dayTitle(day: string, t: Props['t']): string {
  const d = new Date(`${day}T12:00:00`);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return t('cfToday');
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (same(d, y)) return t('cfYesterday');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function CashFlowPanel({ ledger, accounts, typeLabel, t, isMobile = false, onOpenAccount }: Props) {
  const [period, setPeriod] = useState<FlowPeriod>('month');
  const [direction, setDirection] = useState<FlowDirection>('all');
  const [accountId, setAccountId] = useState('');
  const [query, setQuery] = useState('');
  const [includeInternal, setIncludeInternal] = useState(false);
  const [limit, setLimit] = useState(60);

  const names = useMemo(() => new Map(accounts.map(a => [a.id, a.name])), [accounts]);
  const rows = useMemo(
    () => flowRows(ledger, accounts, { from: periodStart(period, Date.now()), accountId: accountId || undefined, direction, includeInternal, query }),
    [ledger, accounts, period, accountId, direction, includeInternal, query],
  );
  const totals = useMemo(() => totalsOf(rows), [rows]);
  const days = useMemo(() => groupByDay(rows.slice(0, limit)), [rows, limit]);

  const chip = (active: boolean, tone?: 'good' | 'bad'): React.CSSProperties => ({
    padding: isMobile ? '8px 12px' : '5px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${active ? (tone ? `var(--${tone})` : 'var(--brand)') : 'var(--line)'}`,
    background: active ? `color-mix(in srgb, var(${tone ? `--${tone}` : '--brand'}) 18%, transparent)` : 'transparent',
    color: active ? (tone ? `var(--${tone})` : 'var(--brand)') : 'var(--muted)',
  });

  const exportCsv = () => {
    const csv = flowToCsv(rows, accounts, typeLabel);
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `cash-flow-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['today', '7d', 'month', 'all'] as FlowPeriod[]).map(p => (
            <button key={p} type="button" style={chip(period === p)} onClick={() => { setPeriod(p); setLimit(60); }}>
              {t(p === 'today' ? 'cfToday' : p === '7d' ? 'cfWeek' : p === 'month' ? 'cfMonth' : 'cfAll')}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={chip(direction === 'all')} onClick={() => setDirection('all')}>{t('cfBoth')}</button>
          <button type="button" style={chip(direction === 'in', 'good')} onClick={() => setDirection('in')}>▲ {t('cfIn')}</button>
          <button type="button" style={chip(direction === 'out', 'bad')} onClick={() => setDirection('out')}>▼ {t('cfOut')}</button>
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
          <ModernSelect value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">{t('cfAllAccounts')}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </ModernSelect>
          <input className="inputBox" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('cfSearch')}
            style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: isMobile ? 16 : 12, minHeight: 36 }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeInternal} onChange={e => setIncludeInternal(e.target.checked)} />
          {t('cfShowInternal')}
        </label>
      </div>

      {/* Totals per currency */}
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {totals.length ? totals.map(tot => (
          <div key={tot.currency} className="panel" style={{ padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', letterSpacing: '.5px', marginBottom: 6 }}>{tot.currency}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div><div style={{ fontSize: 9, color: 'var(--muted)' }}>▲ {t('cfIn')}</div><div className="mono" style={{ fontWeight: 800, color: 'var(--good)' }}>{money(tot.inAmount)}</div></div>
              <div><div style={{ fontSize: 9, color: 'var(--muted)' }}>▼ {t('cfOut')}</div><div className="mono" style={{ fontWeight: 800, color: 'var(--bad)' }}>{money(tot.outAmount)}</div></div>
              <div><div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('cfNet')}</div><div className="mono" style={{ fontWeight: 800, color: tot.net < 0 ? 'var(--bad)' : 'var(--text)' }}>{tot.net > 0 ? '+' : ''}{money(tot.net)}</div></div>
            </div>
          </div>
        )) : <div className="panel" style={{ padding: 14, fontSize: 12, color: 'var(--muted)' }}>{t('cfNothing')}</div>}
      </div>

      {/* Day by day */}
      {days.map(day => (
        <div key={day.day} className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--panel2)', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: 12, fontWeight: 800 }}>{dayTitle(day.day, t)}</div>
            <div className="mono" style={{ fontSize: 10, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {day.totals.map(tot => (
                <span key={tot.currency} style={{ color: tot.net < 0 ? 'var(--bad)' : 'var(--good)', fontWeight: 700 }}>
                  {tot.net > 0 ? '+' : ''}{money(tot.net)} {tot.currency}
                </span>
              ))}
            </div>
          </div>
          {day.rows.map(({ entry, kind, signed }) => (
            <div key={entry.id} onClick={() => onOpenAccount?.(entry.accountId)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--line2)', cursor: onOpenAccount ? 'pointer' : undefined }}>
              <div style={{
                width: 28, height: 28, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900,
                background: kind === 'in' ? 'color-mix(in srgb, var(--good) 16%, transparent)' : kind === 'out' ? 'color-mix(in srgb, var(--bad) 16%, transparent)' : 'color-mix(in srgb, var(--muted) 16%, transparent)',
                color: kind === 'in' ? 'var(--good)' : kind === 'out' ? 'var(--bad)' : 'var(--muted)',
              }}>{kind === 'transfer' ? '⇄' : kind === 'adjustment' ? '±' : signed > 0 ? '▲' : '▼'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeLabel(entry.type)}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {new Date(entry.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {names.get(entry.accountId) || '—'}
                  {entry.note ? ` · ${entry.note.replace(/\[\[[^\]]*\]\]/g, '').trim()}` : ''}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: signed > 0 ? 'var(--good)' : 'var(--bad)', whiteSpace: 'nowrap' }}>
                {signed > 0 ? '+' : '−'}{money(Math.abs(signed))} <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600 }}>{entry.currency}</span>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {rows.length > limit && <button type="button" className="btn secondary" onClick={() => setLimit(l => l + 60)}>{t('cfShowMore')} ({rows.length - limit})</button>}
        {rows.length > 0 && <button type="button" className="btn secondary" onClick={exportCsv}>⬇ {t('cfExport')}</button>}
      </div>
    </div>
  );
}
