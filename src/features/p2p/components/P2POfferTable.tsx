import { P2POffer } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';

interface Props {
  offers: P2POffer[];
  type: 'sell' | 'buy';
  t: any;
}

function formatOfferLimit(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '∞';
  if (value >= 1_000_000) return `${fmtPrice(value / 1_000_000)}M`;
  if (value >= 1_000) return `${fmtTotal(value / 1_000)}K`;
  return fmtTotal(value);
}

export function P2POfferTable({ offers, type, t }: Props) {
  const isSell = type === 'sell';
  const maxAvailable = Math.max(...(offers.map(o => o.available) || [1]));

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-1 pt-2.5 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className={`text-[11px] font-semibold flex items-center gap-1.5 ${isSell ? 'text-success' : 'text-destructive'}`}>
            {isSell ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isSell ? t('p2pSellOffers') : t('p2pRestockOffers')}
          </CardTitle>
          <Badge className="text-[8px] px-1.5 py-0.5" variant={isSell ? 'default' : 'destructive'}>
            {isSell ? t('p2pHighestFirst') : t('p2pCheapestFirst')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pTrader')}</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pPrice')}</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pMin')}</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pMax')}</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pMethods')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offers.map((o, i) => {
              const depthPct = maxAvailable > 0 ? Math.min(100, (o.available / maxAvailable) * 100) : 0;
              return (
                <TableRow key={`${type}-${i}`} className="h-7">
                  <TableCell className="text-[11px] font-medium whitespace-nowrap py-1">{o.nick}</TableCell>
                  <TableCell className="py-1">
                    <div className="flex items-center gap-1">
                      <span className="font-bold font-mono text-[11px]">{fmtPrice(o.price)}</span>
                      <div className="w-10 h-1 rounded bg-muted overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${depthPct}%`, background: isSell ? 'hsl(var(--success))' : 'hsl(var(--destructive))' }} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] py-1">{o.min > 0 ? o.min.toLocaleString() : '—'}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] py-1">{formatOfferLimit(o.max)}</TableCell>
                  <TableCell className="text-[10px] text-muted-foreground py-1 truncate max-w-[100px]">{o.methods.join(' ')}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}