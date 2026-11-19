import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Handshake,
  Info,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ModernSelect } from '@/components/shared/ModernSelect';
import { useT } from '@/lib/i18n';
import { fmtDate, fmtTotal, num, uid, type TrackerState } from '@/lib/tracker-helpers';
import type { UsdtTransferKind } from '@/lib/usdt-transfers';
import { EXCHANGE_LABELS, transferKindLabel } from '@/features/exchanges/types';
import {
  applyLoanMove,
  canonicalMerchantName,
  loanSourceAmount,
  loanSourceCanSplit,
  loanSourceConflict,
  loanSourceDirection,
  loanSourceTs,
  merchantNet,
  planLoanMove,
  type LoanSource,
} from '../loan-ledger';
import { TagError, type TagResult } from '../usdt-tagging';
import { useBorrowLendCommit } from '../hooks/useBorrowLendCommit';
import { useSharedLoanMoveActions } from '../hooks/useSharedLoanMoves';
import { useExchangeOrderLinks } from '@/features/exchanges/hooks/useExchangeOrderLinks';
import { useExchangeP2POrders } from '@/features/exchanges/hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '@/features/exchanges/hooks/useExchangeTransfers';
import { registeredOrderAmount, trackerOrderAmounts } from '@/features/exchanges/order-coverage';
import { taggedExchangeTransferIds } from '@/lib/usdt-transfers';
import { useLoanMerchantNames } from '../hooks/useLoanMerchantNames';
import '@/styles/loans-desk.css';

const EPS = 1e-6;
const MANUAL = '__manual__';

const nowInput = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const KIND_ICON: Record<UsdtTransferKind, string> = { borrow_in: '↓', lend_return: '↪', borrow_repay: '↩', lend_out: '↑' };

/** One short line describing a record being classified. */
function describeSource(src: LoanSource, t: ReturnType<typeof useT>): string {
  const dir = loanSourceDirection(src) === 'in' ? t('mloanReceived') : t('mloanSent');
  const amt = `${fmtTotal(loanSourceAmount(src))} USDT`;
  switch (src.type) {
    case 'exchange_transfer':
      return `${dir} ${amt} · ${EXCHANGE_LABELS[src.transfer.exchange]} ${transferKindLabel(src.transfer)} · ${fmtDate(loanSourceTs(src))}`;
    case 'exchange_order':
      return `${dir} ${amt} · ${EXCHANGE_LABELS[src.order.exchange]} P2P #${src.order.order_number} · ${fmtDate(loanSourceTs(src))}`;
    case 'batch':
      return `${dir} ${amt} · ${t('mloanFromBatch')} · ${fmtDate(src.ts)}`;
    case 'trade':
      return `${dir} ${amt} · ${t('mloanFromOrder')} · ${fmtDate(src.ts)}`;
    case 'manual':
      return t('mloanManualEntry');
  }
}

/**
 * The single "Merchant loan" action. The merchant picks WHO the USDT moved
 * with; applyLoanMove decides whether that borrowed, repaid, lent or got back
 * USDT from the running balance, and the preview says so in plain words
 * (with the balance after) before anything is saved.
 *
 * The picker is deliberately a dropdown, grouped into connected merchants and
 * merchants with history, because those are the two populations a merchant
 * actually chooses from.
 */
