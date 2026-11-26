import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowDownLeft, ArrowLeftRight, ArrowUp, ArrowUpRight, BarChart3, Bell, CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Database, Download, Layers, LayoutGrid, List, MoreHorizontal, PenLine, Plus, Scale, Send, Sigma, Users,
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
const TYPE_KEY: Record<LedgerLabel, TranslationKey> = { lent: 'lgTypeLoan', returned: 'lgTypeReturn', borrowed: 'lgTypeBorrow', repaid: 'lgTypeRepay' };
const SOURCE_KEY: Record<LedgerRow['source'], TranslationKey> = { manual: 'lgSrcManual', exchange: 'lgSrcExchange', stock: 'lgSrcStock', order: 'lgSrcOrder' };

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
      <text x="50" y="49" textAnchor="middle" className="n">{fmtTotal(Math.abs(net))}{net > 0 ? '+' : net < 0 ? '−' : ''}</text>
      <text x="50" y="63" textAnchor="middle" className="u">USDT</text>
    </svg>
  );
}

/** The four figures at the top of the page. */
export function LoansTiles({ ledger }: { ledger: LoanLedger }) {
  const t = useT();
  const { totals, rows } = ledger;
  const totalVolume = rows.reduce((s, r) => s + r.amount, 0);
  const tiles = [
    { cls: 'owed', icon: ArrowUp, label: t('lgTileOwed'), value: fmtTotal(totals.owedToMe) },
    { cls: 'owe', icon: ArrowDown, label: t('lgTileOwe'), value: fmtTotal(totals.iOwe) },
    { cls: 'vol', icon: Sigma, label: t('lgTotalVolume'), value: fmtTotal(totalVolume) },
    { cls: 'net', icon: BarChart3, label: t('lgTileNet'), value: `${fmtTotal(Math.abs(totals.net))}${totals.net > 0 ? '+' : totals.net < 0 ? '−' : ''}` },
  ];
  return (
    <section className="lg lg-tiles" aria-label={t('loansBalance')}>
      {tiles.map(k => (
        <article key={k.label} className={`lg-tile ${k.cls}`}>
          <span className="lg-tile-ic"><k.icon /></span>
          <small>{k.label}</small>
          <strong><bdi dir="ltr">{k.value}</bdi><em>USDT</em></strong>
        </article>
      ))}
    </section>
  );
}

