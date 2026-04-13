import { FileText, Lock, CheckCircle, ChevronRight, Hash } from 'lucide-react';
import type { ChatBusinessObject } from '@/features/chat/lib/types';

interface Props {
  obj: ChatBusinessObject;
  onAccept?: () => void;
}

export function BusinessObjectCard({ obj, onAccept }: Props) {
  const isLocked = obj.status === 'locked';
  const typeLabel = (obj.object_type || 'OBJECT').replace('_', ' ').toUpperCase();

  return (
    <div className={`mx-6 my-4 p-6 rounded-[28px] border transition-all duration-300 flex flex-col gap-4 group ${
      isLocked 
        ? 'bg-slate-50 border-slate-100 shadow-sm' 
        : 'bg-white border-violet-100 shadow-[0_10px_30px_rgba(124,58,237,0.03)] hover:shadow-xl hover:shadow-violet-100/20'
    }`}>
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-[18px] flex items-center justify-center shadow-lg ${
            isLocked ? 'bg-slate-200 text-slate-500 shadow-slate-200/20' : 'bg-violet-600 text-white shadow-violet-500/20'
          }`}>
            {isLocked ? <Lock size={20} /> : <FileText size={20} />}
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{typeLabel}</span>
            <h4 className="text-[14px] font-black text-slate-900 tracking-tight">
              {(obj.status as string) === 'draft' ? 'Draft Protocol' : 'Active Agreement'}
            </h4>
          </div>
        </div>
        <div className={`px-3 py-1 rounded-[10px] text-[10px] font-black uppercase tracking-widest ${
          isLocked ? 'bg-slate-200 text-slate-600' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
        }`}>
          {obj.status}
        </div>
      </div>

      <div className="px-5 py-4 bg-[#F8FAFC]/50 rounded-[20px] border border-slate-50">
        <div className="flex items-center gap-2 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-white/50 pb-2">
           <Hash size={12} /> Payload Signature
        </div>
        <div className="text-[13px] font-mono text-slate-600 leading-relaxed break-all">
          {typeof obj.payload === 'object' 
            ? JSON.stringify(obj.payload).substring(0, 120) + '...'
            : obj.payload}
        </div>
      </div>

      {isLocked && obj.state_snapshot_hash && (
        <div className="flex items-center gap-3 text-[11px] font-bold text-emerald-600 bg-emerald-50/50 p-3 rounded-xl border border-emerald-100 animate-in fade-in duration-500">
           <CheckCircle size={14} />
           <span className="font-mono opacity-80">VERIFIED SNAPSHOT: {obj.state_snapshot_hash.substring(0, 8)}</span>
        </div>
      )}

      {!isLocked && obj.object_type === 'deal_offer' && (
        <div className="flex gap-3 mt-1">
          <button 
            onClick={onAccept}
            className="flex-1 bg-violet-600 text-white text-[11px] font-black uppercase tracking-widest py-3.5 rounded-[16px] shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            Sign & Accept <ChevronRight size={14} />
          </button>
          <button className="flex-1 text-rose-600 border border-rose-100 text-[11px] font-black uppercase tracking-widest py-3.5 rounded-[16px] hover:bg-rose-50 transition-all">
            Decline
          </button>
        </div>
      )}
    </div>
  );
}