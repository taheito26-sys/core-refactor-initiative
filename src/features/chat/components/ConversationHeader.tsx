import { 
  Phone, 
  Video, 
  Users, 
  Search, 
  RotateCw, 
  MoreVertical,
  ShieldCheck,
  Zap,
  MoreHorizontal
} from 'lucide-react';

interface Props {
  title: string;
  onSummarize: () => void;
  onSearchToggle: () => void;
  onDashboardToggle: () => void;
  onCallVoice: () => void;
  onCallVideo: () => void;
  showDashboard: boolean;
}

export function ConversationHeader({
  title,
  onSummarize,
  onSearchToggle,
  onDashboardToggle,
  onCallVoice,
  onCallVideo,
  showDashboard,
}: Props) {
  return (
    <header className="h-[54px] border-b border-slate-100 flex items-center justify-between px-6 bg-white/80 backdrop-blur-md shrink-0 relative z-30">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="relative">
           <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center text-white text-[13px] font-black shadow-lg shadow-violet-200">
             {title.charAt(0).toUpperCase()}
           </div>
           <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full shadow-sm" />
        </div>
        <div className="flex flex-col min-w-0">
          <h2 className="text-[14px] font-black text-slate-900 truncate tracking-tight flex items-center gap-2">
            {title}
            <ShieldCheck size={12} className="text-blue-500 opacity-80" />
          </h2>
          <div className="flex items-center gap-2 overflow-hidden">
             <span className="text-[9px] text-emerald-600 font-black uppercase tracking-widest">Active Surface</span>
             <span className="text-[10px] text-slate-200">•</span>
             <span className="text-[9px] text-slate-400 font-bold truncate">Falcon Integrated Protocol</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 bg-slate-50/50 p-1 rounded-xl border border-slate-100">
        <div className="flex items-center px-1 border-r border-slate-200 mr-1">
          <button 
            onClick={onCallVoice}
            className="p-2 text-slate-400 hover:text-violet-600 hover:bg-white rounded-lg transition-all" 
            title="Start Voice Call"
          >
            <Phone size={15} />
          </button>
          <button 
            onClick={onCallVideo}
            className="p-2 text-slate-400 hover:text-violet-600 hover:bg-white rounded-lg transition-all" 
            title="Start Video Call"
          >
            <Video size={16} />
          </button>
        </div>

        <button 
          onClick={onSearchToggle}
          className="p-2 text-slate-400 hover:text-slate-900 hover:bg-white rounded-lg transition-all"
        >
          <Search size={16} />
        </button>
        
        <button 
          onClick={onSummarize}
          className="px-3 py-1.5 bg-violet-600 text-white rounded-lg transition-all flex items-center gap-2 hover:bg-violet-700 shadow-md shadow-violet-100"
        >
          <Zap size={11} className="fill-white" />
          <span className="text-[10px] font-black uppercase tracking-widest">Pivots</span>
        </button>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        <button 
          onClick={onDashboardToggle}
          className={`p-2 rounded-lg transition-all ${
            showDashboard ? 'text-violet-600 bg-white shadow-sm' : 'text-slate-400 hover:bg-white'
          }`}
          title="Toggle Command Center"
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </header>
  );
}
