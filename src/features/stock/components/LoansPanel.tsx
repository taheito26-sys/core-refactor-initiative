import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Handshake,
  Inbox,
  Info,
  MoreHorizontal,
  Plus,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useT, type TranslationKey } from '@/lib/i18n';
import { fmtDate, fmtPrice, fmtTotal, type DerivedState, type TrackerState } from '@/lib/tracker-helpers';
import type { UsdtTransfer, UsdtTransferKind } from '@/lib/usdt-transfers';
import { EXCHANGE_LABELS, transferKindLabel } from '@/features/exchanges/types';
import { dismissExchangeRecord, restoreExchangeRecord } from '@/features/exchanges/api';
import type { ExchangeDismissReason } from '@/features/exchanges/types';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';
import { buildMerchantStatements, pendingItemToLoanSource, undoLoanMove, type LoanSource, type MerchantStatement } from '../loan-ledger';
import { useBorrowLendCommit } from '../hooks/useBorrowLendCommit';
import { useDismissedExchangeItems, usePendingExchangeItems } from '../hooks/usePendingExchangeItems';
import { useLoanMerchantNames } from '../hooks/useLoanMerchantNames';
import { MerchantLoanDialog } from './MerchantLoanDialog';
import { ExchangeReferenceSearch } from '@/features/exchanges/components/ExchangeReferenceSearch';
import '@/styles/loans-desk.css';

const KIND_META: Record<UsdtTransferKind, { icon: string; label: TranslationKey }> = {
  borrow_in: { icon: '↓', label: 'mloanKindBorrowed' },
  borrow_repay: { icon: '↩', label: 'mloanKindRepaid' },
  lend_out: { icon: '↑', label: 'mloanKindLent' },
  lend_return: { icon: '↪', label: 'mloanKindReturned' },
};

const PAGE = 25;
const EPS = 1e-6;

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

const round = (n: number) => Math.round(n * 100) / 100;

function SourceIcon({ direction }: { direction: 'in' | 'out' }) {
  return direction === 'out' ? <ArrowUpRight /> : <ArrowDownLeft />;
}

function KindIcon({ kind }: { kind: UsdtTransferKind }) {
  return kind === 'borrow_in' || kind === 'lend_return' ? <ArrowDownLeft /> : <ArrowUpRight />;
}

/**
 * Merchant credit desk.
 *
 * The old screen mixed an exchange inbox, a statement tree and a bulk-action
 * bar into one wall. This layout separates the two jobs:
 *   Balances — who owes whom, with a full statement behind each merchant.
 *   Review   — exchange records that still need one answer.
 */