/** The quick actions row: record a movement either way, sell for a merchant, or open a statement. */
export function LoansActions({
  ledger, onRecord, onOpenMerchant,
}: {
  ledger: LoanLedger;
  onRecord: (direction: 'in' | 'out', presetName?: string) => void;
  onOpenMerchant: (key: string) => void;
  onOpenConsignments?: () => void;
}) {
  const t = useT();
  const [pickStatement, setPickStatement] = useState(false);
  useEffect(() => {
    const showReports = () => setPickStatement(true);
    window.addEventListener('loans:reports', showReports);
    return () => window.removeEventListener('loans:reports', showReports);
  }, []);
  const { merchants } = ledger;
  return (
    <section className="lg lg-qa" aria-label={t('lgQuick')}>
      <div className="lg-qa-row">
        <button type="button" className="lg-qa-btn primary" onClick={() => onRecord('out')}><span>{t('lgSentBtn')}</span><Send /></button>
        <button type="button" className="lg-qa-btn" onClick={() => onRecord('in')}><span>{t('lgRecvBtn')}</span><Plus /></button>
        <button type="button" className="lg-qa-btn" onClick={() => onRecord('out')}><span>{t('lgTransferBalance')}</span><ArrowLeftRight /></button>
        <div className="lg-qa-wrap">
          <button type="button" className="lg-qa-btn" aria-expanded={pickStatement} onClick={() => setPickStatement(v => !v)} disabled={merchants.length === 0}>
            <span>{t('lgSettle')}</span><Scale />
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
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const { totals, merchants, rows, consignments } = ledger;
  const Chev = t.isRTL ? ChevronLeft : ChevronRight;

  const visible = useMemo(() => {
    return filterLedger(rows, filter, merchantKey || undefined);
  }, [rows, filter, merchantKey]);
  const counts = useMemo(() => ({
    all: rows.length,
    out: rows.filter(r => r.direction === 'out').length,
    in: rows.filter(r => r.direction === 'in').length,
    pending: rows.filter(r => r.status === 'pending').length + ledger.incoming.length,
  }), [rows, ledger.incoming.length]);

  const now = Date.now();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const monthVolume = rows.filter(r => r.ts >= monthStart).reduce((s, r) => s + r.amount, 0);

  const debtors = merchants.filter(m => m.owesMe > 0).sort((a, b) => b.owesMe - a.owesMe);
  const creditors = merchants.filter(m => m.iOwe > 0).sort((a, b) => b.iOwe - a.iOwe);
  const stale = [...debtors, ...creditors].filter(m => now - m.lastTs >= STALE_DAYS * DAY);
  const waitingOthers = totals.pendingCount - ledger.incoming.length;

  const alerts: Array<{ key: string; tone: 'warn' | 'bad'; icon: typeof Bell; title: string; sub?: string; act?: () => void }> = [
    ...(ledger.incoming.length > 0 ? [{ key: 'approve', tone: 'warn' as const, icon: Clock, title: fill(t('lgAlertApprove'), { n: ledger.incoming.length }), act: onShowReview }] : []),
    ...stale.map(m => ({ key: `stale-${m.key}`, tone: 'bad' as const, icon: AlertTriangle, title: fill(t('lgAlertStale'), { name: m.name, n: Math.floor((now - m.lastTs) / DAY) }), sub: `${fmtTotal(m.owesMe || m.iOwe)} USDT`, act: () => onOpenMerchant(m.key) })),
  ];
  const pendingItems: Array<{ key: string; icon: typeof Bell; title: string; sub?: string; act?: () => void }> = [
    ...(waitingOthers > 0 ? [{ key: 'wait', icon: Clock, title: fill(t('lgAlertWait'), { n: waitingOthers }) }] : []),
    ...(consignments.openCount > 0 ? [{ key: 'cons', icon: Layers, title: fill(t('lgAlertCons'), { amount: fmtTotal(consignments.stillWithMerchants) }), sub: consignments.merchants.join(', '), act: onOpenConsignments }] : []),
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
  const typeLabel = (r: LedgerRow) => t(TYPE_KEY[r.label]);

  const filters: Array<[LedgerFilter, TranslationKey]> = [['all', 'lgFAll'], ['out', 'lgFOut'], ['in', 'lgFIn'], ['pending', 'lgFPending']];

  const merchantList = (list: typeof merchants, tone: 'owed' | 'owe') => (
    <ul className="lg-mlist">
      {list.map(m => (
        <li key={m.key}>
          <button type="button" className={`lg-mrow ${tone}`} onClick={() => onOpenMerchant(m.key)}>
            <span className="lg-mrow-tx">
              <b>{m.name}{connectedNames.has(m.name.toLowerCase()) && <u className="lg-conn" title={t('loansConnected')} />}</b>
              <strong>{tone === 'owe' ? '−' : '+'}{fmtTotal(m.owesMe || m.iOwe)} USDT</strong>
            </span>
            <Chev className="lg-chev" />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="lg lg-dash">
      <div className="lg-grid">
        {/* ── The ledger ── */}
        <section className="lg-card lg-moves" aria-label={t('lgLedger')}>
          <div className="lg-card-head">
            <Database />
            <h2>{t('lgLatest')} ({visible.length})</h2>
            <div className="lg-head-tools">
              <div className="lg-view" role="group" aria-label={t('lgViewCards')}>
                <button type="button" className={view === 'cards' ? 'on' : ''} aria-pressed={view === 'cards'} title={t('lgViewCards')} onClick={() => setView('cards')}><List /></button>
                <button type="button" className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} title={t('lgViewTable')} onClick={() => setView('table')}><LayoutGrid /></button>
              </div>
              {merchants.length > 1 && (
                <select className="lg-select" aria-label={t('lgAllMerchants')} value={merchantKey} onChange={e => setMerchantKey(e.target.value)}>
                  <option value="">{t('lgAllMerchants')}</option>
                  {merchants.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="lg-seg" role="tablist" aria-label={t('lgLedger')}>
            {filters.map(([id, key]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={`lg-seg-btn ${id} ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>
                <span className="lg-seg-lab">{t(key)}</span>{id === 'out' && <ArrowUpRight />}{id === 'in' && <ArrowDownLeft />}{id === 'pending' && <Clock />}<b>{counts[id]}</b>
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
                    <div role="button" tabIndex={0} className={`lgc ${r.direction}${r.status === 'pending' ? ' pending' : ''}`}
                      onClick={() => onOpenMerchant(r.merchantKey)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenMerchant(r.merchantKey); } }}>
                      <span className="lgc-more" aria-hidden="true"><MoreHorizontal /></span>
                      <i className="lg-avatar">{initials(r.merchant)}</i>
                      <span className="lgc-id">
                        <span className="lgc-name"><b dir="auto">{r.merchant}</b><span className="lg-chip tone">{typeLabel(r)}</span></span>
                        <span className="lgc-date"><CalendarDays />{new Date(r.ts).toLocaleDateString('en-US')}</span>
                        <strong className={`lgc-amt ${r.direction}`}><bdi>{fmtTotal(r.amount)}{r.direction === 'out' ? '−' : '+'}</bdi><em>USDT</em></strong>
                      </span>
                      <span className="lgc-mid">
                        {statusChip(r)}
                        <small className={bal.cls}>{t('lgBalAfter')}: {bal.text}</small>
                      </span>
                      <span className="lgc-dir" aria-hidden="true">{r.direction === 'out' ? <ArrowUpRight /> : <ArrowDownLeft />}</span>
                    </div>
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
                    <span className="c-name"><i className="lg-avatar">{initials(r.merchant)}</i><b dir="auto">{r.merchant}</b></span>
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
            <span><CalendarDays /><em>{t('lgThisMonth')}</em><b>{fmtTotal(monthVolume)} USDT</b></span>
            <span><Layers /><em>{t('lgTotalMoves')}</em><b>{rows.length}</b></span>
            <span><Users /><em>{t('lgMerchantsTotal')}</em><b>{merchants.length}</b></span>
            <button type="button" className="lg-export" onClick={exportCsv} disabled={visible.length === 0}><Download /> {t('lgExport')}</button>
          </div>
        </section>

        {/* ── Side cards ── */}
        <aside className="lg-side">
          <section className="lg-card lg-summary" aria-label={t('lgSummary')}>
            <div className="lg-card-head"><BarChart3 /><h2>{t('lgSummary')}</h2></div>
            <div className="lg-sum-body">
              <dl>
                <div className="owed"><dd>{fmtTotal(totals.owedToMe)}</dd><dt>{t('lgSumOwed')}</dt></div>
                <div className="owe"><dd>{fmtTotal(totals.iOwe)}</dd><dt>{t('lgSumOwe')}</dt></div>
                <div className="wait"><dd>{fmtTotal(totals.pendingUSDT)}</dd><dt>{t('lgSumPending')}</dt></div>
              </dl>
              <Ring owed={totals.owedToMe} owe={totals.iOwe} net={totals.net} />
            </div>
          </section>

          <section className="lg-card lg-exposure" aria-label={t('lgTopDebtors')}>
            <div className="lg-card-head"><Users /><h2>{t('lgTopDebtors')}</h2></div>
            {debtors.length === 0 ? <p className="lg-none">{t('lgNoDebtors')}</p> : merchantList(debtors, 'owed')}
            {creditors.length > 0 && (
              <>
                <h3 className="lg-sub">{t('lgTopCreditors')}</h3>
                {merchantList(creditors, 'owe')}
              </>
            )}
          </section>

          <section className="lg-card lg-alerts" aria-label={t('lgAlerts')}>
            <div className="lg-card-head"><Bell /><h2>{t('lgAlerts')}</h2>{alerts.length > 0 && <b className="lg-count">{alerts.length}</b>}</div>
            {alerts.length === 0 ? <p className="lg-ok"><Check /> {t('lgNoLate')}</p> : (
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

          <section className="lg-card lg-upcoming" aria-label={t('lgWaitingCard')}>
            <div className="lg-card-head"><CalendarClock /><h2>{t('lgWaitingCard')}</h2></div>
            {pendingItems.length === 0 ? <p className="lg-none">{t('lgNothingWaiting')}</p> : (
              <ul className="lg-alerts-list">
                {pendingItems.map(a => (
                  <li key={a.key}>
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
