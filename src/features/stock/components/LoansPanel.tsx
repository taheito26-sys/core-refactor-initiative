import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useT, type TranslationKey } from '@/lib/i18n';
import { fmtDate, fmtPrice, fmtTotal, type DerivedState, type TrackerState } from '@/lib/tracker-helpers';
import type { UsdtTransfer, UsdtTransferKind } from '@/lib/usdt-transfers';
import { EXCHANGE_LABELS } from '@/features/exchanges/types';
import { dismissTransfer } from '@/features/exchanges/api';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';
import { buildMerchantStatements, pendingItemToLoanSource, undoLoanMove, type LoanSource, type MerchantStatement } from '../loan-ledger';
import { useBorrowLendCommit } from '../hooks/useBorrowLendCommit';
import { usePendingExchangeItems } from '../hooks/usePendingExchangeItems';
import { MerchantLoanDialog } from './MerchantLoanDialog';

const KIND_META: Record<UsdtTransferKind, { icon: string; label: TranslationKey }> = {
  borrow_in: { icon: '⬇️', label: 'mloanKindBorrowed' },
  borrow_repay: { icon: '↩️', label: 'mloanKindRepaid' },
  lend_out: { icon: '⬆️', label: 'mloanKindLent' },
  lend_return: { icon: '↪️', label: 'mloanKindReturned' },
};

const PAGE = 25;

/**
 * USDT loans between merchants, in one place:
 *
 * 1. "Needs a decision" — every Binance/OKX record not yet registered. Each
 *    one gets exactly one answer: a sale, a purchase, a merchant loan, or
 *    ignore. The mismatch check points here too.
 * 2. One statement per merchant — running balance ("you owe" / "owes you"),
 *    every move with where it came from, and Undo.
 */
