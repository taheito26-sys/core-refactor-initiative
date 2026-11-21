import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, Clock, Handshake, Inbox, PenLine, ShieldCheck } from 'lucide-react';
import { useT, type TranslationKey } from '@/lib/i18n';
import { fmtDate, fmtTotal } from '@/lib/tracker-helpers';
import { filterLedger, type LedgerFilter, type LedgerLabel, type LedgerRow, type LedgerStatus, type LoanLedger } from '../loans-ledger-view';

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
const fill = (text: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), text);

const ROW_KEY: Record<LedgerLabel, TranslationKey> = { lent: 'lgRowLent', returned: 'lgRowReturned', borrowed: 'lgRowBorrowed', repaid: 'lgRowRepaid' };
const STATUS_KEY: Record<LedgerStatus, TranslationKey> = { confirmed: 'lgStConfirmed', pending: 'lgStPending', not_shared: 'lgStNotShared' };
const SOURCE_KEY: Record<LedgerRow['source'], TranslationKey> = { manual: 'lgSrcManual', exchange: 'lgSrcExchange', stock: 'lgSrcStock', order: 'lgSrcOrder' };

/**
 * The Loans page body: what is owed each way, who owes whom, and every movement as a ledger.
 * Colour carries the meaning everywhere: amber ⬆ is USDT leaving my stock, blue ⬇ is USDT coming in;
 * green is a merchant owing me, red is me owing a merchant.
 */
