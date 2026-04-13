import type { P2POffer, MerchantStat, PaymentMethodCategory } from '../types';
import type { DeepScanCandidate } from '../types.deepScan';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import { Badge } from '@/components/ui/badge';

interface Props {
  /** Render from either a DeepScanCandidate or a P2POffer / MerchantStat */
  candidate?: DeepScanCandidate;
  offer?: P2POffer;
  merchantStat?: MerchantStat;
  compact?: boolean;
}

const CATEGORY_LABELS: Record<PaymentMethodCategory, string> = {
  vodafone_cash: 'Vodafone Cash',
  instapay: 'InstaPay',
  bank: 'Bank',
  wallet: 'Wallet',
  other: 'Other',
};

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 text-[10px]">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono text-right">{value}</span>
    </div>
  );
}

export function MerchantIntelligenceCard({ candidate, offer, merchantStat, compact }: Props) {
  const sourceOffer = candidate?.sourceOffer ?? offer;
  const nick = candidate?.nick ?? offer?.nick ?? merchantStat?.nick ?? '—';
  const price = candidate?.price ?? sourceOffer?.price;
  const available = candidate?.available ?? sourceOffer?.available;
  const max = candidate?.max ?? sourceOffer?.max;
  const trades30d = candidate?.merchant30dTrades ?? sourceOffer?.merchant30dTrades ?? merchantStat?.merchant30dTrades;
  const completion30d = candidate?.merchant30dCompletion ?? sourceOffer?.merchant30dCompletion ?? merchantStat?.merchant30dCompletion;
  const feedback = candidate?.feedbackCount ?? sourceOffer?.feedbackCount ?? merchantStat?.feedbackCount;
  const advMsg = candidate?.advertiserMessage ?? sourceOffer?.advertiserMessage ?? merchantStat?.advertiserMessage;
  const avgRelease = sourceOffer?.avgReleaseMinutes ?? merchantStat?.avgReleaseMinutes;
  const avgPay = sourceOffer?.avgPayMinutes ?? merchantStat?.avgPayMinutes;
  const allTrades = sourceOffer?.allTrades ?? merchantStat?.allTrades;
  const tradeType = sourceOffer?.tradeType ?? merchantStat?.tradeType;
  const status = sourceOffer?.onlineStatus ?? merchantStat?.onlineStatus;
  const methods = candidate?.methodCategories ?? sourceOffer?.paymentMethodCategories ?? merchantStat?.paymentMethodCategories ?? [];

  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1.5" style={{ background: 'var(--panel2, hsl(var(--card)))' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full shrink-0 ${status === 'online' ? 'bg-green-400' : status === 'offline' ? 'bg-red-400' : 'bg-muted-foreground/40'}`} />
          <span className="text-[11px] font-bold truncate max-w-[140px]">{nick}</span>
        </div>
        {candidate?.score != null && (
          <Badge variant="outline" className="text-[8px] font-mono px-1.5 py-0">
            Score {candidate.score.toFixed(1)}
          </Badge>
        )}
      </div>

      {/* Method tags */}
      {methods.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {methods.map(cat => (
            <Badge key={cat} variant="secondary" className="text-[8px] px-1 py-0">{CATEGORY_LABELS[cat] ?? cat}</Badge>
          ))}
        </div>
      )}

      {/* Fields */}
      {price != null && <FieldRow label="Price" value={fmtPrice(price)} />}
      {available != null && <FieldRow label="Available" value={fmtTotal(available)} />}
      {max != null && max > 0 && <FieldRow label="Max" value={fmtTotal(max)} />}
      <FieldRow label="30d Trades" value={trades30d != null ? trades30d.toLocaleString() : '—'} />
      <FieldRow label="30d Completion" value={completion30d != null ? `${completion30d.toFixed(1)}%` : '—'} />
      <FieldRow label="Feedback" value={feedback != null ? feedback.toLocaleString() : '—'} />
      {!compact && (
        <>
          <FieldRow label="Avg Release" value={avgRelease != null ? `${avgRelease.toFixed(1)} min` : '—'} />
          <FieldRow label="Avg Pay" value={avgPay != null ? `${avgPay.toFixed(1)} min` : '—'} />
          <FieldRow label="All-time Trades" value={allTrades != null ? allTrades.toLocaleString() : '—'} />
          <FieldRow label="Trade Type" value={tradeType ?? '—'} />
          <FieldRow label="Status" value={status ?? 'Unknown'} />
        </>
      )}

      {/* Advertiser message */}
      {!compact && (
        <div className="mt-1">
          <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Advertiser Message</div>
          <div className="text-[10px] leading-relaxed whitespace-pre-wrap break-words rounded bg-muted/30 px-2 py-1.5 max-h-24 overflow-y-auto" dir="auto">
            {advMsg || 'Unavailable'}
          </div>
        </div>
      )}

      {/* Coverage / rejection for candidates */}
      {candidate && (
        <div className="flex items-center gap-1 mt-1">
          <Badge variant={candidate.coversFullAmount ? 'default' : 'destructive'} className="text-[8px] px-1 py-0">
            {candidate.coversFullAmount ? '✓ Full Coverage' : '✗ Partial'}
          </Badge>
          {candidate.rejectionReasons.length > 0 && (
            <span className="text-[8px] text-destructive truncate">{candidate.rejectionReasons[0]}</span>
          )}
        </div>
      )}
    </div>
  );
}
