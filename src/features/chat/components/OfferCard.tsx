import { DollarSign, ArrowRight, Clock } from 'lucide-react';

interface Props {
  merchantName: string;
  merchantId?: string | null;
  type: 'buy' | 'sell';
  amount: string;
  rate: string;
  currency: string;
  paymentMethod: string;
  availability: string;
  status?: 'active' | 'filled' | 'cancelled' | 'expired';
  actionLabel?: string;
  onAction?: () => void;
}

export function OfferCard({
  merchantName,
  merchantId,
  type,
  amount,
  rate,
  currency,
  paymentMethod,
  availability,
  status = 'active',
  actionLabel,
  onAction
}: Props) {
  const isBuy = type === 'buy';
  const isActive = status === 'active';
  const defaultActionLabel = actionLabel ?? (isBuy ? 'Post Buy Offer' : 'Post Sell Offer');
  
  return (
    <div className="relative my-3 p-4 bg-card border border-border rounded-2xl shadow-sm hover:shadow-md transition-shadow max-w-[340px] space-y-3 overflow-hidden">
      {/* Privacy trace watermark on offer card */}
      <div className="absolute inset-0 pointer-events-none select-none z-0 overflow-hidden" style={{ opacity: 0.02 }}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id={`offer-wm-${merchantName}`} x="0" y="0" width="180" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
              <text x="0" y="25" fontFamily="monospace" fontSize="7" fontWeight="bold" className="fill-foreground" fill="currentColor">TRACED · P2P</text>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#offer-wm-${merchantName})`} className="text-foreground" />
        </svg>
      </div>

      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${isBuy ? 'bg-blue-500' : 'bg-orange-500'}`}>
            {merchantName.charAt(0)}
          </div>
          <div>
            <h4 className="text-sm font-black text-foreground">{merchantName}</h4>
            {merchantId && (
              <p className="text-[10px] font-mono text-muted-foreground/70">{merchantId}</p>
            )}
            <span className={`text-[10px] font-bold uppercase tracking-widest ${isBuy ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400'}`}>
              {type} Offer
            </span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-muted-foreground uppercase">Rate</span>
          <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">{rate} {currency}</p>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-2 gap-4 py-3 border-y border-border/50">
        <div>
          <span className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Vol / Amount</span>
          <p className="text-xs font-black text-foreground">{amount}</p>
        </div>
        <div>
          <span className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Method</span>
          <p className="text-xs font-bold text-foreground/80">{paymentMethod}</p>
        </div>
      </div>

      <div className="relative z-10 flex items-center justify-between text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
        <span className="flex items-center gap-1"><Clock size={12} /> {availability}</span>
        <span className={`flex items-center gap-1 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
          <DollarSign size={12} />
          {status}
        </span>
      </div>

      <button
        onClick={onAction}
        disabled={!onAction}
        className={`relative z-10 w-full py-2.5 rounded-xl text-white text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
          isBuy ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-600 hover:bg-orange-700'
        }`}
      >
        {defaultActionLabel}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
