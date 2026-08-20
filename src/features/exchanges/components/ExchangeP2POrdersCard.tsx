import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { EXCHANGE_LABELS } from '../types';
import { stashTrackerImportPrefill } from '../tracker-import';

export function ExchangeP2POrdersCard() {
  const { data: orders, isLoading } = useExchangeP2POrders();
  const navigate = useNavigate();
  /** USDT->QAR conversion rate the user enters for orders sold in a non-QAR fiat (e.g. EGP). */
  const [qarRates, setQarRates] = useState<Record<string, string>>({});

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

  const handleImport = (order: NonNullable<typeof orders>[number], qarPrice: number) => {
    const kind = order.side === 'buy' ? 'batch' : 'trade';
    const needsQarConversion = order.fiat.toUpperCase() !== 'QAR';
    stashTrackerImportPrefill({
      kind,
      exchange: order.exchange,
      orderId: order.id,
      orderNumber: order.order_number,
      fiat: 'QAR',
      amountUSDT: order.amount,
      priceFiat: qarPrice,
      ts: order.order_time ? new Date(order.order_time).getTime() : Date.now(),
      ...(needsQarConversion
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
        {orders.map((o) => {
          const needsQarConversion = o.fiat.toUpperCase() !== 'QAR';
          const rawRate = qarRates[o.id] ?? '';
          const parsedRate = parseFloat(rawRate);
          const rateValid = Number.isFinite(parsedRate) && parsedRate > 0;
          const qarPrice = needsQarConversion ? parsedRate : o.price;
          const importDisabled = needsQarConversion && !rateValid;
          return (
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
                <div className="flex flex-wrap items-center gap-2">
                  {needsQarConversion && (
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-muted-foreground">1 USDT =</span>
                      <Input
                        value={rawRate}
                        onChange={(e) => setQarRates((p) => ({ ...p, [o.id]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="e.g. 3.8"
                        aria-label="USDT to QAR conversion rate"
                        className="h-7 w-16 px-1.5 text-xs"
                      />
                      <span className="text-muted-foreground">QAR</span>
                    </div>
                  )}
                  <Button size="sm" variant="outline" disabled={importDisabled} onClick={() => handleImport(o, qarPrice)}>
                    Add to {o.side === 'buy' ? 'Stock' : 'Sell'} tracker
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
