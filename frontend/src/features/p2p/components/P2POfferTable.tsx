import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { fmtPrice } from '@/lib/tracker-helpers';
import type { P2POffer } from '../types';

function fmt(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '∞';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function effectiveMax(o: P2POffer): number {
  const fiat = o.available * o.price;
  return o.max > 0 && o.max < fiat ? o.max : fiat;
}

function simplify(m: string): string {
  const l = m.toLowerCase();
  if (l.includes('vcash') || l.includes('vodafone')) return 'VCash';
  if (l.includes('instapay') || l.includes('insta pay')) return 'Insta';
  if (l.includes('bank') || l.includes('transfer') || l.includes('iban')) return 'Bank';
  if (l.includes('cash')) return 'Cash';
  return m.length > 8 ? `${m.slice(0, 7)}…` : m;
}

function dedupe(methods: string[]): string[] {
  return [...new Set(methods.map(simplify))];
}

interface Props {
  offers: P2POffer[];
  side: 'sell' | 'buy';
  currency: string;
}

export default function P2POfferTable({ offers, side, currency: _currency }: Props) {
  const isSell     = side === 'sell';
  const accentColor = isSell ? 'hsl(142 76% 36%)' : 'hsl(var(--destructive))';
  const maxAvail   = Math.max(...(offers.map(o => o.available)), 1);
  const hasExtra   = offers.some(
    o => o.feedback != null || o.avgPay != null || o.allTimeTrades != null,
  );

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-1 pt-2.5 px-3">
        <div className="flex items-center justify-between">
          <CardTitle
            className="text-[11px] font-semibold flex items-center gap-1.5"
            style={{ color: accentColor }}
          >
            {isSell ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {isSell ? 'Sell Offers' : 'Restock Offers'}
          </CardTitle>
          <Badge
            variant={isSell ? 'default' : 'destructive'}
            className="text-[8px] px-1.5 py-0.5"
            style={
              isSell
                ? { background: 'hsl(142 76% 36% / 0.15)', color: 'hsl(142 76% 36%)' }
                : {}
            }
          >
            {isSell ? 'Highest first' : 'Cheapest first'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold">Trader</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold">Price</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">Min</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">Max</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold">Methods</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">30d</TableHead>
              <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-center">✓%</TableHead>
              {hasExtra && (
                <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">+</TableHead>
              )}
            </TableRow>
          </TableHeader>

          <TableBody>
            {offers.map((o, i) => {
              const depthPct =
                maxAvail > 0
                  ? Math.min(100, (o.available / maxAvail) * 100)
                  : 0;
              return (
                <TableRow key={`${side}-${i}`} className="h-7">
                  {/* Trader */}
                  <TableCell className="text-[11px] font-medium whitespace-nowrap py-1">
                    {i === 0 && (
                      <span className="text-yellow-500 mr-0.5">★</span>
                    )}
                    {o.nick}
                    {o.status === 'merchant' && (
                      <span className="ml-1 text-[8px] opacity-60">PRO</span>
                    )}
                  </TableCell>

                  {/* Price + depth bar */}
                  <TableCell className="py-1">
                    <div className="flex items-center gap-1">
                      <span
                        className="font-bold font-mono text-[11px]"
                        style={{ color: accentColor }}
                      >
                        {fmtPrice(o.price)}
                      </span>
                      <div className="w-10 h-1 rounded bg-muted overflow-hidden">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${depthPct}%`,
                            background: accentColor,
                          }}
                        />
                      </div>
                    </div>
                  </TableCell>

                  {/* Min */}
                  <TableCell className="text-right font-mono text-[11px] py-1">
                    {o.min > 0 ? o.min.toLocaleString() : '—'}
                  </TableCell>

                  {/* Max */}
                  <TableCell className="text-right font-mono text-[11px] py-1">
                    {fmt(effectiveMax(o))}
                  </TableCell>

                  {/* Methods */}
                  <TableCell className="text-[10px] text-muted-foreground py-1">
                    {dedupe(o.methods).join(' ')}
                  </TableCell>

                  {/* 30d trades */}
                  <TableCell className="text-right font-mono text-[10px] text-muted-foreground py-1">
                    {o.trades > 0 ? o.trades.toLocaleString() : '—'}
                  </TableCell>

                  {/* Completion */}
                  <TableCell
                    className="text-center font-mono text-[10px] py-1"
                    style={{
                      color: o.completion >= 0.9 ? 'var(--good)' : undefined,
                    }}
                  >
                    {o.completion > 0
                      ? `${(o.completion * 100).toFixed(0)}%`
                      : '—'}
                  </TableCell>

                  {/* Extended info */}
                  {hasExtra && (
                    <TableCell className="text-right py-1">
                      <div
                        style={{
                          fontSize: 9,
                          opacity: 0.65,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: 1,
                        }}
                      >
                        {o.feedback != null && (
                          <span>👍{(o.feedback * 100).toFixed(0)}%</span>
                        )}
                        {o.avgPay != null && <span>⏱{o.avgPay}m</span>}
                        {o.allTimeTrades != null && (
                          <span>∞{o.allTimeTrades.toLocaleString()}</span>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}

            {!offers.length && (
              <TableRow>
                <TableCell
                  colSpan={hasExtra ? 8 : 7}
                  className="text-center text-muted-foreground py-6 text-[10px]"
                >
                  {isSell ? 'No sell offers' : 'No restock offers'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
