import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Bell, CalendarDays, Check, Clock, Download, FileText, Handshake, Layers, LayoutGrid, List, MoreHorizontal, PenLine, Search, Send, Sigma, Users,
} from 'lucide-react';
import { useT, type TranslationKey } from '@/lib/i18n';
import { fmtDate, fmtTotal } from '@/lib/tracker-helpers';
import {
  filterLedger, ledgerToCsv, type LedgerFilter, type LedgerLabel, type LedgerRow, type LedgerStatus, type LoanLedger,
} from '../loans-ledger-view';

const DAY = 86_400_000;
const STALE_DAYS = 14;
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
const fill = (text: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), text);

const ROW_KEY: Record<LedgerLabel, TranslationKey> = { lent: 'lgRowLent', returned: 'lgRowReturned', borrowed: 'lgRowBorrowed', repaid: 'lgRowRepaid' };
const STATUS_KEY: Record<LedgerStatus, TranslationKey> = { confirmed: 'lgStConfirmed', pending: 'lgStPending', not_shared: 'lgStNotShared' };
const SOURCE_KEY: Record<LedgerRow['source'], TranslationKey> = { manual: 'lgSrcManual', exchange: 'lgSrcExchange', stock: 'lgSrcStock', order: 'lgSrcOrder' };

/** A small trend line for a KPI tile. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="lg-spark" viewBox="0 0 100 28" aria-hidden="true"><line x1="0" y1="20" x2="100" y2="20" /></svg>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${24 - ((v - min) / span) * 20}`).join(' ');
  return <svg className="lg-spark" viewBox="0 0 100 28" aria-hidden="true" preserveAspectRatio="none"><polyline points={pts} /></svg>;
}

/** Owed-to-me versus owed-by-me as a ring, net in the middle. */
function Ring({ owed, owe, net }: { owed: number; owe: number; net: number }) {
  const total = owed + owe;
  const R = 42, C = 2 * Math.PI * R;
  const owedLen = total > 0 ? (owed / total) * C : 0;
  return (
    <svg className="lg-ring" viewBox="0 0 100 100" role="img" aria-label={`${fmtTotal(owed)} / ${fmtTotal(owe)}`}>
      <circle cx="50" cy="50" r={R} className="base" />
      {total > 0 && <circle cx="50" cy="50" r={R} className="owe" strokeDasharray={`${C - owedLen} ${C}`} strokeDashoffset={-owedLen} />}
      {owedLen > 0 && <circle cx="50" cy="50" r={R} className="owed" strokeDasharray={`${owedLen} ${C}`} />}
      <text x="50" y="49" textAnchor="middle" className="n">{net > 0 ? '+' : net < 0 ? '−' : ''}{fmtTotal(Math.abs(net))}</text>
      <text x="50" y="63" textAnchor="middle" className="u">USDT</text>
    </svg>
  );
}

/** The four figures at the top of the page, each with a trend line. */
export function LoansTiles({ ledger }: { ledger: LoanLedger }) {
  const t = useT();
  const { totals, series, rows } = ledger;
  const totalVolume = rows.reduce((s, r) => s + r.amount, 0);
  const tiles = [
    { cls: 'owed', icon: ArrowDownLeft, label: t('lgTileOwed'), value: fmtTotal(totals.owedToMe), sub: fill(t('lgMerchantsN'), { n: totals.merchantsOwingMe }), data: series.owed },
    { cls: 'owe', icon: ArrowUpRight, label: t('lgTileOwe'), value: fmtTotal(totals.iOwe), sub: fill(t('lgMerchantsN'), { n: totals.merchantsIOwe }), data: series.owe },
    { cls: 'vol', icon: Sigma, label: t('lgTotalVolume'), value: fmtTotal(totalVolume), sub: fill(t('lgMovements'), { n: rows.length }), data: series.count },
    { cls: 'net', icon: Handshake, label: t('lgTileNet'), value: `${totals.net > 0 ? '+' : totals.net < 0 ? '−' : ''}${fmtTotal(Math.abs(totals.net))}`, sub: Math.abs(totals.net) < 1e-6 ? t('lgNetEven') : totals.net > 0 ? t('lgNetOwedMore') : t('lgNetOweMore'), data: series.net },
  ];
  return (
    <section className="lg lg-tiles" aria-label={t('loansBalance')}>
      {tiles.map(k => (
        <article key={k.label} className={`lg-tile ${k.cls}`}>
          <span className="lg-tile-ic"><k.icon /></span>
          <small>{k.label}</small>
          <strong><em>USDT</em>{k.value}</strong>
          <Spark values={k.data} />
          <span>{k.sub}</span>
        </article>
      ))}
    </section>
  );
}