export function LoansPanel({
  state,
  derived,
  applyStateAndCommit,
  onImportPurchase,
  onManualFix,
  onOpenConsignments,
}: {
  state: TrackerState;
  derived: DerivedState;
  applyStateAndCommit: (next: TrackerState) => Promise<void>;
  /** Show the Add batch form, where incoming exchange records are imported as purchases. */
  onImportPurchase: () => void;
  /** Fix the stock by hand for these records instead of registering them; the caller dismisses them once the fix is applied. */
  onManualFix?: (items: PendingExchangeItem[]) => void;
  /** Open the separate "sell USDT for another merchant" workspace. */
  onOpenConsignments?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { commit, busy } = useBorrowLendCommit(applyStateAndCommit);
  const pending = usePendingExchangeItems(state);
  const dismissed = useDismissedExchangeItems(state);
  const merchants = useLoanMerchantNames(state);
  const [tab, setTab] = useState<'balances' | 'review'>('balances');
  const [dialog, setDialog] = useState<{ sources: LoanSource[]; presetName?: string } | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const statements = useMemo(() => buildMerchantStatements(state.usdtTransfers), [state.usdtTransfers]);
  const open = statements.filter((s) => Math.abs(s.net) > EPS);
  const settled = statements.filter((s) => Math.abs(s.net) <= EPS);
  const selected = detailKey ? statements.find((s) => s.key === detailKey) ?? null : null;

  const connectedCount = merchants.filter((m) => m.connected).length;
  const owed = open.filter((s) => s.net < 0).reduce((sum, s) => sum + Math.abs(s.net), 0);
  const owe = open.filter((s) => s.net > 0).reduce((sum, s) => sum + s.net, 0);
  const owedCount = open.filter((s) => s.net < 0).length;
  const oweCount = open.filter((s) => s.net > 0).length;

  const septemberCutoff = new Date(new Date().getFullYear(), 8, 1).getTime();
  const filteredPending = useMemo(() => pending.filter((p) => p.ts >= septemberCutoff), [pending, septemberCutoff]);
  const visiblePending = filteredPending.slice(0, limit);

  const inPrice = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of derived.batches) if (b.isTransfer) m.set(b.id, b.buyPriceQAR);
    return m;
  }, [derived.batches]);
  const unitCost = (x: UsdtTransfer) =>
    x.kind === 'borrow_in' || x.kind === 'lend_return'
      ? inPrice.get(x.id)
      : derived.transferCalc?.get(x.id)?.unitCost ?? undefined;

  const connectedNames = useMemo(
    () => new Set(merchants.filter((m) => m.connected).map((m) => m.name.toLowerCase())),
    [merchants],
  );

  const openLoanFor = (items: PendingExchangeItem[]) => {
    const sources = items.map(pendingItemToLoanSource).filter((s): s is LoanSource => !!s);
    if (sources.length) setDialog({ sources });
  };

  const recordOf = (item: PendingExchangeItem) => ({
    source: item.source,
    id: (item.order?.id ?? item.transfer?.id) as string,
  });

  const refreshRecords = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['exchange-transfers'] }),
      queryClient.invalidateQueries({ queryKey: ['exchange-p2p-orders'] }),
    ]);
  };

  const resolveItem = async (item: PendingExchangeItem, reason: ExchangeDismissReason) => {
    if (reason === 'deleted' && !window.confirm(t('mloanRemoveConfirm'))) return;
    try {
      await dismissExchangeRecord(recordOf(item), reason);
      await refreshRecords();
      toast.success(t(reason === 'deleted' ? 'mloanRemoved' : 'mloanIgnored'));
    } catch {
      toast.error(t('mloanSaveFailed'));
    }
  };

  const restore = async (item: { source: 'order' | 'transfer'; id: string; reason: ExchangeDismissReason }) => {
    if (item.reason === 'adjusted' && !window.confirm(t('mloanRestoreAdjustedConfirm'))) return;
    try {
      await restoreExchangeRecord(item);
      await refreshRecords();
      toast.success(t('mloanRestored'));
    } catch {
      toast.error(t('mloanSaveFailed'));
    }
  };

  const undo = (x: UsdtTransfer) => {
    if (!window.confirm(t('mloanUndoConfirm'))) return;
    void commit(undoLoanMove(state, x.id), 'mloanUndone');
  };

  const balanceLabel = (net: number) => {
    if (Math.abs(net) <= EPS) return t('mloanSettledShort');
    return net > 0 ? t('mloanYouOweShort') : t('mloanOwesYouShort');
  };

  const balanceAmount = (net: number) => fmtTotal(Math.abs(net));

  const balanceText = (s: MerchantStatement | { net: number; name: string }) => {
    if (Math.abs(s.net) <= EPS) return t('mloanSettledShort');
    return s.net > 0
      ? t('mloanBalanceIOwe').split('{name}').join(s.name).split('{amount}').join(fmtTotal(s.net))
      : t('mloanBalanceOwesMe').split('{name}').join(s.name).split('{amount}').join(fmtTotal(-s.net));
  };

  const sourceText = (x: UsdtTransfer) => {
    const src = x.source;
    if (!src) return t('mloanManualEntry');
    if (src.type === 'exchange') return `${EXCHANGE_LABELS[src.exchange]} ${t('mloanTransfer')}`;
    if (src.type === 'exchange_order') return `${EXCHANGE_LABELS[src.exchange]} P2P #${src.orderNumber}`;
    if (src.type === 'batch') return t('mloanFromBatch');
    return t('mloanFromOrder');
  };

  const openManual = (presetName?: string) =>
    setDialog({ sources: [{ type: 'manual', direction: 'out', ts: Date.now() }], presetName });

  const showReview = () => {
    setTab('review');
    window.setTimeout(() => document.getElementById('ld-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  const renderMerchant = (s: MerchantStatement) => {
    const isOwed = s.net < 0;
    const connected = connectedNames.has(s.name.toLowerCase());
    return (
      <button key={s.key} type="button" className="ld-merchant" onClick={() => setDetailKey(s.key)}>
        <span className="ld-avatar">{initials(s.name)}</span>
        <span className="ld-merchant-info">
          <span className="ld-merchant-name">
            <span>{s.name}</span>
            {connected && (
              <span className="ld-connection">
                <ShieldCheck /> {t('loansConnected')}
              </span>
            )}
          </span>
          <span className="ld-merchant-meta">
            {s.lines.length} {t('loansMovements')} · {t('loansLastActivity')} {fmtDate(s.lastTs)}
          </span>
        </span>
        <span className={`ld-merchant-balance ${isOwed ? 'owed' : 'owe'}`}>
          <small>{balanceLabel(s.net)}</small>
          <strong>{balanceAmount(s.net)} <span style={{ fontSize: 9, opacity: 0.65 }}>USDT</span></strong>
        </span>
        <ChevronRight />
      </button>
    );
  };

  const renderStatement = (s: MerchantStatement) => {
    const shownGroups = new Set<string>();
    const lent = s.lines.filter((l) => l.kind === 'lend_out').reduce((sum, l) => sum + l.amount, 0);
    const borrowed = s.lines.filter((l) => l.kind === 'borrow_in').reduce((sum, l) => sum + l.amount, 0);
    const groups = s.monthGroups || [];
    return (
      <Dialog open={!!selected} onOpenChange={(o) => !o && setDetailKey(null)}>
        <DialogContent className="ld-dialog tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'}>
          <DialogTitle className="sr-only">{t('loansMerchantDetails')}</DialogTitle>
          <DialogDescription className="sr-only">
            {s.name} · {t('loansMerchantBalancesHint')}
          </DialogDescription>
          <div className="ld-dialog-head">
            <div className="ld-statement-top" style={{ flex: 1 }}>
              <div className="ld-statement-name">
                <span className="ld-avatar">{initials(s.name)}</span>
                <div>
                  <h2>{s.name}</h2>
                  <p>{t('loansMerchantDetails')} · {s.lines.length} {t('loansMovements')}</p>
                </div>
              </div>
              <div className={`ld-statement-total ${s.net < 0 ? 'owed' : 'owe'}`}>
                <small>{balanceLabel(s.net)}</small>
                <strong>{s.net === 0 ? '—' : `${balanceAmount(s.net)} USDT`}</strong>
              </div>
            </div>
          </div>
          <div className="ld-dialog-body">
            <div className="ld-mini-stats">
              <div className="ld-mini-stat">
                <span>{t('loansTotalLent')}</span>
                <strong>{fmtTotal(lent)} USDT</strong>
              </div>
              <div className="ld-mini-stat">
                <span>{t('loansTotalBorrowed')}</span>
                <strong>{fmtTotal(borrowed)} USDT</strong>
              </div>
            </div>

            <div className="ld-timeline">
              {groups.length === 0 && <div className="ld-empty" style={{ padding: 20 }}><Info /><span>{t('loansNoTimeline')}</span></div>}
              {groups.map((group) => {
                const groupLines = [...group.lines].reverse();
                return (
                  <div key={group.yearMonth}>
                    <div className="ld-month-label">{group.yearMonth}</div>
                    {groupLines.map((l) => {
                      const meta = KIND_META[l.kind];
                      const cost = unitCost(l.transfer);
                      const undoable = !l.groupId || !shownGroups.has(l.groupId);
                      if (l.groupId) shownGroups.add(l.groupId);
                      return (
                        <div key={l.id} className="ld-timeline-row">
                          <div className="ld-timeline-dot"><KindIcon kind={l.kind} /></div>
                          <div className="ld-timeline-copy">
                            <div className="ld-timeline-line">
                              {meta.icon} {t(meta.label)} <b>{fmtTotal(l.amount)}</b> USDT
                            </div>
                            <div className="ld-timeline-meta">
                              {fmtDate(l.ts)} · {sourceText(l.transfer)}
                              {cost ? ` · ${l.estimated ? t('mloanEstCost') : t('mloanCost')} ${fmtPrice(cost)}` : ''}
                            </div>
                            <div className={`ld-timeline-balance ${l.balanceAfter < 0 ? 'owed' : 'owe'}`}>
                              {balanceText({ net: l.balanceAfter, name: s.name })}
                            </div>
                          </div>
                          {undoable && (
                            <button type="button" className="ld-btn small ghost" disabled={busy} onClick={() => undo(l.transfer)}>
                              <RotateCcw /> {t('mloanUndo')}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="ld-dialog-foot">
            <button type="button" className="ld-btn secondary" onClick={() => setDetailKey(null)}>{t('close')}</button>
            <button
              type="button"
              className="ld-btn primary"
              onClick={() => {
                setDetailKey(null);
                openManual(s.name);
              }}
            >
              <Plus /> {t('mloanAddMove')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="ld-desk">
      <section className="ld-hero">
        <div>
          <div className="ld-kicker"><Handshake /> {t('loansEyebrow')}</div>
          <h1>{t('loansTitle')}</h1>
          <p>{t('loansSubtitle')}</p>
        </div>
        <div className="ld-hero-actions">
          <button type="button" className="ld-btn primary" onClick={() => openManual()}>
            <Plus /> {t('loansRecordMovement')}
          </button>
          <button type="button" className="ld-btn ghost" onClick={showReview}>
            <Inbox /> {t('loansOpenInbox')}
            {filteredPending.length > 0 && <span className="ld-count warn">{filteredPending.length}</span>}
          </button>
        </div>
      </section>

      <section className="ld-stats" aria-label={t('loansBalance')}>
        <article className="ld-stat owed">
          <div className="ld-stat-top">
            <span className="ld-stat-label">{t('loansYouAreOwed')}</span>
            <span className="ld-stat-icon"><ArrowDownLeft /></span>
          </div>
          <div className="ld-stat-value">{fmtTotal(owed)} <span style={{ fontSize: 11, opacity: 0.6 }}>USDT</span></div>
          <div className="ld-stat-note">{owedCount} {t('loansMerchants')}</div>
        </article>
        <article className="ld-stat owe">
          <div className="ld-stat-top">
            <span className="ld-stat-label">{t('loansYouOwe')}</span>
            <span className="ld-stat-icon"><ArrowUpRight /></span>
          </div>
          <div className="ld-stat-value">{fmtTotal(owe)} <span style={{ fontSize: 11, opacity: 0.6 }}>USDT</span></div>
          <div className="ld-stat-note">{oweCount} {t('loansMerchants')}</div>
        </article>
        <article className="ld-stat open">
          <div className="ld-stat-top">
            <span className="ld-stat-label">{t('loansOpenMerchants')}</span>
            <span className="ld-stat-icon"><Wallet /></span>
          </div>
          <div className="ld-stat-value">{open.length}</div>
          <div className="ld-stat-note">{t('loansAcrossMerchants')}</div>
        </article>
        <article className="ld-stat connected">
          <div className="ld-stat-top">
            <span className="ld-stat-label">{t('loansConnectedMerchants')}</span>
            <span className="ld-stat-icon"><ShieldCheck /></span>
          </div>
          <div className="ld-stat-value">{connectedCount}</div>
          <div className="ld-stat-note">{connectedCount > 0 ? t('loansConnectedSync') : t('loansNoConnected')}</div>
        </article>
      </section>

      <div className="ld-tabs" role="tablist" aria-label={t('loansTitle')}>
        <button type="button" role="tab" aria-selected={tab === 'balances'} className={`ld-tab ${tab === 'balances' ? 'active' : ''}`} onClick={() => setTab('balances')}>
          {t('loansBalances')} <span className="ld-count">{open.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'review'} className={`ld-tab ${tab === 'review' ? 'active' : ''}`} onClick={() => setTab('review')}>
          {t('loansReview')} {filteredPending.length > 0 && <span className="ld-count warn">{filteredPending.length}</span>}
        </button>
      </div>

      {tab === 'balances' ? (
        <div className="ld-layout">
          <div className="ld-main">
            <div className="ld-section-head">
              <div>
                <h2>{t('loansMerchantBalances')}</h2>
                <p>{t('loansMerchantBalancesHint')}</p>
              </div>
              <span className="ld-count">{open.length}</span>
            </div>
            {open.length === 0 ? (
              <div className="ld-empty">
                <Handshake />
                <strong>{t('loansNoBalances')}</strong>
                <span>{t('loansNoBalancesHint')}</span>
                <button type="button" className="ld-btn primary small" onClick={() => openManual()}>
                  <Plus /> {t('loansRecordMovement')}
                </button>
              </div>
            ) : open.map(renderMerchant)}
            {settled.length > 0 && (
              <details className="ld-settled">
                <summary>{t('loansSettledMerchants')} ({settled.length})</summary>
                <div className="ld-settled-list">
                  {settled.map((s) => (
                    <button key={s.key} type="button" className="ld-settled-row" onClick={() => setDetailKey(s.key)}>
                      <strong>{s.name}</strong>
                      <span>{t('mloanSettledShort')} · {fmtDate(s.lastTs)}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
          <aside className="ld-side">
            <div className="ld-side-card brand">
              <h3>{t('loansRecordMovement')}</h3>
              <p>{t('loansHowItWorksBody')}</p>
              <button type="button" className="ld-btn primary" onClick={() => openManual()}>
                <Plus /> {t('loansRecordMovement')}
              </button>
            </div>
            {onOpenConsignments && (
              <div className="ld-side-card">
                <h3>{t('loansSellForMerchant')}</h3>
                <p>{t('loansSellForMerchantHint')}</p>
                <button type="button" className="ld-btn secondary" onClick={onOpenConsignments}>
                  <ArrowUpRight /> {t('loansSellForMerchant')}
                </button>
              </div>
            )}
            <div className="ld-side-card">
              <h3>{t('loansHowItWorks')}</h3>
              <div className="ld-side-list">
                <div><Info /> <span>{t('loansHowItWorksBody')}</span></div>
                <div><ShieldCheck /> <span>{t('loansConnectedSync')}</span></div>
                <div><Wallet /> <span>{t('mloanNoProfit')}</span></div>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div id="ld-review" className="ld-layout">
          <div className="ld-main">
            <div className="ld-section-head">
              <div>
                <h2>{t('loansInboxTitle')}</h2>
                <p>{t('loansInboxHint')}</p>
              </div>
              {filteredPending.length > 0 && <span className="ld-count warn">{filteredPending.length}</span>}
            </div>
            <ExchangeReferenceSearch
              state={state}
              onMerchantLoan={(hit) => {
                const item = pending.find((p) => p.key === hit.key);
                if (item) openLoanFor([item]);
              }}
              onManualFix={onManualFix ? (hit) => {
                const item = pending.find((p) => p.key === hit.key);
                if (item) onManualFix([item]);
              } : undefined}
            />
            {visiblePending.length === 0 ? (
              <div className="ld-empty">
                <ShieldCheck />
                <strong>{t('loansInboxEmpty')}</strong>
                <span>{t('loansInboxEmptyHint')}</span>
              </div>
            ) : (
              <div className="ld-inbox">
                {visiblePending.map((item) => (
                  <article key={item.key} className="ld-inbox-card" data-pending-key={item.key}>
                    <div className="ld-inbox-top">
                      <div className={`ld-inbox-icon ${item.direction}`}><SourceIcon direction={item.direction} /></div>
                      <div className="ld-inbox-copy">
                        <div className="ld-inbox-title">
                          {item.direction === 'out' ? t('mloanSent') : t('mloanReceived')}{' '}
                          <strong>{fmtTotal(item.pendingUSDT)} USDT</strong>
                        </div>
                        <div className="ld-inbox-meta">
                          {EXCHANGE_LABELS[item.exchange]} {item.source === 'order' ? `P2P${item.price ? ` @ ${fmtPrice(item.price)} ${item.fiat ?? ''}` : ''}` : item.transfer ? transferKindLabel(item.transfer) : 'Network'}
                          {item.counterparty ? ` · ${item.counterparty}` : ''}
                          {item.ts ? ` · ${fmtDate(item.ts)}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="ld-inbox-actions">
                      <button type="button" className="ld-btn primary small" onClick={() => openLoanFor([item])}>
                        <Handshake /> {t('mloanItsLoan')}
                      </button>
                      <button
                        type="button"
                        className="ld-btn small ghost"
                        onClick={() => (item.direction === 'out' ? navigate('/trading/orders') : onImportPurchase())}
                      >
                        {item.direction === 'out' ? t('mloanItsSale') : t('mloanItsPurchase')}
                      </button>
                      <details className="ld-more">
                        <summary><MoreHorizontal /> {t('loansMoreOptions')}</summary>
                        <div className="ld-more-menu">
                          {onManualFix && (
                            <button type="button" onClick={() => onManualFix([item])}>{t('mloanFixManually')}</button>
                          )}
                          <button type="button" onClick={() => { void resolveItem(item, 'ignored'); }}>{t('mloanIgnore')}</button>
                          <button type="button" className="danger" onClick={() => { void resolveItem(item, 'deleted'); }}>{t('mloanRemove')}</button>
                        </div>
                      </details>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {filteredPending.length > limit && (
              <button type="button" className="ld-btn secondary small" onClick={() => setLimit((l) => l + PAGE)}>
                {t('mloanShowMore')}
              </button>
            )}
            {dismissed.length > 0 && (
              <details className="ld-resolved">
                <summary>{t('mloanResolvedGroup')} ({dismissed.length})</summary>
                <div className="ld-resolved-list">
                  {dismissed.map((d) => (
                    <div key={d.key} className="ld-resolved-row">
                      <div style={{ minWidth: 0 }}>
                        <strong>{d.direction === 'out' ? '↑' : '↓'} {fmtTotal(d.usdt)} USDT</strong>
                        <span>
                          {' · '}
                          {d.reason === 'deleted' ? t('mloanReasonRemoved') : d.reason === 'adjusted' ? t('mloanReasonAdjusted') : t('mloanReasonIgnored')}
                          {d.counterparty ? ` · ${d.counterparty}` : ''}
                        </span>
                      </div>
                      <button type="button" className="ld-btn small ghost" onClick={() => { void restore(d); }}>{t('mloanRestore')}</button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
          <aside className="ld-side">
            <div className="ld-side-card brand">
              <h3>{t('loansHowItWorks')}</h3>
              <p>{t('loansHowItWorksBody')}</p>
              <div className="ld-side-list">
                <div><Info /> <span>{t('mloanNeedsDecisionHint')}</span></div>
                <div><ShieldCheck /> <span>{t('mloanNoProfit')}</span></div>
              </div>
            </div>
            <div className="ld-side-card">
              <h3>{t('loansConnectedMerchants')}</h3>
              <p>{merchants.filter((m) => m.connected).length > 0 ? t('loansConnectedSync') : t('loansNoConnected')}</p>
              <button type="button" className="ld-btn secondary" onClick={() => openManual()}>
                <Plus /> {t('loansRecordMovement')}
              </button>
            </div>
          </aside>
        </div>
      )}

      {selected && renderStatement(selected)}

      {dialog && (
        <MerchantLoanDialog
          open
          sources={dialog.sources}
          presetName={dialog.presetName}
          state={state}
          applyStateAndCommit={applyStateAndCommit}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
