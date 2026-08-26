import { useMemo, useState } from 'react';
import { Check, ChevronDown, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '../hooks/useExchangeTransfers';
import { EXCHANGE_LABELS, type ExchangeId } from '../types';

export interface ExchangeOrderPayload {
  exchange: ExchangeId;
  orderId: string;
  orderNumber: string;
  amountUSDT: number;
  ts: number;
  /** Counterparty name the exchange reported, used to prefill the buyer/supplier field. */
  assigneeName?: string;
  /**
   * Unit price in QAR, or 0 when the order was settled in another fiat and the
   * user still has to supply a QAR rate in the form.
   */
  priceFiat: number;
  /** True when the exchange order was not in QAR, so the form must ask for the rate. */
  needsQarRate?: boolean;
  /** Present for a non-QAR order -- the original figures, kept on the saved record. */
  originalFiat?: string;
  originalPriceFiat?: number;
  originalTotalFiat?: number;
}

export interface ExchangeTransferPayload {
  exchange: ExchangeId;
  transferId: string;
  reference: string;
  kind: 'pay' | 'network';
  amountUSDT: number;
  buyPrice: number;
  ts: number;
  assigneeName?: string;
}

/** Each row type gets its own accent so the list is scannable at a glance. */
const ACCENT = {
  buy: { bar: 'bg-emerald-500', amount: 'text-emerald-500 dark:text-emerald-400' },
  sell: { bar: 'bg-orange-500', amount: 'text-orange-500 dark:text-orange-400' },
  transfer: { bar: 'bg-cyan-500', amount: 'text-cyan-600 dark:text-cyan-400' },
} as const;

const EXCHANGE_CHIP: Record<ExchangeId, string> = {
  binance: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30',
  okx: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/30',
};

/** Where the record came from on the exchange, which decides how it is read. */
const KIND_CHIP = {
  p2p: { label: 'P2P', cls: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 ring-fuchsia-500/30' },
  pay: { label: 'Pay', cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-violet-500/30' },
  network: { label: 'Network', cls: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 ring-teal-500/30' },
} as const;

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('shrink-0 rounded px-1 py-px text-[9px] font-semibold leading-tight ring-1 ring-inset', className)}>
      {children}
    </span>
  );
}

const fmtNum = (n: number, max = 2) => n.toLocaleString(undefined, { maximumFractionDigits: max });

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

/**
 * Everything synced from a connected exchange, as one compact feed that stays
 * a complete record: already-imported rows stay in place, dimmed and marked,
 * so the list matches the exchange's own order history rather than emptying
 * out as things are imported.
 *
 * Each row is a single tap that prefills the normal entry form and nothing
 * else -- the user reviews and saves with the same button as a hand-entered
 * order, so there is exactly one way to record a sale or a batch. When no
 * exchange is connected this renders nothing at all, leaving the form exactly
 * as it was before exchanges existed.
 */
export function ExchangeInbox({
  side,
  onPick,
  onPickTransfer,
  defaultPrice,
  activeEntityIds,
  importedReferences,
}: {
  side: 'buy' | 'sell';
  onPick: (order: ExchangeOrderPayload) => void;
  /**
   * On the buy side this surfaces incoming Pay/on-chain transfers (received
   * USDT becomes stock); on the sell side it surfaces outgoing ones (USDT
   * sent out via Pay is a sale settled off-exchange in fiat).
   */
  onPickTransfer?: (transfer: ExchangeTransferPayload) => void;
  /** Cost basis used to prefill a transfer, typically the weighted-average cost. */
  defaultPrice?: number;
  /**
   * IDs of batches/trades still alive in the tracker. A row marked linked to
   * an id that's no longer in this set (because the batch/trade was deleted)
   * is treated as pending again, so deleting an import lets it be re-imported.
   */
  activeEntityIds?: Set<string>;
  /**
   * Order numbers / transfer references already found in a live batch/trade's
   * note. Fallback "already imported" signal for when the batch/trade save
   * succeeded but the follow-up call marking the exchange row itself as
   * linked failed (that call is fire-and-forget) -- without this, that row
   * looks pending forever even though it's already in the tracker.
   */
  importedReferences?: Set<string>;
}) {
  const { data: orders } = useExchangeP2POrders();
  const { data: transfers } = useExchangeTransfers();
  const [collapsed, setCollapsed] = useState(false);

  const isImported = useMemo(() => {
    return (linkedAt: string | null, linkedEntityId: string | null, referenceKey: string) => {
      if (importedReferences?.has(referenceKey)) return true;
      if (!linkedAt) return false;
      if (!activeEntityIds || !linkedEntityId) return true;
      return activeEntityIds.has(linkedEntityId);
    };
  }, [activeEntityIds, importedReferences]);

  const allOrders = useMemo(
    () =>
      (orders ?? [])
        .filter((o) => o.side === side)
        .sort((a, b) => (b.order_time ? new Date(b.order_time).getTime() : 0) - (a.order_time ? new Date(a.order_time).getTime() : 0)),
    [orders, side],
  );
  const transferDirection = side === 'buy' ? 'in' : 'out';
  const allTransfers = useMemo(
    () =>
      onPickTransfer
        ? (transfers ?? [])
            .filter((tr) => tr.direction === transferDirection)
            .sort((a, b) => (b.transfer_time ? new Date(b.transfer_time).getTime() : 0) - (a.transfer_time ? new Date(a.transfer_time).getTime() : 0))
        : [],
    [transfers, onPickTransfer, transferDirection],
  );

  const total = allOrders.length + allTransfers.length;
  if (total === 0) return null;

  const pendingCount =
    allOrders.filter((o) => !isImported(o.linked_at, o.linked_entity_id, o.order_number)).length +
    allTransfers.filter((tr) => !isImported(tr.linked_at, tr.linked_entity_id, tr.reference)).length;

  // One chronological feed -- orders and transfers interleaved by date/time,
  // not grouped by type, so the list matches the exchange's own history.
  type Row =
    | { kind: 'order'; ts: number; data: (typeof allOrders)[number] }
    | { kind: 'transfer'; ts: number; data: (typeof allTransfers)[number] };
  const rows: Row[] = [
    ...allOrders.map((o): Row => ({ kind: 'order', ts: o.order_time ? new Date(o.order_time).getTime() : 0, data: o })),
    ...allTransfers.map((tr): Row => ({ kind: 'transfer', ts: tr.transfer_time ? new Date(tr.transfer_time).getTime() : 0, data: tr })),
  ].sort((a, b) => b.ts - a.ts);

  const ImportedMark = () => (
    <span className="flex shrink-0 items-center gap-0.5 pl-1 text-[10px] font-semibold text-emerald-500">
      <Check className="h-3 w-3" /> Imported
    </span>
  );

  return (
    <div className="w-full max-w-full overflow-hidden rounded-lg border border-primary/25 bg-card">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between gap-2 border-b border-primary/20 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent px-2 py-1 text-left"
      >
        <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold">
          <Inbox className="h-3 w-3 shrink-0 text-primary" />
          <span className="truncate">From your exchanges</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {pendingCount > 0 ? (
            <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">
              {pendingCount} new
            </span>
          ) : (
            <span className="text-[10px] font-semibold text-emerald-500">all imported</span>
          )}
          <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', collapsed && '-rotate-90')} />
        </span>
      </button>

      {!collapsed && (
        <div className="max-h-[196px] space-y-1 overflow-y-auto overflow-x-hidden p-1">
          {rows.map((row) => row.kind === 'order' ? (() => {
            const o = row.data;
            const imported = isImported(o.linked_at, o.linked_entity_id, o.order_number);
            const accent = ACCENT[side];
            const needsQarRate = o.fiat.toUpperCase() !== 'QAR';
            return (
              <button
                key={o.id}
                type="button"
                disabled={imported}
                title={imported ? 'Already in the tracker' : 'Fill the form with this order'}
                onClick={() =>
                  onPick({
                    exchange: o.exchange,
                    orderId: o.id,
                    orderNumber: o.order_number,
                    amountUSDT: o.amount,
                    ts: o.order_time ? new Date(o.order_time).getTime() : Date.now(),
                    assigneeName: o.counterparty ?? undefined,
                    priceFiat: needsQarRate ? 0 : o.price,
                    needsQarRate,
                    ...(needsQarRate
                      ? { originalFiat: o.fiat, originalPriceFiat: o.price, originalTotalFiat: o.amount * o.price }
                      : {}),
                  })
                }
                className={cn(
                  'flex w-full max-w-full overflow-hidden rounded border text-left',
                  imported ? 'cursor-default border-dashed bg-muted/10 opacity-60' : 'bg-muted/30 hover:border-primary/60 hover:bg-muted/50',
                )}
              >
                <div className={cn('w-0.5 shrink-0 self-stretch', imported ? 'bg-emerald-500/40' : accent.bar)} />
                <div className="min-w-0 flex-1 px-1.5 py-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-[12px] font-bold leading-tight">
                      <span className={accent.amount}>{fmtNum(o.amount)} {o.asset}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">@</span>
                      <span>{fmtNum(o.price, 4)} {o.fiat}</span>
                    </div>
                    {imported && <ImportedMark />}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground/80">
                      {fmtNum(o.amount * o.price)} {o.fiat}
                    </span>
                    <Chip className={EXCHANGE_CHIP[o.exchange]}>{EXCHANGE_LABELS[o.exchange]}</Chip>
                    <Chip className={KIND_CHIP.p2p.cls}>{KIND_CHIP.p2p.label}</Chip>
                    {!imported && needsQarRate && (
                      <Chip className="bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400">needs QAR rate</Chip>
                    )}
                    {o.counterparty && <span className="truncate">{o.counterparty}</span>}
                    <span className="truncate">{fmtWhen(o.order_time)}</span>
                  </div>
                </div>
              </button>
            );
          })() : (() => {
            const tr = row.data;
            const imported = isImported(tr.linked_at, tr.linked_entity_id, tr.reference);
            const kind = KIND_CHIP[tr.kind];
            return (
              <button
                key={tr.id}
                type="button"
                disabled={imported}
                title={imported ? 'Already in the tracker' : 'Fill the form with this transfer'}
                onClick={() =>
                  onPickTransfer!({
                    exchange: tr.exchange,
                    transferId: tr.id,
                    reference: tr.reference,
                    kind: tr.kind,
                    amountUSDT: tr.amount,
                    buyPrice: defaultPrice && defaultPrice > 0 ? defaultPrice : 0,
                    ts: tr.transfer_time ? new Date(tr.transfer_time).getTime() : Date.now(),
                    assigneeName: tr.counterparty ?? undefined,
                  })
                }
                className={cn(
                  'flex w-full max-w-full overflow-hidden rounded border border-dashed text-left',
                  imported ? 'cursor-default bg-muted/10 opacity-60' : 'bg-muted/30 hover:border-primary/60 hover:bg-muted/50',
                )}
              >
                <div className={cn('w-0.5 shrink-0 self-stretch', imported ? 'bg-emerald-500/40' : ACCENT.transfer.bar)} />
                <div className="min-w-0 flex-1 px-1.5 py-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className={cn('truncate text-[12px] font-bold leading-tight', ACCENT.transfer.amount)}>
                      {fmtNum(tr.amount, 8)} {tr.asset}
                    </span>
                    {imported && <ImportedMark />}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    <span>{tr.direction === 'in' ? 'received' : 'sent'}</span>
                    <Chip className={EXCHANGE_CHIP[tr.exchange]}>{EXCHANGE_LABELS[tr.exchange]}</Chip>
                    <Chip className={kind.cls}>{kind.label}</Chip>
                    {!imported && (
                      <Chip className="bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400">
                        {tr.direction === 'in' ? 'needs cost basis' : 'needs sell rate'}
                      </Chip>
                    )}
                    {tr.counterparty && <span className="truncate">{tr.counterparty}</span>}
                    <span className="truncate">{fmtWhen(tr.transfer_time)}</span>
                  </div>
                </div>
              </button>
            );
          })())}
        </div>
      )}
    </div>
  );
}