export function LoansPanel({
  state,
  derived,
  applyStateAndCommit,
  onImportPurchase,
}: {
  state: TrackerState;
  derived: DerivedState;
  applyStateAndCommit: (next: TrackerState) => Promise<void>;
  /** Show the Add batch form, where incoming exchange records are imported as purchases. */
  onImportPurchase: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { commit, busy } = useBorrowLendCommit(applyStateAndCommit);
  const pending = usePendingExchangeItems(state);

  const [dialog, setDialog] = useState<{ sources: LoanSource[]; presetName?: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const statements = useMemo(() => buildMerchantStatements(state.usdtTransfers), [state.usdtTransfers]);
  const open = statements.filter((s) => Math.abs(s.net) > 1e-6);
  const settled = statements.filter((s) => Math.abs(s.net) <= 1e-6);

  const inPrice = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of derived.batches) if (b.isTransfer) m.set(b.id, b.buyPriceQAR);
    return m;
  }, [derived.batches]);
  const unitCost = (x: UsdtTransfer) =>
    x.kind === 'borrow_in' || x.kind === 'lend_return' ? inPrice.get(x.id) : derived.transferCalc?.get(x.id)?.unitCost ?? undefined;

  const selectedItems = pending.filter((p) => selected.has(p.key));
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openLoanFor = (items: PendingExchangeItem[]) => {
    const sources = items.map(pendingItemToLoanSource).filter((s): s is LoanSource => !!s);
    if (sources.length) setDialog({ sources });
  };

  const ignore = async (item: PendingExchangeItem) => {
    if (!item.transfer) return;
    try {
      await dismissTransfer(item.transfer.id);
      await queryClient.invalidateQueries({ queryKey: ['exchange-transfers'] });
    } catch {
      toast.error(t('mloanSaveFailed'));
    }
  };

  const undo = (x: UsdtTransfer) => {
    if (!window.confirm(t('mloanUndoConfirm'))) return;
    void commit(undoLoanMove(state, x.id), 'mloanUndone');
  };

  const balanceText = (s: MerchantStatement | { net: number; name: string }) => {
    if (Math.abs(s.net) <= 1e-6) return t('mloanSettledShort');
    return s.net > 0
      ? t('mloanBalanceIOwe').split('{name}').join(s.name).split('{amount}').join(fmtTotal(s.net))
      : t('mloanBalanceOwesMe').split('{name}').join(s.name).split('{amount}').join(fmtTotal(-s.net));
  };
  const balanceColor = (net: number) => (net > 1e-6 ? 'var(--bad)' : net < -1e-6 ? 'var(--good)' : 'var(--muted)');

  const sourceText = (x: UsdtTransfer) => {
    const src = x.source;
    if (!src) return t('mloanManualEntry');
    if (src.type === 'exchange') return `${EXCHANGE_LABELS[src.exchange]} ${t('mloanTransfer')}`;
    if (src.type === 'exchange_order') return `${EXCHANGE_LABELS[src.exchange]} P2P #${src.orderNumber}`;
    if (src.type === 'batch') return t('mloanFromBatch');
    return t('mloanFromOrder');
  };

  const renderStatement = (s: MerchantStatement) => {
    const shownGroups = new Set<string>();
    const groups = s.monthGroups || [];
    const lines = [...s.lines].reverse();

    // If we have monthGroups, show grouped by month. Otherwise fall back to all lines.
    if (groups.length > 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <button type="button" className="rowBtn" style={{ alignSelf: 'flex-start', fontSize: 11 }}
            onClick={() => setDialog({ sources: [{ type: 'manual', direction: 'out', ts: Date.now() }], presetName: s.name })}>
            ＋ {t('mloanAddMove')}
          </button>
          {groups.map((group) => {
            const groupLines = [...group.lines].reverse();
            return (
              <div key={group.yearMonth} style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
                  {group.yearMonth}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {groupLines.map((l) => {
                    const meta = KIND_META[l.kind];
                    const cost = unitCost(l.transfer);
                    const undoable = !l.groupId || !shownGroups.has(l.groupId);
                    if (l.groupId) shownGroups.add(l.groupId);
                    return (
                      <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>
                            {meta.icon} {t(meta.label)} <span className="mono">{fmtTotal(l.amount)}</span>
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {fmtDate(l.ts)} · {sourceText(l.transfer)}
                            {cost ? ` · ${l.estimated ? t('mloanEstCost') : t('mloanCost')} ${fmtPrice(cost)}` : ''}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: balanceColor(l.balanceAfter) }}>
                            → {balanceText({ net: l.balanceAfter, name: s.name })}
                          </div>
                        </div>
                        {undoable && (
                          <button type="button" className="rowBtn" disabled={busy} onClick={() => undo(l.transfer)}>{t('mloanUndo')}</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // Fallback: show all lines (old format)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        <button type="button" className="rowBtn" style={{ alignSelf: 'flex-start', fontSize: 11 }}
          onClick={() => setDialog({ sources: [{ type: 'manual', direction: 'out', ts: Date.now() }], presetName: s.name })}>
          ＋ {t('mloanAddMove')}
        </button>
        {lines.map((l) => {
          const meta = KIND_META[l.kind];
          const cost = unitCost(l.transfer);
          const undoable = !l.groupId || !shownGroups.has(l.groupId);
          if (l.groupId) shownGroups.add(l.groupId);
          return (
            <div key={l.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {meta.icon} {t(meta.label)} <span className="mono">{fmtTotal(l.amount)}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {fmtDate(l.ts)} · {sourceText(l.transfer)}
                  {cost ? ` · ${l.estimated ? t('mloanEstCost') : t('mloanCost')} ${fmtPrice(cost)}` : ''}
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: balanceColor(l.balanceAfter) }}>
                  → {balanceText({ net: l.balanceAfter, name: s.name })}
                </div>
              </div>
              {undoable && (
                <button type="button" className="rowBtn" disabled={busy} onClick={() => undo(l.transfer)}>{t('mloanUndo')}</button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderMerchant = (s: MerchantStatement) => {
    const isOpen = openKey === s.key;
    return (
      <div key={s.key} className="panel" style={{ padding: 10 }}>
        <button type="button" onClick={() => setOpenKey(isOpen ? null : s.key)}
          style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{s.name}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{s.lines.length} {t('mloanMoves')} · {fmtDate(s.lastTs)}</div>
          </div>
          <div style={{ textAlign: 'end', fontSize: 12, fontWeight: 800, color: balanceColor(s.net) }}>
            {balanceText(s)} {isOpen ? '▾' : '▸'}
          </div>
        </button>
        {isOpen && renderStatement(s)}
      </div>
    );
  };

  const visiblePending = pending.slice(0, limit);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{t('mloanPanelTitle')}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('mloanPanelHint')}</div>
      </div>

      {/* ── Needs a decision ── */}
      <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>{t('mloanNeedsDecision')}</div>
          <span className="pill" style={{ fontSize: 10, color: pending.length ? 'var(--warn)' : 'var(--good)' }}>
            {pending.length ? pending.length : '✓'}
          </span>
        </div>
        {pending.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('mloanAllDecided')}</div>}
        {pending.length > 0 && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('mloanNeedsDecisionHint')}</div>}

        {selectedItems.length > 0 && (
          <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)', border: '1px solid var(--brand)', borderRadius: 8, padding: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, flex: 1 }}>
              {selectedItems.length} {t('mloanSelected')} · <span className="mono">{fmtTotal(selectedItems.reduce((s, i) => s + i.pendingUSDT, 0))} USDT</span>
            </span>
            <button type="button" className="btn" onClick={() => openLoanFor(selectedItems)}>🤝 {t('mloanTitle')}</button>
            <button type="button" className="btn secondary" onClick={() => setSelected(new Set())}>{t('cancel')}</button>
          </div>
        )}

        {visiblePending.map((item) => (
          <div key={item.key} data-pending-key={item.key} style={{ borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" aria-label={t('mloanSelect')} checked={selected.has(item.key)} onChange={() => toggle(item.key)} style={{ width: 16, height: 16, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800 }}>
                  {item.direction === 'out' ? '⬆️' : '⬇️'} {item.direction === 'out' ? t('mloanSent') : t('mloanReceived')} <span className="mono">{fmtTotal(item.pendingUSDT)} USDT</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {EXCHANGE_LABELS[item.exchange]} {item.source === 'order' ? `P2P${item.price ? ` @ ${fmtPrice(item.price)} ${item.fiat ?? ''}` : ''}` : item.transfer?.kind === 'pay' ? 'Pay' : 'Network'}
                  {item.counterparty ? ` · ${item.counterparty}` : ''}
                  {item.ts ? ` · ${fmtDate(item.ts)}` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingInlineStart: 24 }}>
              <button type="button" className="rowBtn" onClick={() => (item.direction === 'out' ? navigate('/trading/orders') : onImportPurchase())}>
                {item.direction === 'out' ? `🧾 ${t('mloanItsSale')}` : `📦 ${t('mloanItsPurchase')}`}
              </button>
              <button type="button" className="rowBtn" style={{ borderColor: 'var(--brand)', color: 'var(--brand)', fontWeight: 800 }} onClick={() => openLoanFor([item])}>
                🤝 {t('mloanItsLoan')}
              </button>
              {item.transfer && (
                <button type="button" className="rowBtn" onClick={() => { void ignore(item); }}>✕ {t('mloanIgnore')}</button>
              )}
            </div>
          </div>
        ))}
        {pending.length > limit && (
          <button type="button" className="btn secondary" onClick={() => setLimit((l) => l + PAGE)}>{t('mloanShowMore')}</button>
        )}
      </div>

      {/* ── Merchants ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>{t('mloanMerchants')}</div>
        <button type="button" className="rowBtn" onClick={() => setDialog({ sources: [{ type: 'manual', direction: 'out', ts: Date.now() }] })}>
          ＋ {t('mloanManualEntry')}
        </button>
      </div>
      {open.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('mloanNoOpen')}</div>}
      {open.map(renderMerchant)}
      {settled.length > 0 && (
        <>
          <button type="button" className="rowBtn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowSettled((v) => !v)}>
            {showSettled ? '▾' : '▸'} {t('mloanSettledGroup')} ({settled.length})
          </button>
          {showSettled && settled.map(renderMerchant)}
        </>
      )}

      {dialog && (
        <MerchantLoanDialog
          open
          sources={dialog.sources}
          presetName={dialog.presetName}
          state={state}
          applyStateAndCommit={applyStateAndCommit}
          onClose={() => { setDialog(null); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
