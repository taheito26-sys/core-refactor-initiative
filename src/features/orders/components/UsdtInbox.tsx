import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Inbox } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { fmtDate, fmtTotal, type TrackerState } from '@/lib/tracker-helpers';
import { EXCHANGE_LABELS, transferKindLabel } from '@/features/exchanges/types';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';
import { OKX_ESCROW_SOURCE } from '@/features/exchanges/normalize-transfers';
import { OkxOrderDetailsEditor } from '@/features/exchanges/components/OkxOrderDetailsEditor';
import { pendingItemToLoanSource, type LoanSource } from '@/features/stock/loan-ledger';
import { usePendingExchangeItems } from '@/features/stock/hooks/usePendingExchangeItems';
import '@/styles/orders-inbox.css';

/** OKX escrow rows arrive without a price, so the merchant must enter it first. */
const needsAmountEntry = (order: NonNullable<PendingExchangeItem['order']>) =>
  order.exchange === 'okx'
  && (order.raw as { source?: string } | null | undefined)?.source === OKX_ESCROW_SOURCE
  && !(order.price > 0);

/**
 * The one place a sent USDT movement is allowed to wait before it becomes an
 * order or a merchant loan. The same records feed the Loans composer, so a
 * movement can never be both.
 */
export function UsdtInbox({
  state,
  onSale,
  onPurchase,
  onLoan,
}: {
  state: TrackerState;
  onSale: (item: PendingExchangeItem) => void;
  onPurchase: (item: PendingExchangeItem) => void;
  onLoan: (source: LoanSource) => void;
}) {
  const t = useT();
  const pending = usePendingExchangeItems(state);
  const [expanded, setExpanded] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PendingExchangeItem['order'] | null>(null);
  if (pending.length === 0) return null;

  const sent = pending.filter((item) => item.direction === 'out');
  const received = pending.filter((item) => item.direction === 'in');
  const visible = expanded ? pending : pending.slice(0, 4);
  const hidden = pending.length - visible.length;

  const sourceLabel = (item: PendingExchangeItem) => {
    if (item.source === 'order') {
      return `${EXCHANGE_LABELS[item.exchange]} P2P${item.price ? ` @ ${fmtTotal(item.price)} ${item.fiat ?? ''}` : ''}`;
    }
    return `${EXCHANGE_LABELS[item.exchange]} · ${item.transfer ? transferKindLabel(item.transfer) : 'USDT'}`;
  };

  return (
    <>
    <section className="oi-shell" aria-label={t('ordersInboxTitle')}>
      <div className="oi-head">
        <span className="oi-icon"><Inbox /></span>
        <div className="oi-title">
          <h2>{t('ordersInboxTitle')}</h2>
          <p>{t('ordersInboxHint')}</p>
        </div>
        <span className="oi-count">{pending.length}</span>
      </div>

      <div className="oi-flow" aria-hidden="true">
        <span><b>1</b> {t('ordersFlowSent')}</span>
        <i />
        <span><b>2</b> {t('ordersFlowDecide')}</span>
        <i />
        <span><b>3</b> {t('ordersFlowDone')}</span>
      </div>

      <div className="oi-list">
        {visible.map((item) => {
          const out = item.direction === 'out';
          const loanSource = pendingItemToLoanSource(item);
          return (
            <article key={item.key} className={`oi-row ${out ? 'out' : 'in'}`}>
              <div className="oi-row-main">
                <div className="oi-amount">
                  <span className="oi-arrow">{out ? <ArrowUpRight /> : <ArrowDownLeft />}</span>
                  {fmtTotal(item.pendingUSDT)} <small>USDT</small>
                  <span className={`oi-side ${out ? 'out' : 'in'}`}>{out ? t('mloanSent') : t('mloanReceived')}</span>
                </div>
                <div className="oi-meta">
                  <span>{sourceLabel(item)}</span>
                  {item.counterparty && <span>{item.counterparty}</span>}
                  <span>{fmtDate(item.ts)}</span>
                </div>
              </div>
              <div className="oi-actions">
                <button
                  type="button"
                  className="oi-btn sale"
                  onClick={() => {
                    if (out && item.order && needsAmountEntry(item.order)) {
                      setEditingOrder(item.order);
                      return;
                    }
                    if (out) onSale(item);
                    else onPurchase(item);
                  }}
                >
                  {out ? t('ordersInboxSale') : t('ordersInboxPurchase')}
                </button>
                {loanSource && (
                  <button type="button" className="oi-btn loan" onClick={() => onLoan(loanSource)}>
                    {t('ordersInboxLoan')}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="oi-foot">
        <span>
          {t('ordersInboxCounts')
            .split('{sent}').join(String(sent.length))
            .split('{received}').join(String(received.length))}
        </span>
        {hidden > 0 && (
          <button type="button" className="oi-more" onClick={() => setExpanded(true)}>
            {t('ordersInboxShowAll').split('{count}').join(String(hidden))} <ChevronDown />
          </button>
        )}
        {expanded && pending.length > 4 && (
          <button type="button" className="oi-more" onClick={() => setExpanded(false)}>
            {t('ordersInboxShowLess')} <ChevronDown style={{ transform: 'rotate(180deg)' }} />
          </button>
        )}
      </div>
    </section>
    {editingOrder && (
      <OkxOrderDetailsEditor order={editingOrder} onClose={() => setEditingOrder(null)} />
    )}
    </>
  );
}
