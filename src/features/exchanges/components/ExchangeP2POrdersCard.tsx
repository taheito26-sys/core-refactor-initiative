import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeOrderLinks, sumLinkedAmount } from '../hooks/useExchangeOrderLinks';
import { EXCHANGE_LABELS } from '../types';
import { stashTrackerImportPrefill } from '../tracker-import';

/** Amounts within this margin of each other are treated as fully matched (floating-point/rounding noise from the exchange). */
const AMOUNT_EPSILON = 0.01;

export function ExchangeP2POrdersCard() {
  const { data: orders, isLoading } = useExchangeP2POrders();
  const { data: linksByOrder } = useExchangeOrderLinks();
  const navigate = useNavigate();

  if (isLoading) return null;
  if (!orders || orders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Exchange P2P Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No P2P orders pulled yet. Sync a connected exchange to import your P2P order history.</p>
        </CardContent>
      </Card>
    );
  }

  // Picking an order only prefills the tracker's normal entry form, which is
  // where the price, name and everything else get confirmed and saved.
  // `amountOverride` lets the same order be re-picked for whatever amount is
  // still unregistered, so it can be split across more than one customer.
  const handleImport = (order: NonNullable<typeof orders>[number], amountOverride?: number) => {
    const kind = order.side === 'buy' ? 'batch' : 'trade';
    const needsQarRate = order.fiat.toUpperCase() !== 'QAR';
    const amountUSDT = amountOverride ?? order.amount;
    stashTrackerImportPrefill({
      kind,
      exchange: order.exchange,
      orderId: order.id,
      orderNumber: order.order_number,
      amountUSDT,
      ts: order.order_time ? new Date(order.order_time).getTime() : Date.now(),
      // A split continuation is going to a different customer, so the
      // original counterparty name is no longer a safe default.
      assigneeName: amountOverride == null ? (order.counterparty ?? undefined) : undefined,
      priceFiat: needsQarRate ? 0 : order.price,
      needsQarRate,
      ...(needsQarRate
        // order.total is the fiat amount Binance itself reported for this order —
        // use it directly rather than recomputing amount * price, which drifts
        // from the real total once price has already been rounded once.
        ? { originalFiat: order.fiat, originalPriceFiat: order.price, originalTotalFiat: order.total }
        : {}),
    });
    navigate(kind === 'batch' ? '/trading/stock' : '/trading/orders');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exchange P2P Orders</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {orders.map((o) => {
          const linkedAmount = sumLinkedAmount(linksByOrder?.get(o.id));
          const remaining = Math.max(0, o.amount - linkedAmount);
          const isFullyLinked = remaining <= AMOUNT_EPSILON;
          const isPartiallyLinked = linkedAmount > AMOUNT_EPSILON && !isFullyLinked;
          return (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={o.side === 'buy' ? 'default' : 'secondary'} className="uppercase">{o.side}</Badge>
                <span className="font-medium">{EXCHANGE_LABELS[o.exchange]}</span>
                <span>{o.amount} {o.asset} @ {o.price} {o.fiat}</span>
                <span className="text-muted-foreground">{o.status}</span>
                {o.order_time && <span className="text-muted-foreground">{new Date(o.order_time).toLocaleString()}</span>}
              </div>
              {isFullyLinked ? (
                <Badge variant="outline">Linked to tracker</Badge>
              ) : isPartiallyLinked ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-amber-500 text-amber-600">
                    Partially linked — {remaining.toFixed(2)} {o.asset} left
                  </Badge>
                  <Button size="sm" variant="outline" onClick={() => handleImport(o, remaining)}>
                    Assign remaining to another {o.side === 'buy' ? 'supplier' : 'customer'}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => handleImport(o)}>
                  Add to {o.side === 'buy' ? 'Stock' : 'Sell'} tracker
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
