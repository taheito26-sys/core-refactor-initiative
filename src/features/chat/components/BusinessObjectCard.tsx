import { FileText, Lock, CheckCircle } from 'lucide-react';
import type { ChatBusinessObject } from '@/features/chat/lib/types';

interface Props {
  obj: ChatBusinessObject;
  onAccept?: () => void;
}

export function BusinessObjectCard({ obj, onAccept }: Props) {
  const isLocked = obj.status === 'locked';

  return (
    <div className={`mx-3 my-2 p-4 rounded-xl border flex gap-4 items-start shadow-sm transition-all ${isLocked ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white ${isLocked ? 'bg-green-500' : 'bg-indigo-500'}`}>
        {isLocked ? <Lock size={20} /> : <FileText size={20} />}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-1">
          <strong className="text-sm font-bold text-slate-900 uppercase tracking-tight">
            {obj.object_type.replace('_', ' ')}
          </strong>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase">
            {obj.status}
          </span>
        </div>
        
        <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-100 font-mono overflow-auto max-h-24 mb-2">
          {JSON.stringify(obj.payload, null, 2)}
        </div>

        {isLocked && obj.state_snapshot_hash && (
          <div className="flex items-center gap-2 text-[10px] text-green-600 font-medium">
            <CheckCircle size={12} />
            IMMUTABLE SNAPSHOT: {obj.state_snapshot_hash.substring(0, 16)}...
          </div>
        )}

        {!isLocked && obj.object_type === 'deal_offer' && (
          <div className="flex gap-2 mt-3">
            <button 
              onClick={onAccept}
              className="bg-green-600 text-white text-xs font-bold px-4 py-1.5 rounded-md hover:bg-green-700 transition"
            >
              Sign & Accept
            </button>
            <button className="text-rose-600 border border-rose-200 text-xs font-bold px-4 py-1.5 rounded-md hover:bg-rose-50 transition">
              Decline
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
