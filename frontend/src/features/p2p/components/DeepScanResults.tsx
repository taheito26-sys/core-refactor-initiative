import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';
import { fmtPrice } from '@/lib/tracker-helpers';
import type { P2POffer } from '../types';

// Max USDT per single transaction for a given offer
function maxUSDTPerTx(o: P2POffer): number {
  if (o.max > 0) return o.max / o.price;
  return o.available;
}

interface Props {
  offers: P2POffer[]; // buyOffers (restock/buy side)
  currency: string;
}

export default function DeepScanResults({ offers, currency }: Props) {
  const [amountStr, setAmountStr]       = useState('');
  const [singleMerchant, setSingle]     = useState(false);
  const [scanned, setScanned]           = useState(false);
  const [scanAmount, setScanAmount]     = useState(0);
  const [scanSingle, setScanSingle]     = useState(false);

  const results = useMemo(() => {
    if (!scanned || scanAmount <= 0) return [];
    return offers
      .filter(o => {
        // Stock sufficiency: trader has enough USDT available
        if (o.available < scanAmount) return false;
        // Single-merchant constraint: max per tx covers the required amount
        if (scanSingle && maxUSDTPerTx(o) < scanAmount) return false;
        return true;
      })
      .sort((a, b) => a.price - b.price); // cheapest first
  }, [offers, scanned, scanAmount, scanSingle]);

  const handleScan = () => {
    const amt = parseFloat(amountStr);
    if (!amt || amt <= 0) return;
    setScanAmount(amt);
    setScanSingle(singleMerchant);
    setScanned(true);
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-2.5 px-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-[11px] font-semibold flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" />
            Deep Market Scan
          </CardTitle>

          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="number"
              placeholder="USDT amount"
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              className="h-7 text-[11px] w-32"
              onKeyDown={e => e.key === 'Enter' && handleScan()}
            />
            <Button
              size="sm"
              variant={singleMerchant ? 'default' : 'outline'}
              className="h-7 text-[10px] px-2"
              onClick={() => setSingle(s => !s)}
            >
              1-Merchant{singleMerchant ? ' ✓' : ''}
            </Button>
            <Button
              size="sm"
              className="h-7 text-[10px] px-3"
              onClick={handleScan}
              disabled={!amountStr || parseFloat(amountStr) <= 0}
            >
              Scan
            </Button>
            {scanned && (
              <Badge variant="secondary" className="text-[9px]">
                {results.length} result{results.length !== 1 ? 's' : ''} ·{' '}
                {scanAmount.toLocaleString()} USDT
                {scanSingle ? ' · 1-merchant' : ''}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {!scanned ? (
          <p className="text-center text-muted-foreground py-6 text-[10px]">
            Enter a USDT amount and click Scan to find matching restock offers
          </p>
        ) : results.length === 0 ? (
          <p className="text-center text-muted-foreground py-6 text-[10px]">
            No offers match {scanAmount.toLocaleString()} USDT
            {scanSingle ? ' (single merchant)' : ''} criteria
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold">Trader</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold">Price ({currency})</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">Available</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold">Methods</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">30d</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-center">✓%</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">Fdbk</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">Pay/Rel</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">All Time</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold">Type</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {results.map((o, i) => (
                <TableRow key={i} className="h-7">
                  <TableCell className="text-[11px] font-medium whitespace-nowrap py-1">
                    {i === 0 && <span className="text-yellow-500 mr-0.5">★</span>}
                    {o.nick}
                    {o.message && (
                      <span
                        className="ml-1 text-[8px] text-muted-foreground"
                        title={o.message}
                      >
                        💬
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="py-1">
                    <span
                      className="font-bold font-mono text-[11px]"
                      style={{ color: 'hsl(var(--destructive))' }}
                    >
                      {fmtPrice(o.price)}
                    </span>
                  </TableCell>

                  <TableCell className="text-right font-mono text-[11px] py-1">
                    {o.available.toFixed(0)}
                  </TableCell>

                  <TableCell className="text-[10px] text-muted-foreground py-1 max-w-[110px] truncate">
                    {o.methods.join(', ')}
                  </TableCell>

                  <TableCell className="text-right font-mono text-[10px] text-muted-foreground py-1">
                    {o.trades > 0 ? o.trades.toLocaleString() : '—'}
                  </TableCell>

                  <TableCell
                    className="text-center font-mono text-[10px] py-1"
                    style={{ color: o.completion >= 0.9 ? 'var(--good)' : undefined }}
                  >
                    {o.completion > 0 ? `${(o.completion * 100).toFixed(0)}%` : '—'}
                  </TableCell>

                  <TableCell className="text-right font-mono text-[10px] py-1">
                    {o.feedback != null
                      ? `${(o.feedback * 100).toFixed(0)}%`
                      : '—'}
                  </TableCell>

                  <TableCell className="text-right font-mono text-[10px] text-muted-foreground py-1">
                    {o.avgPay != null || o.avgRelease != null
                      ? `${o.avgPay ?? '?'}/${o.avgRelease ?? '?'}m`
                      : '—'}
                  </TableCell>

                  <TableCell className="text-right font-mono text-[10px] text-muted-foreground py-1">
                    {o.allTimeTrades != null
                      ? o.allTimeTrades.toLocaleString()
                      : '—'}
                  </TableCell>

                  <TableCell className="text-[9px] text-muted-foreground py-1">
                    {o.status ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
