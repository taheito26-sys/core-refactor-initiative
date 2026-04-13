import { useState } from 'react';
import { P2POffer, PaymentMethodCategory } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';

interface Props {
  offers: P2POffer[];
  type: 'sell' | 'buy';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

function formatOfferLimit(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '∞';
  if (value >= 1_000_000) return `${fmtPrice(value / 1_000_000)}M`;
  if (value >= 1_000) return `${fmtTotal(value / 1_000)}K`;
  return fmtTotal(value);
}

const CAT_LABELS: Record<PaymentMethodCategory, string> = {
  vodafone_cash: 'VCash',
  instapay: 'InstaPay',
  bank: 'Bank',
  wallet: 'Wallet',
  other: 'Other',
};

function ExpandedDetail({ offer }: { offer: P2POffer }) {
  const f = (v: number | null | undefined, suffix?: string) =>
    v != null ? `${v.toLocaleString()}${suffix ?? ''}` : '—';
  return (
    <div className="px-3 py-2 bg-muted/20 border-t border-border/30 space-y-1.5 text-[10px]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
        <div><span className="text-muted-foreground">30d Trades:</span> <span className="font-mono">{f(offer.merchant30dTrades)}</span></div>
        <div><span className="text-muted-foreground">30d Completion:</span> <span className="font-mono">{f(offer.merchant30dCompletion, '%')}</span></div>
        <div><span className="text-muted-foreground">Feedback:</span> <span className="font-mono">{f(offer.feedbackCount)}</span></div>
        <div><span className="text-muted-foreground">Status:</span> <span className="font-mono">{offer.onlineStatus ?? 'Unknown'}</span></div>
        <div><span className="text-muted-foreground">Avg Pay:</span> <span className="font-mono">{f(offer.avgPayMinutes, ' min')}</span></div>
        <div><span className="text-muted-foreground">Avg Release:</span> <span className="font-mono">{f(offer.avgReleaseMinutes, ' min')}</span></div>
        <div><span className="text-muted-foreground">All-time Trades:</span> <span className="font-mono">{f(offer.allTrades)}</span></div>
        <div><span className="text-muted-foreground">Type:</span> <span className="font-mono">{offer.tradeType ?? '—'}</span></div>
      </div>
      {/* Payment categories */}
      {(offer.paymentMethodCategories?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {offer.paymentMethodCategories!.map(cat => (
            <Badge key={cat} variant="secondary" className="text-[7px] px-1 py-0">{CAT_LABELS[cat] ?? cat}</Badge>
          ))}
        </div>
      )}
      {/* Advertiser message */}
      <div className="mt-1">
        <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Advertiser Message</div>
        <div className="text-[10px] leading-relaxed whitespace-pre-wrap break-words rounded bg-muted/30 px-2 py-1.5 max-h-20 overflow-y-auto" dir="auto">
          {offer.advertiserMessage || 'Unavailable'}
        </div>
      </div>
    </div>
  );
}

export function P2POfferTable({ offers, type, t }: Props) {
  const isSell = type === 'sell';
  const maxAvailable = Math.max(...(offers.map(o => o.available) || [1]));
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

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
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold w-5"></TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pTrader')}</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pPrice')}</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pMin')}</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pMax')}</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pMethods')}</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">30d</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offers.map((o, i) => {
              const depthPct = maxAvailable > 0 ? Math.min(100, (o.available / maxAvailable) * 100) : 0;
              const isExpanded = expandedIdx === i;
              return (
                <TableRow key={`${type}-${i}`} className="group">
                  <TableCell className="py-1 px-1 w-5">
                    <button
                      onClick={() => setExpandedIdx(isExpanded ? null : i)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </TableCell>
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
                  <TableCell className="text-right text-[10px] py-1 font-mono">
                    <span title="30d trades">{o.merchant30dTrades != null ? o.merchant30dTrades : '—'}</span>
                    {o.merchant30dCompletion != null && (
                      <span className="text-muted-foreground ml-1" title="30d completion">
                        ({o.merchant30dCompletion.toFixed(0)}%)
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {/* Expanded detail below table - render outside table for valid HTML */}
        {expandedIdx != null && offers[expandedIdx] && (
          <ExpandedDetail offer={offers[expandedIdx]} />
        )}
      </CardContent>
    </Card>
  );
}
