import { P2POffer } from '../types';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import { MessageSquare, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  results: P2POffer[];
  amount: number;
  currency?: string;
}

interface PillProps {
  label: string;
  value: string | number;
  highlight?: boolean;
}

function StatPill({ label, value, highlight }: PillProps) {
  return (
    <div
      className={cn(
        'inline-flex flex-col items-center px-2 py-1 rounded-md border min-w-[46px] text-center',
        highlight
          ? 'bg-primary/10 border-primary/30 text-primary'
          : 'bg-muted/30 border-border/20',
      )}
    >
      <span className="text-[10px] font-black leading-tight tabular-nums">{value}</span>
      <span className="text-[7.5px] font-bold uppercase tracking-widest text-muted-foreground/60 mt-0.5 leading-none">
        {label}
      </span>
    </div>
  );
}

export function DeepScanResults({ results, amount, currency = 'LOCAL' }: Props) {
  if (results.length === 0) {
    return (
      <div className="p-12 text-center border-2 border-dashed border-border/40 rounded-xl bg-muted/10">
        <AlertTriangle className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm font-bold text-muted-foreground/50">No Merchants Match Criteria</p>
        <p className="text-[10px] text-muted-foreground/40 mt-1 uppercase tracking-widest">
          Try a lower amount or disable single merchant filter
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/20">
      {results.map((m, i) => (
        <div
          key={`scan-${i}-${m.nick}`}
          className="hover:bg-muted/10 transition-colors"
        >
          {/* ── Primary row: rank / nick / methods / price / available / max ── */}
          <div className="flex flex-wrap items-start gap-x-5 gap-y-2 px-4 py-3">
            {/* Rank + Nick + Status + Methods */}
            <div className="flex items-start gap-2 min-w-0 flex-1 basis-[180px]">
              <span className="text-[9px] font-black text-muted-foreground/40 tabular-nums w-5 shrink-0 mt-0.5">
                #{i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="font-black text-[13px] tracking-tight break-all leading-tight"
                    dir="auto"
                  >
                    {m.nick}
                  </span>
                  {m.status?.toLowerCase() === 'online' && (
                    <span
                      className="h-2 w-2 rounded-full bg-green-500 shrink-0 animate-pulse"
                      title="Online"
                    />
                  )}
                  {m.status && m.status.toLowerCase() !== 'online' && (
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground/60 uppercase whitespace-nowrap">
                      {m.status}
                    </span>
                  )}
                </div>
                {m.methods.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {m.methods.map((method, mi) => (
                      <span
                        key={mi}
                        className="text-[8px] font-black uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded whitespace-nowrap"
                      >
                        {method}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Price */}
            <div className="shrink-0 text-center">
              <div className="text-[15px] font-black font-mono text-foreground leading-none">
                {fmtPrice(m.price)}
              </div>
              <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50 mt-0.5">
                PRICE
              </div>
            </div>

            {/* Available */}
            <div className="shrink-0 text-center">
              <div className="text-[14px] font-black font-mono text-foreground leading-none">
                {fmtTotal(m.available)}
              </div>
              <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50 mt-0.5">
                AVAIL USDT
              </div>
            </div>

            {/* Max limit */}
            <div className="shrink-0 text-center">
              <div className="text-[13px] font-black font-mono text-foreground/80 leading-none">
                {fmtTotal(m.max)}
              </div>
              <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50 mt-0.5">
                MAX {currency}
              </div>
            </div>
          </div>

          {/* ── Stats row ── */}
          <div className="flex flex-wrap gap-1.5 px-4 pb-3 border-t border-border/10 pt-2">
            <StatPill label="30d" value={m.trades > 0 ? m.trades : '—'} />
            <StatPill
              label="Done"
              value={m.completion > 0 ? `${Math.round(m.completion * 100)}%` : '—'}
              highlight={m.completion >= 0.97}
            />
            <StatPill
              label="Feedback"
              value={m.feedback != null ? `${Math.round(m.feedback * 100)}%` : '—'}
              highlight={m.feedback != null && m.feedback >= 0.97}
            />
            <StatPill label="Pay" value={m.avgPay != null ? `${m.avgPay}m` : '—'} />
            <StatPill label="Release" value={m.avgRelease != null ? `${m.avgRelease}m` : '—'} />
            <StatPill
              label="All-time"
              value={m.allTimeTrades != null ? fmtTotal(m.allTimeTrades) : '—'}
            />
            <StatPill label="Type" value={m.tradeType ?? '—'} />
          </div>

          {/* ── Advertiser message ── */}
          {m.message && (
            <div className="mx-4 mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-muted/20 border border-border/20">
              <MessageSquare className="h-3.5 w-3.5 text-primary/40 mt-0.5 shrink-0" />
              <div
                className="text-[11px] text-muted-foreground/80 leading-relaxed whitespace-pre-wrap font-medium break-words min-w-0 flex-1"
                dir="auto"
              >
                {m.message}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
