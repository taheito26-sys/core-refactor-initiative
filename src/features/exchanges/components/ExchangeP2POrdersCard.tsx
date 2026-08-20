import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { EXCHANGE_LABELS } from '../types';
import { stashTrackerImportPrefill } from '../tracker-import';

export function ExchangeP2POrdersCard() {
  const { data: orders, isLoading } = useExchangeP2POrders();
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
  const handleImport = (order: NonNullable<typeof orders>[number]) => {
    const kind = order.side === 'buy' ? 'batch' : 'trade';
    const needsQarRate = order.fiat.toUpperCase() !== 'QAR';
    stashTrackerImportPrefill({
      kind,
      exchange: order.exchange,
      orderId: order.id,
      orderNumber: order.order_number,
      amountUSDT: order.amount,
      ts: order.order_time ? new Date(order.order_time).getTime() : Date.now(),
      assigneeName: order.counterparty ?? undefined,
      priceFiat: needsQarRate ? 0 : order.price,
      needsQarRate,
      ...(needsQarRate
        ? { originalFiat: order.fiat, originalPriceFiat: order.price, originalTotalFiat: order.amount * order.price }
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
        {orders.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={o.side === 'buy' ? 'default' : 'secondary'} className="uppercase">{o.side}</Badge>
              <span className="font-medium">{EXCHANGE_LABELS[o.exchange]}</span>
              <span>{o.amount} {o.asset} @ {o.price} {o.fiat}</span>
              <span className="text-muted-foreground">{o.status}</span>
              {o.order_time && <span className="text-muted-foreground">{new Date(o.order_time).toLocaleString()}</span>}
            </div>
            {o.linked_at ? (
              <Badge variant="outline">Linked to tracker</Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => handleImport(o)}>
                Add to {o.side === 'buy' ? 'Stock' : 'Sell'} tracker
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
