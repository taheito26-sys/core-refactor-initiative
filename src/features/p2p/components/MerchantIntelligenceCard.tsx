import React from 'react';
import { P2POffer } from '../types';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import { User, Shield, CheckCircle, Clock, MessageSquare, Info, History } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  merchant: P2POffer;
  className?: string;
}

export function MerchantIntelligenceCard({ merchant, className }: Props) {
  const stats = [
    { label: '30d Trades', value: merchant.trades || 0, icon: History },
    { label: 'Completion', value: `${Math.round(merchant.completion * 100)}%`, icon: CheckCircle },
    { label: 'Feedback', value: `${Math.round((merchant.feedback || 0) * 100)}%`, icon: Shield },
    { label: 'Status', value: merchant.status || 'Active', icon: User },
    { label: 'Avg Pay', value: `${merchant.avgPay || 0}m`, icon: Clock },
    { label: 'Avg Release', value: `${merchant.avgRelease || 0}m`, icon: Clock },
    { label: 'All-time', value: fmtTotal(merchant.allTimeTrades || 0), icon: History },
    { label: 'Type', value: merchant.tradeType || 'Standard', icon: Info },
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
            <span className="font-black text-sm tracking-tight truncate">{merchant.nick}</span>
            {merchant.status === 'Online' && (
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Online" />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {merchant.methods.map((m, i) => (
              <span key={i} className="text-[9px] font-black uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded">
                {m}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-black text-foreground font-mono leading-none tracking-tighter">
            {fmtPrice(merchant.price)}
          </div>
          <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mt-1">PRICE</div>
        </div>
      </div>

      {/* Primary Deal Details */}
      <div className="grid grid-cols-2 gap-3 mb-4 p-3 rounded-lg bg-muted/30 border border-border/20">
        <div>
          <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">AVAILABLE</div>
          <div className="text-sm font-black font-mono">{fmtTotal(merchant.available)} <span className="text-[10px] opacity-60">USDT</span></div>
        </div>
        <div>
          <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">MAX LIMIT</div>
          <div className="text-sm font-black font-mono">{fmtTotal(merchant.max)} <span className="text-[10px] opacity-60">EGP</span></div>
        </div>
      </div>

      {/* Intelligence Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-4 mb-4">
        {stats.map((stat, i) => (
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
      {merchant.message && (
        <div className="mt-auto pt-3 border-t border-border/30">
          <div className="flex items-start gap-2">
            <MessageSquare className="h-3 w-3 text-primary/40 mt-1 shrink-0" />
            <div 
              className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap font-medium"
              dir="auto"
            >
              {merchant.message}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}