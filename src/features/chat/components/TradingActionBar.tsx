import { 
  PlusCircle, 
  Search, 
  ArrowUpRight, 
  RefreshCcw,
  ChevronDown
} from 'lucide-react';

interface Props {
  onCreateOrder?: () => void;
  onCheckStock?: () => void;
  onPaymentRequest?: () => void;
  onOffsetRequest?: () => void;
}

export function TradingActionBar({ 
  onCreateOrder, 
  onCheckStock, 
  onPaymentRequest, 
  onOffsetRequest 
}: Props) {
  return (
    <div className="flex flex-col gap-2 w-full px-2 py-4 animate-in fade-in duration-500">
      <button 
        onClick={onCreateOrder}
        className="flex items-center justify-between w-full px-4 py-3 bg-[#F97316] text-white rounded-xl shadow-lg shadow-orange-500/10 hover:shadow-orange-500/20 transition-all active:scale-95 group"
      >
        <span className="text-[10px] font-black uppercase tracking-[0.2em]">Create Order</span>
        <ChevronDown size={12} className="opacity-50" />
      </button>

      <button 
        onClick={onCheckStock}
        className="flex items-center gap-3 w-full px-4 py-3 bg-[#0EA5E9] text-white rounded-xl shadow-lg shadow-sky-500/10 hover:shadow-sky-500/20 transition-all active:scale-95"
      >
        <Search size={14} />
        <span className="text-[10px] font-black uppercase tracking-[0.2em]">Check Stock</span>
      </button>

      <button 
        onClick={onPaymentRequest}
        className="flex items-center gap-3 w-full px-4 py-3 bg-[#10B981] text-white rounded-xl shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all active:scale-95 group"
      >
        <ArrowUpRight size={14} />
        <span className="text-[10px] font-black uppercase tracking-[0.2em]">Request Payment</span>
      </button>

      <button 
        onClick={onOffsetRequest}
        className="flex items-center gap-3 w-full px-4 py-3 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200 transition-all active:scale-95 mt-2"
      >
        <RefreshCcw size={14} />
        <span className="text-[10px] font-black uppercase tracking-[0.1em]">Offset Trade</span>
      </button>
    </div>
  );
}
