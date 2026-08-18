import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useExchangeTransfers } from '../hooks/useExchangeTransfers';
import { EXCHANGE_LABELS } from '../types';

export function ExchangeTransfersCard() {
  const { data: transfers, isLoading } = useExchangeTransfers();

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay &amp; Network Transfers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!transfers || transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transfers pulled yet. Sync a connected exchange to import USDT received or sent via
            Binance Pay / OKX transfers and on-chain deposits.
          </p>
        ) : (
          transfers.map((tr) => (
            <div key={tr.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {tr.direction === 'in' ? (
                  <ArrowDownLeft className="h-4 w-4 text-green-500" />
                ) : (
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">
                  {tr.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {tr.asset}
                </span>
                <Badge variant="outline">{EXCHANGE_LABELS[tr.exchange]}</Badge>
                <Badge variant="secondary" className="capitalize">
                  {tr.kind === 'pay' ? 'Pay' : 'Network'}
                </Badge>
                <span className="text-muted-foreground">{tr.status}</span>
                {tr.transfer_time && (
                  <span className="text-muted-foreground">{new Date(tr.transfer_time).toLocaleString()}</span>
                )}
              </div>
              {tr.linked_at ? (
                <Badge variant="outline">Linked to tracker</Badge>
              ) : tr.direction === 'in' ? (
                <span className="text-xs text-muted-foreground">Add from the Stock page</span>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
