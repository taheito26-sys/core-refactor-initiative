import React from 'react';
import type { P2POffer, MerchantStat, PaymentMethodCategory } from '../types';
import type { DeepScanCandidate } from '../types.deepScan';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import { User, Shield, CheckCircle, Clock, MessageSquare, Info, History, BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface Props {
  /** Render from either a DeepScanCandidate or a P2POffer / MerchantStat */
  candidate?: DeepScanCandidate;
  offer?: P2POffer;
  merchantStat?: MerchantStat;
  merchant?: P2POffer; // Support old prop name from HEAD
  compact?: boolean;
  className?: string;
}

const CATEGORY_LABELS: Record<PaymentMethodCategory, string> = {
  vodafone_cash: 'Vodafone Cash',
  instapay: 'InstaPay',
  bank: 'Bank',
  wallet: 'Wallet',
  other: 'Other',
};

export function MerchantIntelligenceCard({ candidate, offer, merchantStat, merchant, compact, className }: Props) {
  const sourceOffer = candidate?.sourceOffer ?? offer ?? merchant;
  const nick = candidate?.nick ?? sourceOffer?.nick ?? merchantStat?.nick ?? '—';
  const price = candidate?.price ?? sourceOffer?.price;
  const available = candidate?.available ?? sourceOffer?.available;
  const max = candidate?.max ?? sourceOffer?.max;
  const trades30d = candidate?.merchant30dTrades ?? sourceOffer?.merchant30dTrades ?? merchantStat?.merchant30dTrades;
  const completion30d = candidate?.merchant30dCompletion ?? sourceOffer?.merchant30dCompletion ?? merchantStat?.merchant30dCompletion;
  const feedback = candidate?.feedbackCount ?? sourceOffer?.feedbackCount ?? merchantStat?.feedbackCount ?? sourceOffer?.feedback;
  const advMsg = candidate?.advertiserMessage ?? sourceOffer?.advertiserMessage ?? merchantStat?.advertiserMessage ?? sourceOffer?.message;
  const avgRelease = sourceOffer?.avgReleaseMinutes ?? merchantStat?.avgReleaseMinutes ?? sourceOffer?.avgRelease;
  const avgPay = sourceOffer?.avgPayMinutes ?? merchantStat?.avgPayMinutes ?? sourceOffer?.avgPay;
  const allTrades = sourceOffer?.allTrades ?? merchantStat?.allTrades ?? sourceOffer?.allTimeTrades;
  const tradeType = sourceOffer?.tradeType ?? merchantStat?.tradeType;
  const status = sourceOffer?.onlineStatus ?? merchantStat?.onlineStatus ?? sourceOffer?.status;
  const methods = candidate?.methodCategories ?? sourceOffer?.paymentMethodCategories ?? merchantStat?.paymentMethodCategories ?? sourceOffer?.methods ?? [];

  const stats = [
    { label: '30d Trades', value: trades30d || 0, icon: History },
    { label: 'Completion', value: completion30d != null ? `${completion30d.toFixed(1)}%` : '—', icon: CheckCircle },
    { label: 'Feedback', value: feedback || 0, icon: Shield },
    { label: 'Status', value: status || 'Active', icon: User },
    { label: 'Avg Pay', value: `${avgPay || 0}m`, icon: Clock },
    { label: 'Avg Release', value: `${avgRelease || 0}m`, icon: Clock },
    { label: 'All-time', value: fmtTotal(allTrades || 0), icon: History },
    { label: 'Type', value: tradeType || 'Standard', icon: Info },
  ];

  return (
    <div className={cn(
      "group relative flex flex-col p-4 rounded-xl border border-border/50 bg-card/40 hover:bg-card transition-all shadow-sm",
      className
    )}>
      {/* Primary Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-black text-sm tracking-tight truncate">{nick}</span>
            {status === 'online' && (
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Online" />
            )}
            {candidate?.score != null && (
              <Badge variant="outline" className="text-[8px] font-mono px-1.5 py-0">
                Score {candidate.score.toFixed(1)}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {methods.map((m, i) => (
              <span key={i} className="text-[9px] font-black uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded">
                {typeof m === 'string' ? CATEGORY_LABELS[m as PaymentMethodCategory] ?? m : m}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-black text-foreground font-mono leading-none tracking-tighter">
            {price ? fmtPrice(price) : '—'}
          </div>
          <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mt-1">PRICE</div>
        </div>
      </div>

      {/* Primary Deal Details */}
      <div className="grid grid-cols-2 gap-3 mb-4 p-3 rounded-lg bg-muted/30 border border-border/20">
        <div>
          <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">AVAILABLE</div>
          <div className="text-sm font-black font-mono">{available ? fmtTotal(available) : '—'} <span className="text-[10px] opacity-60">USDT</span></div>
        </div>
        <div>
          <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">MAX LIMIT</div>
          <div className="text-sm font-black font-mono">{max ? fmtTotal(max) : '—'}</div>
        </div>
      </div>

      {/* Intelligence Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-4 mb-4">
        {stats.slice(0, compact ? 4 : 8).map((stat, i) => (
          <div key={i} className="flex items-center gap-2">
            <stat.icon className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] font-black leading-tight text-foreground/80 truncate">{stat.value}</div>
              <div className="text-[8px] font-bold text-muted-foreground/60 uppercase tracking-widest">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Advertiser Message */}
      {advMsg && !compact && (
        <div className="mt-auto pt-3 border-t border-border/30">
          <div className="flex items-start gap-2">
            <MessageSquare className="h-3 w-3 text-primary/40 mt-1 shrink-0" />
            <div 
              className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap font-medium max-h-24 overflow-y-auto"
              dir="auto"
            >
              {advMsg}
            </div>
          </div>
        </div>
      )}

      {candidate && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/20">
          <Badge variant={candidate.coversFullAmount ? 'default' : 'destructive'} className="text-[8px] px-1 py-0 uppercase font-black tracking-tighter">
            {candidate.coversFullAmount ? '✓ Full Coverage' : '✗ Partial'}
          </Badge>
          {candidate.rejectionReasons.length > 0 && (
            <span className="text-[9px] text-destructive truncate font-bold">{candidate.rejectionReasons[0]}</span>
          )}
        </div>
      )}
    </div>
  );
}