export function LoansOverview({
  ledger,
  connectedNames,
  onRecord,
  onOpenMerchant,
  onOpenConsignments,
  onShowReview,
  reviewCount,
}: {
  ledger: LoanLedger;
  connectedNames: ReadonlySet<string>;
  onRecord: (direction: 'in' | 'out', presetName?: string) => void;
  onOpenMerchant: (key: string) => void;
  onOpenConsignments?: () => void;
  onShowReview: () => void;
  reviewCount: number;
}) {
  const t = useT();
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [merchantKey, setMerchantKey] = useState('');
  const { totals, merchants, rows, consignments } = ledger;

  const visible = useMemo(() => filterLedger(rows, filter, merchantKey || undefined), [rows, filter, merchantKey]);
  const counts = useMemo(() => ({
    all: rows.length,
    out: rows.filter(r => r.direction === 'out').length,
    in: rows.filter(r => r.direction === 'in').length,
    pending: rows.filter(r => r.status === 'pending').length + ledger.incoming.length,
  }), [rows, ledger.incoming.length]);

  const open = merchants.filter(m => m.owesMe > 0 || m.iOwe > 0);
  const settled = merchants.filter(m => m.owesMe === 0 && m.iOwe === 0);
  const netText = Math.abs(totals.net) < 1e-6 ? t('lgNetEven') : totals.net > 0 ? t('lgNetOwedMore') : t('lgNetOweMore');
  const balanceSentence = (name: string, owesMe: number, iOwe: number) =>
    owesMe > 0 ? fill(t('lgOwesYou'), { name, amount: fmtTotal(owesMe) }) : iOwe > 0 ? fill(t('lgYouOwe'), { name, amount: fmtTotal(iOwe) }) : fill(t('lgSettledWith'), { name });

  return (
    <div className="lg">
      {/* ── Two big buttons: which way did the USDT move? ── */}
      <div className="lg-actions" role="group" aria-label={t('loansRecordMovement')}>
        <button type="button" className="lg-act out" onClick={() => onRecord('out')}>
          <span className="lg-act-ic"><ArrowUpRight /></span>
          <span className="lg-act-tx"><strong>{t('lgSentBtn')}</strong><small>{t('lgSentHint')}</small></span>
        </button>
        <button type="button" className="lg-act in" onClick={() => onRecord('in')}>
          <span className="lg-act-ic"><ArrowDownLeft /></span>
          <span className="lg-act-tx"><strong>{t('lgRecvBtn')}</strong><small>{t('lgRecvHint')}</small></span>
        </button>
        <button type="button" className="lg-act ghost" onClick={onShowReview}>
          <span className="lg-act-ic"><Inbox /></span>
          <span className="lg-act-tx"><strong>{t('loansOpenInbox')}</strong><small>{reviewCount > 0 ? fill(t('lgReviewN'), { n: reviewCount }) : t('lgReviewNone')}</small></span>
          {reviewCount > 0 && <span className="lg-badge warn">{reviewCount}</span>}
        </button>
      </div>

      {/* ── The four numbers ── */}
      <section className="lg-tiles" aria-label={t('loansBalance')}>
        <article className="lg-tile owed">
          <span className="lg-tile-ic"><ArrowDownLeft /></span>
          <small>{t('lgTileOwed')}</small>
          <strong>{fmtTotal(totals.owedToMe)}<em>USDT</em></strong>
          <span>{fill(t('lgMerchantsN'), { n: totals.merchantsOwingMe })}</span>
        </article>
        <article className="lg-tile owe">
          <span className="lg-tile-ic"><ArrowUpRight /></span>
          <small>{t('lgTileOwe')}</small>
          <strong>{fmtTotal(totals.iOwe)}<em>USDT</em></strong>
          <span>{fill(t('lgMerchantsN'), { n: totals.merchantsIOwe })}</span>
        </article>
        <article className="lg-tile net">
          <span className="lg-tile-ic"><Handshake /></span>
          <small>{t('lgTileNet')}</small>
          <strong>{totals.net > 0 ? '+' : totals.net < 0 ? '−' : ''}{fmtTotal(Math.abs(totals.net))}<em>USDT</em></strong>
          <span>{netText}</span>
        </article>
        <article className={`lg-tile wait${totals.pendingCount ? ' on' : ''}`}>
          <span className="lg-tile-ic"><Clock /></span>
          <small>{t('lgTileWait')}</small>
          <strong>{totals.pendingCount}<em>{totals.pendingCount ? `${fmtTotal(totals.pendingUSDT)} USDT` : ''}</em></strong>
          <span>{totals.pendingCount ? t('lgWaitHint') : t('lgWaitNone')}</span>
        </article>
      </section>

      {/* ── Who owes whom ── */}
      <section className="lg-section">
        <div className="lg-section-head"><h2>{t('lgWho')}</h2><p>{t('lgWhoHint')}</p></div>
        {open.length === 0 ? (
          <div className="lg-empty"><Handshake /><strong>{t('loansNoBalances')}</strong><span>{t('loansNoBalancesHint')}</span></div>
        ) : (
          <div className="lg-merchants">
            {open.map(m => {
              const tone = m.owesMe > 0 ? 'owed' : 'owe';
              const stale = Date.now() - m.lastTs >= 14 * 86_400_000;
              return (
                <button key={m.key} type="button" className={`lg-merchant ${tone}`} onClick={() => onOpenMerchant(m.key)}>
                  <span className="lg-avatar">{initials(m.name)}</span>
                  <span className="lg-merchant-main">
                    <span className="lg-merchant-name">
                      {m.name}
                      {connectedNames.has(m.name.toLowerCase()) && <span className="lg-chip good"><ShieldCheck /> {t('loansConnected')}</span>}
                      {m.pendingCount > 0 && <span className="lg-chip warn"><Clock /> {fill(t('lgPendingN'), { n: m.pendingCount })}</span>}
                    </span>
                    <span className={`lg-sentence ${tone}`}>{balanceSentence(m.name, m.owesMe, m.iOwe)}</span>
                    <span className="lg-bar" role="img" aria-label={fill(t('lgSettledBar'), { pct: Math.round(m.settledShare * 100) })}>
                      <i style={{ width: `${Math.round(m.settledShare * 100)}%` }} />
                    </span>
                    <span className="lg-merchant-sub">
                      {fill(t('lgSettledBar'), { pct: Math.round(m.settledShare * 100) })} · {m.owesMe > 0
                        ? `${t('lgLent')} ${fmtTotal(m.lentTotal)} · ${t('lgReturned')} ${fmtTotal(m.returnedTotal)}`
                        : `${t('lgBorrowed')} ${fmtTotal(m.borrowedTotal)} · ${t('lgRepaid')} ${fmtTotal(m.repaidTotal)}`}
                    </span>
                    <span className="lg-merchant-sub">
                      {fill(t('lgMovements'), { n: m.movements })} · {t('lgLast')} {fmtDate(m.lastTs)}
                      {stale && <b className="lg-stale"> · {fill(t('loansStale'), { n: Math.floor((Date.now() - m.lastTs) / 86_400_000) })}</b>}
                    </span>
                  </span>
                  <ChevronRight className="lg-chev" />
                </button>
              );
            })}
          </div>
        )}
        {settled.length > 0 && (
          <details className="lg-settled">
            <summary>{t('loansSettledMerchants')} ({settled.length})</summary>
            <div className="lg-settled-list">
              {settled.map(m => <button key={m.key} type="button" onClick={() => onOpenMerchant(m.key)}><strong>{m.name}</strong><span>{t('mloanSettledShort')} · {fmtDate(m.lastTs)}</span></button>)}
            </div>
          </details>
        )}
      </section>

      {/* ── Consignments live in their own workspace; their sold part is not a loan ── */}
      {onOpenConsignments && (
        <section className="lg-cons">
          <div>
            <strong>{t('lgConsTitle')}</strong>
            <span>{consignments.openCount > 0 ? fill(t('lgConsLine'), { amount: fmtTotal(consignments.stillWithMerchants), names: consignments.merchants.join(', ') }) : t('loansSellForMerchantHint')}</span>
          </div>
          <button type="button" className="lg-btn" onClick={onOpenConsignments}>{t('lgConsOpen')}</button>
        </section>
      )}

      {/* ── Every movement ── */}
      <section className="lg-section" aria-label={t('lgLedger')}>
        <div className="lg-section-head"><h2>{t('lgLedger')}</h2><p>{t('lgLedgerHint')}</p></div>
        <div className="lg-filters">
          <div className="lg-seg" role="tablist" aria-label={t('lgLedger')}>
            {([['all', 'lgFAll'], ['out', 'lgFOut'], ['in', 'lgFIn'], ['pending', 'lgFPending']] as [LedgerFilter, TranslationKey][]).map(([id, key]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={`lg-seg-btn ${id} ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>
                {id === 'out' && <ArrowUpRight />}{id === 'in' && <ArrowDownLeft />}{id === 'pending' && <Clock />}
                {t(key)} <b>{counts[id]}</b>
              </button>
            ))}
          </div>
          {merchants.length > 1 && (
            <select className="lg-select" aria-label={t('lgAllMerchants')} value={merchantKey} onChange={e => setMerchantKey(e.target.value)}>
              <option value="">{t('lgAllMerchants')}</option>
              {merchants.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
          )}
        </div>
        {visible.length === 0 ? (
          <div className="lg-empty slim"><span>{t('lgEmptyLedger')}</span></div>
        ) : (
          <ol className="lg-rows">
            {visible.map(r => {
              const owes = r.balanceAfter < -1e-6, iowe = r.balanceAfter > 1e-6;
              const balText = !owes && !iowe ? t('mloanSettledShort') : fill(t(owes ? 'lgOwesYouShort' : 'lgYouOweShort'), { amount: fmtTotal(Math.abs(r.balanceAfter)) });
              return (
                <li key={r.id}>
                  <button type="button" className={`lg-row ${r.direction}${r.status === 'pending' ? ' pending' : ''}`} onClick={() => onOpenMerchant(r.merchantKey)}>
                    <span className="lg-dir" aria-hidden="true">{r.direction === 'out' ? <ArrowUpRight /> : <ArrowDownLeft />}</span>
                    <span className="lg-row-main">
                      <span className="lg-row-title">{fill(t(ROW_KEY[r.label]), { name: r.merchant })}</span>
                      <span className="lg-row-meta">
                        {fmtDate(r.ts)}
                        <span className={`lg-chip ${r.status === 'confirmed' ? 'good' : r.status === 'pending' ? 'warn' : 'muted'}`}>
                          {r.status === 'confirmed' ? <Check /> : r.status === 'pending' ? <Clock /> : <PenLine />}{t(STATUS_KEY[r.status])}
                        </span>
                        <span className="lg-chip muted">{t(SOURCE_KEY[r.source])}</span>
                      </span>
                    </span>
                    <span className="lg-row-amt">
                      <strong className={r.direction}>{r.direction === 'out' ? '−' : '+'}{fmtTotal(r.amount)} <em>USDT</em></strong>
                      <small className={owes ? 'owed' : iowe ? 'owe' : ''}>{t('lgBalAfter')}: {balText}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <p className="lg-legend">{t('lgLegend')}</p>
      </section>
    </div>
  );
}