/** The quick actions row: record a movement either way, sell for a merchant, or open a statement. */
export function LoansActions({
  ledger, onRecord, onOpenMerchant, onOpenConsignments,
}: {
  ledger: LoanLedger;
  onRecord: (direction: 'in' | 'out', presetName?: string) => void;
  onOpenMerchant: (key: string) => void;
  onOpenConsignments?: () => void;
}) {
  const t = useT();
  const [pickStatement, setPickStatement] = useState(false);
  const { merchants } = ledger;
  return (
    <section className="lg lg-qa" aria-label={t('lgQuick')}>
      <div className="lg-qa-row">
        <button type="button" className="lg-qa-btn primary" onClick={() => onRecord('out')}><Send /> {t('lgSentBtn')}<small>{t('lgSentHint')}</small></button>
        <button type="button" className="lg-qa-btn" onClick={() => onRecord('in')}><ArrowDownLeft /> {t('lgRecvBtn')}<small>{t('lgRecvHint')}</small></button>
        {onOpenConsignments && <button type="button" className="lg-qa-btn" onClick={onOpenConsignments}><Layers /> {t('lgActCons')}<small>{t('loansSellForMerchantHint')}</small></button>}
        <div className="lg-qa-wrap">
          <button type="button" className="lg-qa-btn" aria-expanded={pickStatement} onClick={() => setPickStatement(v => !v)} disabled={merchants.length === 0}>
            <FileText /> {t('lgActStatement')}<small>{t('lgActStatementHint')}</small>
          </button>
          {pickStatement && (
            <ul className="lg-pop" role="menu">
              {merchants.map(m => <li key={m.key}><button type="button" role="menuitem" onClick={() => { setPickStatement(false); onOpenMerchant(m.key); }}>{m.name}</button></li>)}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The USDT transfers dashboard: four trend tiles, quick actions, the balance of every merchant, alerts,
 * and the latest movements as a table. Colour carries meaning: green = a merchant owes me, red = I owe a
 * merchant, amber = USDT left my stock, blue = USDT came in.
 */
export function LoansOverview({
  ledger,
  connectedNames,
  onOpenMerchant,
  onOpenConsignments,
  onShowReview,
}: {
  ledger: LoanLedger;
  connectedNames: ReadonlySet<string>;
  onOpenMerchant: (key: string) => void;
  onOpenConsignments?: () => void;
  onShowReview: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [merchantKey, setMerchantKey] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const { totals, merchants, rows, consignments } = ledger;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filterLedger(rows, filter, merchantKey || undefined).filter(r => !q || r.merchant.toLowerCase().includes(q));
  }, [rows, filter, merchantKey, query]);
  const counts = useMemo(() => ({
    all: rows.length,
    out: rows.filter(r => r.direction === 'out').length,
    in: rows.filter(r => r.direction === 'in').length,
    pending: rows.filter(r => r.status === 'pending').length + ledger.incoming.length,
  }), [rows, ledger.incoming.length]);

  const now = Date.now();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const monthVolume = rows.filter(r => r.ts >= monthStart).reduce((s, r) => s + r.amount, 0);

  const open = merchants.filter(m => m.owesMe > 0 || m.iOwe > 0);
  const settled = merchants.filter(m => m.owesMe === 0 && m.iOwe === 0);
  const byBalance = [...open].sort((a, b) => Math.max(b.owesMe, b.iOwe) - Math.max(a.owesMe, a.iOwe));
  const stale = open.filter(m => now - m.lastTs >= STALE_DAYS * DAY);

  const alerts: Array<{ key: string; tone: 'warn' | 'bad' | 'info'; icon: typeof Bell; title: string; sub?: string; act?: () => void }> = [
    ...(ledger.incoming.length > 0 ? [{ key: 'approve', tone: 'warn' as const, icon: Clock, title: fill(t('lgAlertApprove'), { n: ledger.incoming.length }), act: onShowReview }] : []),
    ...(totals.pendingCount - ledger.incoming.length > 0 ? [{ key: 'wait', tone: 'info' as const, icon: Clock, title: fill(t('lgAlertWait'), { n: totals.pendingCount - ledger.incoming.length }) }] : []),
    ...stale.map(m => ({ key: `stale-${m.key}`, tone: 'bad' as const, icon: AlertTriangle, title: fill(t('lgAlertStale'), { name: m.name, n: Math.floor((now - m.lastTs) / DAY) }), sub: `${fmtTotal(m.owesMe || m.iOwe)} USDT`, act: () => onOpenMerchant(m.key) })),
    ...(consignments.openCount > 0 ? [{ key: 'cons', tone: 'info' as const, icon: Layers, title: fill(t('lgAlertCons'), { amount: fmtTotal(consignments.stillWithMerchants) }), sub: consignments.merchants.join(', '), act: onOpenConsignments }] : []),
  ];

  const exportCsv = () => {
    const blob = new Blob(['\ufeff' + ledgerToCsv(visible)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `usdt-transfers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const balanceOf = (r: LedgerRow) => {
    const owes = r.balanceAfter < -1e-6, iowe = r.balanceAfter > 1e-6;
    return {
      cls: owes ? 'owed' : iowe ? 'owe' : '',
      text: !owes && !iowe ? t('mloanSettledShort') : fill(t(owes ? 'lgOwesYouShort' : 'lgYouOweShort'), { amount: fmtTotal(Math.abs(r.balanceAfter)) }),
    };
  };
  const statusChip = (r: LedgerRow) => (
    <span className={`lg-chip ${r.status === 'confirmed' ? 'good' : r.status === 'pending' ? 'warn' : 'muted'}`}>
      {r.status === 'confirmed' ? <Check /> : r.status === 'pending' ? <Clock /> : <PenLine />}{t(STATUS_KEY[r.status])}
    </span>
  );

  const filters: Array<[LedgerFilter, TranslationKey]> = [['all', 'lgFAll'], ['out', 'lgFOut'], ['in', 'lgFIn'], ['pending', 'lgFPending']];

  return (
    <div className="lg lg-dash">
      <div className="lg-grid">
        {/* ── The ledger ── */}
        <section className="lg-card lg-moves" aria-label={t('lgLedger')}>
          <div className="lg-card-head">
            <Layers />
            <div><h2>{t('lgLatest')} ({visible.length})</h2><p>{t('lgLedgerHint')}</p></div>
            <div className="lg-view" role="group" aria-label={t('lgViewCards')}>
              <button type="button" className={view === 'cards' ? 'on' : ''} aria-pressed={view === 'cards'} title={t('lgViewCards')} onClick={() => setView('cards')}><LayoutGrid /></button>
              <button type="button" className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} title={t('lgViewTable')} onClick={() => setView('table')}><List /></button>
            </div>
          </div>
          <div className="lg-filters">
            {merchants.length > 1 && (
              <select className="lg-select" aria-label={t('lgAllMerchants')} value={merchantKey} onChange={e => setMerchantKey(e.target.value)}>
                <option value="">{t('lgAllMerchants')}</option>
                {merchants.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
              </select>
            )}
            <label className="lg-search"><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('lgSearch')} aria-label={t('lgSearch')} /></label>
          </div>
          <div className="lg-seg" role="tablist" aria-label={t('lgLedger')}>
            {filters.map(([id, key]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={`lg-seg-btn ${id} ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>
                <b>{counts[id]}</b>{id === 'out' && <ArrowUpRight />}{id === 'in' && <ArrowDownLeft />}{id === 'pending' && <Clock />}{t(key)}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="lg-empty slim"><span>{t('lgEmptyLedger')}</span></div>
          ) : view === 'cards' ? (
            <ol className="lgc-list">
              {visible.map(r => {
                const bal = balanceOf(r);
                return (
                  <li key={r.id}>
                    <button type="button" className={`lgc ${r.direction}${r.status === 'pending' ? ' pending' : ''}`} onClick={() => onOpenMerchant(r.merchantKey)}>
                      <span className="lgc-dir" aria-hidden="true">{r.direction === 'out' ? <ArrowUpRight /> : <ArrowDownLeft />}</span>
                      <span className="lgc-body">
                        <span className="lgc-top">
                          <i className="lg-avatar">{initials(r.merchant)}</i>
                          <span className="lgc-who">
                            <b>{r.merchant}</b>
                            <span className="lgc-meta">
                              <span className="lg-chip tone">{fill(t(ROW_KEY[r.label]), { name: '' }).trim() || t(ROW_KEY[r.label])}</span>
                              <span className="lgc-date"><CalendarDays />{fmtDate(r.ts)}</span>
                            </span>
                          </span>
                        </span>
                        <span className="lgc-bot">{statusChip(r)}<span className="lg-chip muted">{t(SOURCE_KEY[r.source])}</span></span>
                      </span>
                      <span className="lgc-amt">
                        <strong className={r.direction}>{r.direction === 'out' ? '−' : '+'}{fmtTotal(r.amount)}<em>USDT</em></strong>
                        <small className={bal.cls}>{t('lgBalAfter')}: {bal.text}</small>
                      </span>
                      <MoreHorizontal className="lgc-more" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="lg-table moves" role="table">
              <div className="lg-tr head" role="row">
                <span>{t('lgColType')}</span><span>{t('lgColMerchant')}</span><span>{t('lgColDate')}</span><span>{t('lgColAmount')}</span><span>{t('lgColBalAfter')}</span><span>{t('lgColStatus')}</span>
              </div>
              {visible.map(r => {
                const bal = balanceOf(r);
                return (
                  <button key={r.id} type="button" role="row" className={`lg-tr ${r.direction}${r.status === 'pending' ? ' pending' : ''}`} onClick={() => onOpenMerchant(r.merchantKey)}>
                    <span className="c-type"><i className="lg-dir" aria-hidden="true">{r.direction === 'out' ? <ArrowUpRight /> : <ArrowDownLeft />}</i>
                      <b>{fill(t(ROW_KEY[r.label]), { name: r.merchant })}</b><small>{t(SOURCE_KEY[r.source])}</small></span>
                    <span className="c-name"><i className="lg-avatar">{initials(r.merchant)}</i><b>{r.merchant}</b></span>
                    <span className="c-last"><em>{t('lgColDate')}</em>{fmtDate(r.ts)}</span>
                    <span className={`c-amt ${r.direction}`}><em>{t('lgColAmount')}</em>{r.direction === 'out' ? '−' : '+'}{fmtTotal(r.amount)}</span>
                    <span className={`c-after ${bal.cls}`}><em>{t('lgColBalAfter')}</em>{bal.text}</span>
                    <span className="c-st">{statusChip(r)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="lg-foot-bar">
            <span><Users /><em>{t('lgMerchantsTotal')}</em><b>{merchants.length}</b></span>
            <span><Layers /><em>{t('lgTotalMoves')}</em><b>{rows.length}</b></span>
            <span><CalendarDays /><em>{t('lgThisMonth')}</em><b>{fmtTotal(monthVolume)} USDT</b></span>
            <button type="button" className="lg-export" onClick={exportCsv} disabled={visible.length === 0}><Download /> {t('lgExport')}</button>
          </div>
          <p className="lg-legend">{t('lgLegend')}</p>
        </section>

        {/* ── Side cards ── */}
        <aside className="lg-side">
          <section className="lg-card lg-summary" aria-label={t('lgSummary')}>
            <div className="lg-card-head"><Layers /><div><h2>{t('lgSummary')}</h2></div></div>
            <div className="lg-sum-body">
              <Ring owed={totals.owedToMe} owe={totals.iOwe} net={totals.net} />
              <dl>
                <div className="owed"><dt>{t('lgSumOwed')}</dt><dd>{fmtTotal(totals.owedToMe)}</dd></div>
                <div className="owe"><dt>{t('lgSumOwe')}</dt><dd>{fmtTotal(totals.iOwe)}</dd></div>
                <div className="wait"><dt>{t('lgSumPending')}</dt><dd>{fmtTotal(totals.pendingUSDT)}</dd></div>
              </dl>
            </div>
          </section>

          <section className="lg-card lg-exposure" aria-label={t('lgExposure')}>
            <div className="lg-card-head"><Users /><div><h2>{t('lgExposure')}</h2></div></div>
            {merchants.length === 0 ? (
              <div className="lg-empty slim"><strong>{t('loansNoBalances')}</strong><span>{t('loansNoBalancesHint')}</span></div>
            ) : (
              <ul className="lg-mlist">
                {[...byBalance, ...settled].map(m => {
                  const tone = m.owesMe > 0 ? 'owed' : m.iOwe > 0 ? 'owe' : 'even';
                  const pct = Math.round(m.settledShare * 100);
                  return (
                    <li key={m.key}>
                      <button type="button" className={`lg-mrow ${tone}`} onClick={() => onOpenMerchant(m.key)}>
                        <span className="lg-mrow-top">
                          <b>{m.name}{connectedNames.has(m.name.toLowerCase()) && <u className="lg-conn" title={t('loansConnected')} />}</b>
                          <strong>{tone === 'even' ? t('lgStSettled') : `${tone === 'owe' ? '−' : '+'}${fmtTotal(m.owesMe || m.iOwe)} USDT`}</strong>
                        </span>
                        <span className={`lg-bar ${tone}`}><i style={{ width: `${pct}%` }} /></span>
                        <small>{pct}% · {t('lgColLast')} {fmtDate(m.lastTs)}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="lg-card lg-alerts" aria-label={t('lgAlerts')}>
            <div className="lg-card-head"><Bell /><div><h2>{t('lgAlerts')}</h2></div>{alerts.length > 0 && <b className="lg-count">{alerts.length}</b>}</div>
            {alerts.length === 0 ? <p className="lg-ok"><Check /> {t('lgAlertNone')}</p> : (
              <ul>
                {alerts.map(a => (
                  <li key={a.key} className={a.tone}>
                    <a.icon />
                    <span><strong>{a.title}</strong>{a.sub && <small>{a.sub}</small>}</span>
                    {a.act && <button type="button" onClick={a.act}>{t('lgAlertOpen')}</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
