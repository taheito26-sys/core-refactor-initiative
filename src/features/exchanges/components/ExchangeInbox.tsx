import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Inbox, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '../hooks/useExchangeTransfers';
import { useExchangeOrderLinks, sumLinkedAmount } from '../hooks/useExchangeOrderLinks';
import { EXCHANGE_LABELS, type ExchangeId } from '../types';
import { dismissTransfer } from '../api';

/** Amounts within this margin of each other are treated as fully matched (floating-point/rounding noise from the exchange). */
const AMOUNT_EPSILON = 0.01;

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
  /** Representative id -- the most recent one when several transfers were combined into one pick. */
  transferId: string;
  /** Every transfer folded into this pick, so all of them get marked linked to the one saved record. Always at least one entry. */
  transferIds: string[];
  /** Reference of the picked transfer, or all of them joined when combined. */
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
  monthKey,
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
  /**
   * "YYYY-MM" (local calendar, matching OrdersPage's month pills) or "all".
   * When a specific month, only that month's orders/transfers are listed --
   * mirrors the same month filter the rest of the Orders page uses, so this
   * feed shows exactly what the selected pill implies.
   */
  monthKey?: string;
}) {
  const { data: orders } = useExchangeP2POrders();
  const { data: transfers } = useExchangeTransfers();
  const { data: linksByOrder } = useExchangeOrderLinks();
  const [collapsed, setCollapsed] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  /** Transfers ticked for a combined pick -- several top-ups from one sender folded into a single record. */
  const [selectedTransferIds, setSelectedTransferIds] = useState<Set<string>>(new Set());

  const toggleTransferSelected = (id: string) => {
    setSelectedTransferIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDismissTransfer = async (transferId: string) => {
    setDismissingId(transferId);
    try {
      await dismissTransfer(transferId);
      await queryClient.invalidateQueries({ queryKey: ['exchange-transfers'] });
    } catch {
      toast.error('Could not dismiss this transfer');
    } finally {
      setDismissingId(null);
    }
  };

  const inSelectedMonth = useMemo(() => {
    if (!monthKey || monthKey === 'all') return () => true;
    return (iso: string | null) => {
      if (!iso) return false;
      const d = new Date(iso);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === monthKey;
    };
  }, [monthKey]);

  const isImported = useMemo(() => {
    return (linkedAt: string | null, linkedEntityId: string | null, referenceKey: string) => {
      if (importedReferences?.has(referenceKey)) return true;
      if (!linkedAt) return false;
      if (!activeEntityIds || !linkedEntityId) return true;
      return activeEntityIds.has(linkedEntityId);
    };
  }, [activeEntityIds, importedReferences]);

  /**
   * One order can be split across multiple customers/suppliers, so "imported"
   * is really "how much of it is registered so far" -- full, partial, or none.
   * Falls back to the legacy full/boolean signal (isImported above) for an
   * order predating the split-links table or whose link insert never landed.
   */
  const orderCoverage = useMemo(() => {
    return (o: NonNullable<typeof allOrders>[number]) => {
      const links = (linksByOrder?.get(o.id) ?? []).filter(
        (l) => !activeEntityIds || activeEntityIds.has(l.entity_id),
      );
      let linkedAmount = sumLinkedAmount(links);
      if (linkedAmount <= AMOUNT_EPSILON && isImported(o.linked_at, o.linked_entity_id, o.order_number)) {
        linkedAmount = o.amount;
      }
      const remaining = Math.max(0, o.amount - linkedAmount);
      return {
        remaining,
        isFull: remaining <= AMOUNT_EPSILON,
        isPartial: linkedAmount > AMOUNT_EPSILON && remaining > AMOUNT_EPSILON,
      };
    };
  }, [linksByOrder, activeEntityIds, isImported]);

  const allOrders = useMemo(
    () =>
      (orders ?? [])
        .filter((o) => o.side === side && inSelectedMonth(o.order_time))
        .sort((a, b) => (b.order_time ? new Date(b.order_time).getTime() : 0) - (a.order_time ? new Date(a.order_time).getTime() : 0)),
    [orders, side, inSelectedMonth],
  );
  const transferDirection = side === 'buy' ? 'in' : 'out';
  const allTransfers = useMemo(
    () =>
      onPickTransfer
        ? (transfers ?? [])
            .filter((tr) => tr.direction === transferDirection && !tr.dismissed_at && inSelectedMonth(tr.transfer_time))
            .sort((a, b) => (b.transfer_time ? new Date(b.transfer_time).getTime() : 0) - (a.transfer_time ? new Date(a.transfer_time).getTime() : 0))
        : [],
    [transfers, onPickTransfer, transferDirection, inSelectedMonth],
  );

  // A tick only counts while its row is still pending and still listed --
  // one imported elsewhere, dismissed, or filtered out by the month pill
  // drops out of the selection on its own.
  const selectedTransfers = allTransfers.filter(
    (tr) => selectedTransferIds.has(tr.id) && !isImported(tr.linked_at, tr.linked_entity_id, tr.reference),
  );
  const selectedTotal = selectedTransfers.reduce((sum, tr) => sum + tr.amount, 0);
  const sameSender = new Set(selectedTransfers.map((tr) => tr.counterparty ?? '')).size === 1;
  const sameKind = new Set(selectedTransfers.map((tr) => tr.kind)).size === 1;
  // One tick fills the form with that transfer; each further tick adds to
  // the total, as long as they all came from the same sender the same way.
  const canCombine = selectedTransfers.length >= 1 && sameSender && sameKind;

  const pickSelection = () => {
    if (!onPickTransfer || !canCombine) return;
    const oldestFirst = [...selectedTransfers].sort(
      (a, b) => (a.transfer_time ? new Date(a.transfer_time).getTime() : 0) - (b.transfer_time ? new Date(b.transfer_time).getTime() : 0),
    );
    const latest = oldestFirst[oldestFirst.length - 1];
    onPickTransfer({
      exchange: latest.exchange,
      transferId: latest.id,
      transferIds: oldestFirst.map((tr) => tr.id),
      reference: oldestFirst.map((tr) => tr.reference).join(', '),
      kind: latest.kind,
      amountUSDT: selectedTotal,
      buyPrice: defaultPrice && defaultPrice > 0 ? defaultPrice : 0,
      ts: latest.transfer_time ? new Date(latest.transfer_time).getTime() : Date.now(),
      assigneeName: latest.counterparty ?? undefined,
    });
  };

  // Ticking IS the combine: every change to the selection refills the form
  // with the running total, exactly as tapping a single row fills it with
  // that row. Keyed on the ticked ids so a background refresh of the
  // transfer list doesn't re-fire it and stomp on edits mid-form.
  const selectionKey = selectedTransfers.map((tr) => tr.id).sort().join(',');
  const pickSelectionRef = useRef(pickSelection);
  useEffect(() => {
    pickSelectionRef.current = pickSelection;
  });
  useEffect(() => {
    if (!selectionKey) return;
    pickSelectionRef.current();
  }, [selectionKey]);

  const total = allOrders.length + allTransfers.length;
  if (total === 0) return null;

  const pendingCount =
    allOrders.filter((o) => !orderCoverage(o).isFull).length +
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

      {!collapsed && selectedTransfers.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-primary/20 bg-primary/5 px-2 py-1">
          <span className="min-w-0 truncate text-[10px]">
            {!canCombine ? (
              <span className="font-semibold text-amber-500">Tick transfers from the same sender only</span>
            ) : (
              <>
                <span className="text-muted-foreground">{selectedTransfers.length} combined — </span>
                <span className="font-bold text-primary">
                  {fmtNum(selectedTotal, 8)} {selectedTransfers[0]?.asset ?? 'USDT'}
                </span>
                <span className="text-muted-foreground"> in the form</span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setSelectedTransferIds(new Set())}
            className="shrink-0 rounded border border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-destructive/60 hover:text-destructive"
          >
            Clear
          </button>
        </div>
      )}
      {!collapsed && (
        <div className="max-h-[196px] space-y-1 overflow-y-auto overflow-x-hidden p-1">
          {rows.map((row) => row.kind === 'order' ? (() => {
            const o = row.data;
            const { remaining, isFull, isPartial } = orderCoverage(o);
            const imported = isFull;
            const accent = ACCENT[side];
            const needsQarRate = o.fiat.toUpperCase() !== 'QAR';
            // A split continuation targets a different customer/supplier than
            // the exchange's own counterparty, and only asks for the amount
            // still outstanding rather than the order's full amount.
            const pickAmount = isPartial ? remaining : o.amount;
            return (
              <button
                key={o.id}
                type="button"
                disabled={imported}
                title={imported ? 'Already in the tracker' : isPartial ? 'Assign the remaining amount to another customer' : 'Fill the form with this order'}
                onClick={() =>
                  onPick({
                    exchange: o.exchange,
                    orderId: o.id,
                    orderNumber: o.order_number,
                    amountUSDT: pickAmount,
                    ts: o.order_time ? new Date(o.order_time).getTime() : Date.now(),
                    assigneeName: isPartial ? undefined : (o.counterparty ?? undefined),
                    priceFiat: needsQarRate ? 0 : o.price,
                    needsQarRate,
                    ...(needsQarRate
                      // o.total is the fiat amount the exchange itself reported for this
                      // order -- o.amount is the crypto (USDT) leg, not fiat, so don't
                      // recompute the total from amount * price (that drifts from the
                      // real total once price has already been rounded once on sync).
                      ? { originalFiat: o.fiat, originalPriceFiat: o.price, originalTotalFiat: o.total }
                      : {}),
                  })
                }
                className={cn(
                  'flex w-full max-w-full overflow-hidden rounded border text-left',
                  imported ? 'cursor-default border-dashed bg-muted/10 opacity-60' : 'bg-muted/30 hover:border-primary/60 hover:bg-muted/50',
                )}
              >
                <div className={cn('w-0.5 shrink-0 self-stretch', imported ? 'bg-emerald-500/40' : isPartial ? 'bg-amber-500' : accent.bar)} />
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
                      {fmtNum(o.total)} {o.fiat}
                    </span>
                    <Chip className={EXCHANGE_CHIP[o.exchange]}>{EXCHANGE_LABELS[o.exchange]}</Chip>
                    <Chip className={KIND_CHIP.p2p.cls}>{KIND_CHIP.p2p.label}</Chip>
                    {!imported && needsQarRate && (
                      <Chip className="bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400">needs QAR rate</Chip>
                    )}
                    {isPartial && (
                      <Chip className="bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400">
                        {fmtNum(remaining)} {o.asset} left — split across customers
                      </Chip>
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
            const selected = selectedTransferIds.has(tr.id);
            return (
              <div key={tr.id} className="flex w-full max-w-full items-stretch gap-1">
              {!imported && (
                <button
                  type="button"
                  title={selected ? 'Deselect' : 'Tick to combine with other transfers from the same sender'}
                  onClick={() => toggleTransferSelected(tr.id)}
                  className={cn(
                    'flex shrink-0 items-center justify-center rounded border px-1.5',
                    selected
                      ? 'border-primary bg-primary/20 text-primary'
                      : 'border-dashed border-muted-foreground/40 text-muted-foreground/30 hover:border-primary/50 hover:text-muted-foreground/60',
                  )}
                >
                  <Check className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                disabled={imported}
                title={imported ? 'Already in the tracker' : 'Fill the form with this transfer'}
                onClick={() => {
                  onPickTransfer!({
                    exchange: tr.exchange,
                    transferId: tr.id,
                    transferIds: [tr.id],
                    reference: tr.reference,
                    kind: tr.kind,
                    amountUSDT: tr.amount,
                    buyPrice: defaultPrice && defaultPrice > 0 ? defaultPrice : 0,
                    ts: tr.transfer_time ? new Date(tr.transfer_time).getTime() : Date.now(),
                    assigneeName: tr.counterparty ?? undefined,
                  });
                  // This row alone now fills the form, so any half-made
                  // selection is moot -- drop it rather than leave the
                  // combine bar standing over a form it didn't fill.
                  setSelectedTransferIds(new Set());
                }}
                className={cn(
                  'flex min-w-0 flex-1 overflow-hidden rounded border border-dashed text-left',
                  imported ? 'cursor-default bg-muted/10 opacity-60' : 'bg-muted/30 hover:border-primary/60 hover:bg-muted/50',
                  selected && 'border-primary/60 bg-primary/10',
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
              {!imported && (
                <button
                  type="button"
                  disabled={dismissingId === tr.id}
                  title="Not an order — hide this from the list"
                  onClick={() => handleDismissTransfer(tr.id)}
                  className="flex shrink-0 items-center justify-center rounded border border-dashed border-muted-foreground/30 px-1 text-muted-foreground hover:border-destructive/60 hover:text-destructive disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              </div>
            );
          })())}
        </div>
      )}
    </div>
  );
}
