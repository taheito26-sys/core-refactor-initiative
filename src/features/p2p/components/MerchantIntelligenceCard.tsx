import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import type { P2POffer } from '../types';

function fmtCount(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return fmtTotal(value);
}

function fmtPct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(0)}%`;
}

function fmtMinutes(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(0)}m`;
}

interface Props {
  offer: P2POffer;
  currency: string;
  rank?: number;
}

export function MerchantIntelligenceCard({ offer, currency, rank }: Props) {
  const methodLabels = offer.methods.length ? offer.methods : ['—'];

  return (
    <Card className="border-border/60 bg-card/80">
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {typeof rank === 'number' && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">
                  #{rank}
                </Badge>
              )}
              <div className="min-w-0 text-sm font-semibold truncate">{offer.nick}</div>
              {offer.status ? (
                <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                  {offer.status}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-mono text-foreground">{fmtPrice(offer.price)} {currency}</span>
              <span>Available {fmtCount(offer.available)} USDT</span>
              <span>Max {offer.max > 0 ? fmtCount(offer.max / offer.price) : '—'} USDT</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 justify-end">
            {methodLabels.map((method, idx) => (
              <Badge key={`${method}-${idx}`} variant="outline" className="px-1.5 py-0 text-[9px]">
                {method}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
          <Metric label="30d Trades" value={fmtCount(offer.trades)} />
          <Metric label="30d Completion" value={fmtPct(offer.completion)} />
          <Metric label="Feedback" value={fmtPct(offer.feedback)} />
          <Metric label="Trade Type" value={offer.tradeType ?? '—'} />
          <Metric label="Avg Pay" value={fmtMinutes(offer.avgPay)} />
          <Metric label="Avg Release" value={fmtMinutes(offer.avgRelease)} />
          <Metric label="All-time Trades" value={fmtCount(offer.allTimeTrades)} />
        </div>

        {offer.message ? (
          <div className="rounded-md border border-border/70 bg-muted/25 px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
              Advertiser Message
            </div>
            <div className="text-[10px] leading-5 whitespace-pre-wrap break-words" dir="auto">
              {offer.message}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium break-words">{value}</div>
    </div>
  );
}
