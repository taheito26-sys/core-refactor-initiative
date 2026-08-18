import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Download, PencilLine } from 'lucide-react';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { EXCHANGE_LABELS } from '../types';

export interface ExchangeOrderPayload {
  exchange: 'binance' | 'okx';
  orderId: string;
  orderNumber: string;
  fiat: string;
  amountUSDT: number;
  priceFiat: number;
  ts: number;
}

function toPayload(o: {
  id: string; exchange: 'binance' | 'okx'; order_number: string; fiat: string;
  amount: number; price: number; order_time: string | null;
}): ExchangeOrderPayload {
  return {
    exchange: o.exchange,
    orderId: o.id,
    orderNumber: o.order_number,
    fiat: o.fiat,
    amountUSDT: o.amount,
    priceFiat: o.price,
    ts: o.order_time ? new Date(o.order_time).getTime() : Date.now(),
  };
}

/**
 * A single slim row that appears only when a connected exchange has P2P orders
 * not yet in the tracker. The common case — import them all — is one click.
 * Reviewing/choosing happens in a modal so nothing on the page shifts.
 */
export function ExchangeImportBar({
  side,
  onImportMany,
  onFillForm,
}: {
  side: 'buy' | 'sell';
  /** Import these orders straight into the tracker, no form step. */
  onImportMany: (orders: ExchangeOrderPayload[]) => Promise<void> | void;
  /** Load a single order into the on-screen form for manual tweaking. */
  onFillForm: (order: ExchangeOrderPayload) => void;
}) {
  const { data: orders } = useExchangeP2POrders();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const pending = useMemo(
    () => (orders ?? []).filter((o) => o.side === side && !o.linked_at),
    [orders, side],
  );

  if (pending.length === 0) return null;

  const exchanges = [...new Set(pending.map((o) => EXCHANGE_LABELS[o.exchange]))].join(' & ');
  const selected = pending.filter((o) => !excluded.has(o.id));

  const runImport = async (rows: typeof pending) => {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      await onImportMany(rows.map(toPayload));
      setDialogOpen(false);
      setExcluded(new Set());
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-xs">
        <Badge variant="secondary" className="shrink-0">{pending.length}</Badge>
        <span className="flex-1 truncate text-muted-foreground">
          {exchanges} {side === 'buy' ? 'buys' : 'sells'} not in tracker
        </span>
        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => runImport(pending)} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Import all
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDialogOpen(true)} disabled={busy}>
          Review
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(v) => !busy && setDialogOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Import {side === 'buy' ? 'purchases' : 'sales'} from {exchanges}
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[50vh] pr-3">
            <div className="space-y-1.5">
              {pending.map((o) => (
                <div key={o.id} className="flex items-center gap-2 rounded bg-muted/40 px-2 py-1.5 text-xs">
                  <Checkbox
                    checked={!excluded.has(o.id)}
                    onCheckedChange={() => toggle(o.id)}
                    aria-label={`Include order ${o.order_number}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {o.amount} {o.asset} @ {o.price} {o.fiat}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {EXCHANGE_LABELS[o.exchange]}
                      {o.order_time ? ` · ${new Date(o.order_time).toLocaleString()}` : ''}
                      {o.counterparty ? ` · ${o.counterparty}` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-xs"
                    title="Load into the form instead of importing directly"
                    onClick={() => {
                      onFillForm(toPayload(o));
                      setDialogOpen(false);
                    }}
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => runImport(selected)} disabled={busy || selected.length === 0}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Import {selected.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
