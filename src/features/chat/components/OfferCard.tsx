import { DollarSign, ArrowRight, ShoppingCart, Clock } from 'lucide-react';

interface Props {
  merchantName: string;
  type: 'buy' | 'sell';
  amount: string;
  rate: string;
  currency: string;
  paymentMethod: string;
  availability: string;
  onAction?: () => void;
}

export function OfferCard({
  merchantName,
  type,
  amount,
  rate,
  currency,
  paymentMethod,
  availability,
  onAction
}: Props) {
  const isBuy = type === 'buy';
  
  return (
    <div className="my-3 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow max-w-[340px] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${isBuy ? 'bg-blue-500' : 'bg-orange-500'}`}>
            {merchantName.charAt(0)}
          </div>
          <div>
            <h4 className="text-sm font-black text-slate-900">{merchantName}</h4>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${isBuy ? 'text-blue-600' : 'text-orange-600'}`}>
              {type} Offer
            </span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Rate</span>
          <p className="text-sm font-black text-emerald-600">{rate} {currency}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 py-3 border-y border-slate-50">
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Vol / Amount</span>
          <p className="text-xs font-black text-slate-800">{amount}</p>
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Method</span>
          <p className="text-xs font-bold text-slate-700">{paymentMethod}</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider">
        <span className="flex items-center gap-1"><Clock size={12} /> {availability}</span>
        <span className="flex items-center gap-1 text-emerald-600"><DollarSign size={12} /> Active</span>
      </div>

      <button
        onClick={onAction}
        className={`w-full py-2.5 rounded-xl text-white text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
          isBuy ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-600 hover:bg-orange-700'
        }`}
      >
        {isBuy ? 'Send Payment' : 'Create Order'}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