export function MerchantLoanDialog({
  open,
  sources,
  presetName,
  state,
  applyStateAndCommit,
  onClose,
}: {
  open: boolean;
  /** Records being classified; a single `manual` source opens the hand-entry form. */
  sources: LoanSource[];
  presetName?: string;
  state: TrackerState;
  applyStateAndCommit: (next: TrackerState) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const { commit, busy } = useBorrowLendCommit(applyStateAndCommit);
  const merchants = useLoanMerchantNames(state);
  const { propose, cancel } = useSharedLoanMoveActions();
  const { data: freshOrders } = useExchangeP2POrders();
  const { data: freshTransfers } = useExchangeTransfers();
  const { data: linksByOrder } = useExchangeOrderLinks();

  const manual = sources.length === 1 && sources[0].type === 'manual';
  const single = sources.length === 1 ? sources[0] : null;
  const canSplit = !!single && loanSourceCanSplit(single);

  const [name, setName] = useState(presetName ?? '');
  const [manualMode, setManualMode] = useState(false);
  const [amount, setAmount] = useState('');
  const [manualDir, setManualDir] = useState<'in' | 'out'>('out');
  const [manualDate, setManualDate] = useState(nowInput());

  useEffect(() => {
    if (!open) return;
    setName(presetName ?? '');
    setManualMode(false);
    // Keep the exact source amount. Exchange records are classified in full and
    // cannot be partially adjusted, so rounding 100.123456 to 100.12 makes the
    // read-only form impossible to save.
    setAmount(single && !manual ? String(loanSourceAmount(single)) : '');
    setManualDir('out');
    setManualDate(nowInput());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const knownNames = useMemo(() => merchants.map((m) => m.name), [merchants]);
  const finalName = canonicalMerchantName(name, knownNames);
  const selectedOption = merchants.find((m) => m.name.toLowerCase() === finalName.toLowerCase());
  const showManualInput = manualMode || (!!finalName && !selectedOption);
  const selectValue = manualMode ? MANUAL : (selectedOption?.name ?? '');

  const connected = merchants.filter((m) => m.connected);
  const history = merchants.filter((m) => !m.connected);
  const maxAmount = single && !manual ? loanSourceAmount(single) : Infinity;
  const amountEditable = manual || !single || canSplit;

  /** The concrete moves to record: [source, amount]. */
  const moves = useMemo((): { src: LoanSource; amount: number }[] => {
    if (manual) {
      const ts = new Date(manualDate).getTime();
      return [{ src: { type: 'manual', direction: manualDir, ts: Number.isFinite(ts) ? ts : Date.now() }, amount: num(amount, 0) }];
    }
    if (single) return [{ src: single, amount: num(amount, 0) }];
    return sources.map((src) => ({ src, amount: loanSourceAmount(src) }));
  }, [manual, manualDate, manualDir, amount, single, sources]);

  const totalAmount = moves.reduce((sum, m) => sum + m.amount, 0);
  const amountOk = moves.every((m) => m.amount > 0) && totalAmount <= maxAmount + EPS;
  const manualTs = new Date(manualDate).getTime();
  const futureDate = manual && Number.isFinite(manualTs) && manualTs > Date.now() + 60_000;

  /** Plain-language preview: amounts per meaning, and the balance after. */
  const preview = useMemo(() => {
    if (!finalName || !amountOk) return null;
    let net = merchantNet(state.usdtTransfers, finalName);
    const byKind = new Map<UsdtTransferKind, number>();
    let stockIn = 0;
    let stockOut = 0;
    for (const m of moves) {
      const dir = loanSourceDirection(m.src);
      const plan = planLoanMove(net, dir, m.amount);
      for (const p of plan.parts) byKind.set(p.kind, (byKind.get(p.kind) || 0) + p.amount);
      if (dir === 'in') stockIn += m.amount;
      else stockOut += m.amount;
      net = plan.after;
    }
    return { byKind, after: net, stockIn, stockOut };
  }, [finalName, amountOk, moves, state.usdtTransfers]);

  const kindSentence = (kind: UsdtTransferKind, amt: number) => {
    const key = { borrow_in: 'mloanPreviewBorrow', lend_return: 'mloanPreviewReturn', borrow_repay: 'mloanPreviewRepay', lend_out: 'mloanPreviewLend' }[kind] as
      | 'mloanPreviewBorrow'
      | 'mloanPreviewReturn'
      | 'mloanPreviewRepay'
      | 'mloanPreviewLend';
    return t(key).split('{amount}').join(fmtTotal(amt)).split('{name}').join(finalName);
  };

  const balanceSentence = (net: number) => {
    if (Math.abs(net) <= EPS) return t('mloanBalanceSettled').split('{name}').join(finalName);
    const key = net > 0 ? 'mloanBalanceIOwe' : 'mloanBalanceOwesMe';
    return t(key).split('{name}').join(finalName).split('{amount}').join(fmtTotal(Math.abs(net)));
  };

  const balanceSuffix = (net?: number) => {
    if (net === undefined) return t('loansConnected');
    if (Math.abs(net) <= EPS) return t('mloanSettledShort');
    return net > 0 ? `${t('mloanYouOweShort')} ${fmtTotal(net)}` : `${t('mloanOwesYouShort')} ${fmtTotal(-net)}`;
  };

  const choose = (value: string) => {
    if (value === MANUAL) {
      setManualMode(true);
      setName('');
      return;
    }
    setManualMode(false);
    setName(value);
  };

  const confirm = async () => {
    if (!finalName) {
      toast.error(t('mloanErrName'));
      return;
    }
    if (!amountOk) {
      toast.error(maxAmount < Infinity && totalAmount > maxAmount + EPS
        ? t('mloanErrExceeds').split('{x}').join(fmtTotal(maxAmount))
        : t('mloanErrAmount'));
      return;
    }
    if (futureDate) {
      toast.error(t('mloanErrFuture'));
      return;
    }
    // Re-check against the latest records: the same USDT may have been taken
    // as a sale or another loan since this dialog opened.
    const taggedTransfers = taggedExchangeTransferIds(state.usdtTransfers);
    for (const m of moves) {
      const src = m.src;
      const latestTransfer = src.type === 'exchange_transfer' ? (freshTransfers || []).find((x) => x.id === src.transfer.id) : undefined;
      const latestOrder = src.type === 'exchange_order' ? (freshOrders || []).find((x) => x.id === src.order.id) : undefined;
      const conflict = loanSourceConflict(src, m.amount, {
        transferTaggedAsLoan: src.type === 'exchange_transfer' && taggedTransfers.has(src.transfer.id),
        transferInOrder: !!latestTransfer && !!latestTransfer.linked_at && !!latestTransfer.linked_entity_id,
        orderRemaining: latestOrder
          ? Math.max(0, latestOrder.amount - registeredOrderAmount(latestOrder, { linksByOrder, trackerAmounts: trackerOrderAmounts(state) }))
          : undefined,
      });
      if (conflict) {
        toast.error(
          conflict.code === 'already_sale' ? t('mloanErrAlreadySale')
            : conflict.code === 'already_loan' ? t('mloanErrAlreadyLoan')
            : conflict.code === 'fully_registered' ? t('mloanErrFull')
            : t('mloanErrExceeds').split('{x}').join(fmtTotal(conflict.remaining)),
        );
        return;
      }
    }
    let acc: TagResult = { state };
    const dismiss = new Set<string>();
    const orderLinks: NonNullable<TagResult['orderLinks']> = [];
    const steps: { before: TrackerState; after: TrackerState }[] = [];
    try {
      for (const m of moves) {
        const r = applyLoanMove(acc.state, m.src, finalName, m.amount, uid);
        for (const d of r.dismiss || []) dismiss.add(d);
        orderLinks.push(...(r.orderLinks || []));
        steps.push({ before: acc.state, after: r.state });
        acc = r;
      }
    } catch (err) {
      toast.error(err instanceof TagError && err.code === 'merchant_linked' ? t('mloanErrLinked') : t('mloanErrAmount'));
      return;
    }
    // A connected merchant gets the movement as a request they approve. It is
    // sent before anything is saved here, so a failure leaves nothing half done.
    const relationshipId = selectedOption?.connected ? selectedOption.relationshipId : undefined;
    if (relationshipId) {
      const sent: string[] = [];
      try {
        for (const m of moves) {
          sent.push(await propose.mutateAsync({
            relationshipId,
            direction: loanSourceDirection(m.src),
            amount: m.amount,
            ts: Math.min(Date.now(), loanSourceTs(m.src) || Date.now()),
          }));
        }
      } catch (err) {
        console.error('[loan-sync] could not send the movement:', err);
        await Promise.allSettled(sent.map((id) => cancel.mutateAsync(id)));
        toast.error(t('loansSendFailed').split('{name}').join(finalName));
        return;
      }
      // Mark the transfers each movement created with its shared id.
      const remoteOf = new Map<string, string>();
      steps.forEach((step, i) => {
        const known = new Set((step.before.usdtTransfers || []).map((x) => x.id));
        for (const x of step.after.usdtTransfers || []) if (!known.has(x.id)) remoteOf.set(x.id, sent[i]);
      });
      acc = {
        ...acc,
        state: {
          ...acc.state,
          usdtTransfers: (acc.state.usdtTransfers || []).map((x) => (remoteOf.has(x.id) ? { ...x, remoteLoanId: remoteOf.get(x.id) } : x)),
        },
      };
    }
    if (await commit({ state: acc.state, dismiss: Array.from(dismiss), orderLinks }, 'mloanSaved')) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="ld-dialog tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'}>
        <DialogTitle className="sr-only">{t('mloanTitle')}</DialogTitle>
        <DialogDescription className="sr-only">{t('loansHowItWorksBody')}</DialogDescription>
        <div className="ld-dialog-head">
          <div>
            <div className="ld-kicker"><Handshake /> {t('loansEyebrow')}</div>
            <h2 className="ld-dialog-title">{t('mloanTitle')}</h2>
            <p className="ld-dialog-sub">
              {manual ? t('loansHowItWorksBody') : describeSource(sources[0], t)}
            </p>
          </div>
        </div>

        <div className="ld-dialog-body">
          {!manual && sources.length > 0 && (
            <div className="ld-source">
              <Info />
              <div>
                <strong>{sources.length === 1 ? t('loansPreviewTitle') : `${sources.length} ${t('mloanMoreRecords')}`}</strong>
                <div style={{ marginTop: 3 }}>{describeSource(sources[0], t)}</div>
                {sources.length > 1 && <div style={{ marginTop: 3 }}>+{sources.length - 1} · {fmtTotal(totalAmount)} USDT</div>}
              </div>
            </div>
          )}

          {manual && (
            <>
              <div className="ld-field">
                <label>{t('loansDirection')}</label>
                <div className="ld-dir-grid">
                  <button type="button" className={`ld-dir ${manualDir === 'out' ? 'active' : ''}`} onClick={() => setManualDir('out')}>
                    <ArrowUpRight />
                    <span><strong>{t('loansSentUsdt')}</strong><span>{t('loansOutHint')}</span></span>
                  </button>
                  <button type="button" className={`ld-dir ${manualDir === 'in' ? 'active' : ''}`} onClick={() => setManualDir('in')}>
                    <ArrowDownLeft />
                    <span><strong>{t('loansReceivedUsdt')}</strong><span>{t('loansInHint')}</span></span>
                  </button>
                </div>
              </div>
              <div className="ld-form-grid">
                <div className="ld-field">
                  <label htmlFor="loan-amount">{t('mloanAmount')}</label>
                  <input id="loan-amount" className="ld-input" inputMode="decimal" placeholder="USDT" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
                </div>
                <div className="ld-field">
                  <label htmlFor="loan-date">{t('loansWhen')}</label>
                  <div style={{ position: 'relative' }}>
                    <input id="loan-date" className="ld-input" type="datetime-local" max={nowInput()} value={manualDate} onChange={(e) => setManualDate(e.target.value)} style={{ paddingInlineStart: 34 }} />
                    <CalendarDays size={14} style={{ position: 'absolute', insetInlineStart: 11, top: 12, color: 'var(--muted)', pointerEvents: 'none' }} />
                  </div>
                </div>
              </div>
            </>
          )}

          {single && !manual && (
            <div className="ld-field">
              <label htmlFor="loan-source-amount">{t('loansAmountToRecord')}</label>
              <input
                id="loan-source-amount"
                className="ld-input"
                inputMode="decimal"
                value={amount}
                readOnly={!amountEditable}
                onChange={(e) => setAmount(e.target.value)}
              />
              <small>
                {amountEditable
                  ? t('loansAmountHint').split('{amount}').join(fmtTotal(maxAmount))
                  : `${fmtTotal(maxAmount)} ${t('loansAvailable')}`}
              </small>
            </div>
          )}

          <div className="ld-field">
            <label>{t('mloanWhichMerchant')}</label>
            <ModernSelect
              value={selectValue}
              onChange={(e) => choose(e.target.value)}
              placeholder={t('loansChooseMerchant')}
              ariaLabel={t('mloanWhichMerchant')}
            >
              <option value="">{t('loansChooseMerchant')}</option>
              {connected.length > 0 && (
                <optgroup label={t('loansConnectedGroup')}>
                  {connected.map((m) => (
                    <option key={`connected-${m.name}`} value={m.name}>
                      {m.name} · {balanceSuffix(m.net)}
                    </option>
                  ))}
                </optgroup>
              )}
              {history.length > 0 && (
                <optgroup label={t('loansHistoryGroup')}>
                  {history.map((m) => (
                    <option key={`history-${m.name}`} value={m.name}>
                      {m.name}{m.net !== undefined ? ` · ${balanceSuffix(m.net)}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={MANUAL}>{t('loansManualMerchant')}</option>
            </ModernSelect>

            {selectedOption?.connected && (
              <div className="ld-connected-line"><ShieldCheck /> {t('loansConnectedSync')}</div>
            )}
            {finalName && !selectedOption?.connected && (
              <div className="ld-connected-line" style={{ color: 'var(--muted)' }}><Info /> {t('loansManualSync')}</div>
            )}

            {showManualInput ? (
              <div className="ld-field" style={{ marginTop: 2 }}>
                <label htmlFor="loan-merchant-name">{t('loansMerchantName')}</label>
                <input
                  id="loan-merchant-name"
                  className="ld-input"
                  placeholder={t('mloanMerchantPlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus={!presetName}
                />
              </div>
            ) : (
              <button type="button" className="ld-manual-link" onClick={() => { setManualMode(true); setName(''); }}>
                <Plus size={11} style={{ verticalAlign: -1 }} /> {t('loansManualMerchant')}
              </button>
            )}
            {connected.length === 0 && <small>{t('loansNoConnected')}</small>}
          </div>

          {preview && (
            <div className="ld-preview">
              <div className="ld-preview-title">{t('loansPreviewTitle')}</div>
              {Array.from(preview.byKind.entries()).map(([kind, amt]) => (
                <div key={kind} className="ld-preview-row">
                  <ArrowUpRight />
                  <span>{KIND_ICON[kind]} {kindSentence(kind, amt)}</span>
                </div>
              ))}
              <div className={`ld-preview-after ${preview.after < 0 ? 'owed' : 'owe'}`}>
                {t('mloanAfterThis')} {balanceSentence(preview.after)}
              </div>
              <div className="ld-preview-note">
                {preview.stockIn > 0 && `${t('mloanStock')} +${fmtTotal(preview.stockIn)} · `}
                {preview.stockOut > 0 && `${t('mloanStock')} −${fmtTotal(preview.stockOut)} · `}
                {t('loansNoPnl')}
              </div>
            </div>
          )}
        </div>

        <div className="ld-dialog-foot">
          <button type="button" className="ld-btn secondary" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="ld-btn primary" disabled={busy || !preview || futureDate} onClick={() => { void confirm(); }}>
            <Handshake /> {t('loansSaveMovement')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
