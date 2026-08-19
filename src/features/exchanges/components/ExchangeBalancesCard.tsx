import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useExchangeBalances } from '../hooks/useExchangeBalances';
import { EXCHANGE_LABELS } from '../types';

export function ExchangeBalancesCard() {
  const { data: balances, isLoading } = useExchangeBalances();

  if (isLoading) return null;
  if (!balances || balances.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Exchange Balances</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No balances yet. Connect an exchange and sync to pull spot &amp; funding balances.</p>
        </CardContent>
      </Card>
    );
  }

  const grouped = balances.reduce<Record<string, typeof balances>>((acc, b) => {
    const key = `${b.exchange}:${b.account_type}`;
    (acc[key] ??= []).push(b);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exchange Balances</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(grouped).map(([key, rows]) => {
          const [exchange, accountType] = key.split(':');
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{EXCHANGE_LABELS[exchange as keyof typeof EXCHANGE_LABELS]}</span>
                <Badge variant="outline" className="capitalize">{accountType}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                {rows
                  .sort((a, b) => b.free + b.locked - (a.free + a.locked))
                  .map((b) => (
                    <div key={b.id} className="flex justify-between rounded bg-muted/40 px-2 py-1">
                      <span>{b.asset}</span>
                      <span className="tabular-nums">
                        {b.free.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                        {b.locked > 0 && (
                          <span className="text-muted-foreground"> (+{b.locked.toLocaleString(undefined, { maximumFractionDigits: 8 })} locked)</span>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
