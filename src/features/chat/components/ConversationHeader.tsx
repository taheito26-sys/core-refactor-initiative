import { 
  Phone, 
  Video, 
  Search, 
  ShieldCheck,
  Zap,
  MoreHorizontal
} from 'lucide-react';

interface Props {
  title?: string;
  name?: string;
  nickname?: string;
  onSummarize?: () => void;
  onSearchToggle?: () => void;
  onDashboardToggle?: () => void;
  onCallVoice?: () => void;
  onCallVideo?: () => void;
  onBack?: () => void;
  showDashboard?: boolean;
}

export function ConversationHeader({
  title,
  name,
  nickname,
  onSummarize,
  onSearchToggle,
  onDashboardToggle,
  onCallVoice,
  onCallVideo,
  showDashboard,
}: Props) {
  const displayTitle = title || name || 'Conversation';

  return (
    <header className="h-[54px] border-b border-border flex items-center justify-between px-6 bg-background/80 backdrop-blur-md shrink-0 relative z-30">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="relative">
           <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground text-[13px] font-black shadow-lg shadow-primary/20">
             {displayTitle.charAt(0).toUpperCase()}
           </div>
           <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-background rounded-full shadow-sm" />
        </div>
        <div className="flex flex-col min-w-0">
          <h2 className="text-[14px] font-black text-foreground truncate tracking-tight flex items-center gap-2">
            {displayTitle}
            <ShieldCheck size={12} className="text-primary/70" />
          </h2>
          <div className="flex items-center gap-2 overflow-hidden">
             <span className="text-[9px] text-emerald-500 font-black uppercase tracking-widest">Active Surface</span>
             <span className="text-[10px] text-border">•</span>
             <span className="text-[9px] text-muted-foreground font-bold truncate">{nickname || 'Falcon Integrated Protocol'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 bg-accent/50 p-1 rounded-xl border border-border">
        <div className="flex items-center px-1 border-r border-border mr-1">
          <button 
            onClick={onCallVoice}
            className="p-2 text-muted-foreground hover:text-primary hover:bg-background rounded-lg transition-all" 
          >
            <Phone size={15} />
          </button>
          <button 
            onClick={onCallVideo}
            className="p-2 text-muted-foreground hover:text-primary hover:bg-background rounded-lg transition-all" 
          >
            <Video size={16} />
          </button>
        </div>

        <button 
          onClick={onSearchToggle}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-background rounded-lg transition-all"
        >
          <Search size={16} />
        </button>
        
        {onSummarize && (
          <button 
            onClick={onSummarize}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg transition-all flex items-center gap-2 hover:bg-primary/90 shadow-md shadow-primary/10"
          >
            <Zap size={11} className="fill-current" />
            <span className="text-[10px] font-black uppercase tracking-widest">Pivots</span>
          </button>
        )}

        {onDashboardToggle && (
          <>
            <div className="w-px h-4 bg-border mx-1" />
            <button 
              onClick={onDashboardToggle}
              className={`p-2 rounded-lg transition-all ${
                showDashboard ? 'text-primary bg-background shadow-sm' : 'text-muted-foreground hover:bg-background'
              }`}
            >
              <MoreHorizontal size={18} />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
