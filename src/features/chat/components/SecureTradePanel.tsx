import { Shield, Clock, Hash, MapPin } from 'lucide-react';

interface Props {
  tradeId?: string;
  orderId?: string;
  buyer: string;
  amount: string;
  rate: string;
  total: string;
  expiresIn: string;
  onSettle?: () => void;
  onCancel?: () => void;
}

export function SecureTradePanel({ 
  tradeId, 
  orderId, 
  buyer, 
  amount, 
  rate, 
  total, 
  expiresIn,
  onSettle,
  onCancel 
}: Props) {
  return (
    <div className="mx-2 my-1 p-3 bg-white border border-slate-100 rounded-xl shadow-sm relative overflow-hidden group">
      <div className="flex items-start justify-between mb-3 border-b border-slate-50 pb-2">
        <div className="flex items-center gap-2">
           <div className="p-1.5 bg-violet-600 rounded-lg text-white shadow-lg shadow-violet-500/10">
              <Shield size={12} />
           </div>
           <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-900 uppercase tracking-tight">Trade {orderId || tradeId}</span>
              <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">Falcon Protocol Engaged</span>
           </div>
        </div>
        <div className="flex items-center gap-1.5 text-rose-500 bg-rose-50/50 px-2.5 py-1 rounded-lg border border-rose-100/50 scale-95 origin-right">
          <Clock size={11} className="animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-widest">{expiresIn}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 items-center">
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Buyer</span>
            <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight truncate">{buyer}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400 font-mono text-[8.5px]">
             <span className="flex items-center gap-1"><Hash size={9} /> MQ6741X</span>
             <span className="flex items-center gap-1"><MapPin size={9} /> 192.168.X.X</span>
          </div>
        </div>
        
        <div className="bg-slate-50/50 p-3 rounded-lg flex flex-col gap-1 border border-slate-50">
           <div className="flex justify-between items-baseline">
              <span className="text-[8px] font-black text-slate-400 uppercase">Rate</span>
              <span className="text-[11px] font-black text-emerald-600 font-mono tracking-tight">{rate} AED</span>
           </div>
           <div className="pt-1.5 border-t border-slate-100 flex justify-between items-baseline">
              <span className="text-[9px] font-black text-slate-900 uppercase">Total</span>
              <span className="text-sm font-black text-slate-900 font-mono -tracking-tighter">{total} AED</span>
           </div>
        </div>
      </div>

      <div className="flex gap-2 mt-3 scale-95 origin-bottom">
         <button 
           onClick={onCancel}
           className="flex-1 py-2 rounded-lg border border-orange-200 bg-white text-orange-600 text-[9px] font-black uppercase tracking-widest hover:bg-orange-50 transition-all"
         >
           Cancel
         </button>
         <button 
           onClick={onSettle}
           className="flex-[1.5] py-2.5 rounded-lg bg-[#0F172A] text-white text-[9px] font-black uppercase tracking-widest hover:bg-violet-600 shadow-md transition-all flex items-center justify-center gap-2"
         >
           Settle Protocol
         </button>
      </div>
    </div>
  );
}
