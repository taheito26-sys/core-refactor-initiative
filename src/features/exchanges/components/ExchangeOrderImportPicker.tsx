import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Download } from 'lucide-react';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { EXCHANGE_LABELS } from '../types';

export interface ExchangeOrderPrefillPayload {
  exchange: 'binance' | 'okx';
  orderId: string;
  orderNumber: string;
  fiat: string;
  amountUSDT: number;
  priceFiat: number;
  ts: number;
}

export function ExchangeOrderImportPicker({
  side,
  onImport,
  title = 'Import from connected exchange',
}: {
  side: 'buy' | 'sell';
  onImport: (payload: ExchangeOrderPrefillPayload) => void;
  title?: string;
}) {
  const { data: orders, isLoading } = useExchangeP2POrders();
  const [open, setOpen] = useState(false);

  const available = useMemo(
    () => (orders ?? []).filter((o) => o.side === side && !o.linked_at),
    [orders, side],
  );

  if (isLoading || available.length === 0) return null;

  return (
    <div className="rounded-md border border-dashed p-2 text-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          {title}
          <Badge variant="secondary">{available.length}</Badge>
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {available.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">{EXCHANGE_LABELS[o.exchange]}</Badge>
                <span>{o.amount} {o.asset} @ {o.price} {o.fiat}</span>
                {o.order_time && <span className="text-muted-foreground">{new Date(o.order_time).toLocaleString()}</span>}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onImport({
                    exchange: o.exchange,
                    orderId: o.id,
                    orderNumber: o.order_number,
                    fiat: o.fiat,
                    amountUSDT: o.amount,
                    priceFiat: o.price,
                    ts: o.order_time ? new Date(o.order_time).getTime() : Date.now(),
                  })
                }
              >
                Use
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
