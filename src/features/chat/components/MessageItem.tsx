import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Check, CheckCheck, Shield, Eye, Lock, Zap, LayoutGrid, PlusCircle, Search, ArrowUpRight, RefreshCcw } from 'lucide-react';
import { parseMsg } from '../lib/message-codec';
import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

interface MessageProps {
  message: {
    id: string;
    content: string;
    sender_id: string;
    created_at: string;
    type?: string;
    metadata?: any;
    status?: string;
    expires_at?: string;
  };
  currentUserId: string;
}

export function MessageItem({ message, currentUserId }: MessageProps) {
  const isMe = message.sender_id === currentUserId;
  const isSystem = message.type === 'system';
  const parsed = useMemo(() => parseMsg(message.content), [message.content]);
  const navigate = useNavigate();
  
  const [showOneTime, setShowOneTime] = useState(false);
  const isOneTime = !!message.expires_at && !message.metadata?.timer;
  const isViewed = parsed.isViewed || (message.metadata?.viewed === true);

  const handleReveal = async () => {
    if (isMe || isViewed) return;
    setShowOneTime(true);
    try {
      const viewedContent = `${message.content}||VIEWED||${new Date().toISOString()}||/VIEWED||`;
      await supabase.from('os_messages').update({ content: viewedContent }).eq('id', message.id);
    } catch (e) {
      console.error('Failed to mark as viewed:', e);
    }
  };

  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <span className="bg-muted/50 text-muted-foreground text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] border border-border/50">
          {parsed.text || message.content}
        </span>
      </div>
    );
  }

  if (parsed.isAiSummary) {
    return (
      <div className="mx-6 my-4 p-4 rounded-2xl bg-violet-50/50 border border-violet-100 shadow-sm">
        <div className="flex items-center gap-2 mb-2 text-violet-600">
          <Zap size={14} className="fill-current" />
          <span className="text-[10px] font-black uppercase tracking-widest">AI Protocol Summary</span>
        </div>
        <p className="text-[13px] text-slate-700 leading-relaxed italic">
          {parsed.text}
        </p>
      </div>
    );
  }

  if (parsed.isAppOutput) {
    return (
      <div className="mx-6 my-4 p-4 rounded-2xl bg-slate-900 text-white border border-slate-800 shadow-xl">
        <div className="flex items-center gap-2 mb-3 text-slate-400">
          <LayoutGrid size={14} />
          <span className="text-[10px] font-black uppercase tracking-widest">{parsed.appName || 'MiniApp'} Output</span>
        </div>
        <div className="font-mono text-[12px] bg-black/40 p-3 rounded-lg border border-white/5">
          {parsed.text}
        </div>
      </div>
    );
  }

  if (parsed.isAction) {
    const action = parsed.actionType;
    return (
      <div className={cn("flex w-full mb-4 px-4", isMe ? "justify-end" : "justify-start")}>
        <div className={cn("flex flex-col max-w-[85%] md:max-w-[70%]", isMe ? "items-end" : "items-start")}>
          <div className="bg-card border border-border rounded-[22px] p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              <Zap size={12} className="text-primary" />
              Protocol Action Required
            </div>
            {action === 'create_order' && (
              <button 
                onClick={() => navigate('/trading/orders?new=true')}
                className="flex items-center gap-3 w-full px-4 py-3 bg-primary text-primary-foreground rounded-xl shadow-lg shadow-primary/10 hover:scale-[1.02] transition-all active:scale-95"
              >
                <PlusCircle size={16} />
                <span className="text-[11px] font-black uppercase tracking-widest">Create New Order</span>
              </button>
            )}
            {action === 'check_stock' && (
              <button 
                onClick={() => navigate('/trading/stock')}
                className="flex items-center gap-3 w-full px-4 py-3 bg-accent text-accent-foreground rounded-xl shadow-sm hover:scale-[1.02] transition-all active:scale-95"
              >
                <Search size={16} />
                <span className="text-[11px] font-black uppercase tracking-widest">Check Inventory</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full mb-4 px-4 group/msg", isMe ? "justify-end" : "justify-start")}>
      <div className={cn("flex flex-col max-w-[85%] md:max-w-[70%]", isMe ? "items-end" : "items-start")}>
        
        <div className="flex items-center gap-2 mb-1 px-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
           <span className="text-[8px] font-black text-muted-foreground uppercase tracking-tighter">
             {format(new Date(message.created_at), 'HH:mm')}
           </span>
        </div>

        <div className="relative flex items-end gap-2">
          <div
            className={cn(
              "px-4 py-3 rounded-[22px] text-[13px] leading-relaxed shadow-sm border relative overflow-hidden transition-all",
              isMe
                ? "bg-primary text-primary-foreground rounded-br-none border-primary/50"
                : "bg-card text-card-foreground rounded-bl-none border-border"
            )}
          >
            {isOneTime && isViewed && !isMe ? (
              <div className="flex items-center gap-2 py-1 opacity-50 italic text-[11px]">
                <Lock size={12} /> Message viewed and locked
              </div>
            ) : isOneTime && !showOneTime && !isMe && !isViewed ? (
              <button
                onClick={handleReveal}
                className="flex items-center gap-2 py-1 px-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-all border-none cursor-pointer"
              >
                <Shield size={14} className="text-primary" />
                <span className="font-bold text-[11px] text-primary uppercase tracking-widest">Reveal One-Time View</span>
              </button>
            ) : (
              <div className="whitespace-pre-wrap break-words">
                {parsed.text || message.content}
              </div>
            )}

            {isOneTime && !isViewed && (
               <div className="absolute top-0 right-0 p-1 bg-background/10 rounded-bl-lg backdrop-blur-md">
                  <Eye size={10} className={isMe ? "text-primary-foreground" : "text-primary"} />
               </div>
            )}
          </div>

          {isMe && (
            <div className="flex flex-col items-center opacity-40 group-hover/msg:opacity-100 transition-opacity">
               {message.status === 'read' ? <CheckCheck size={12} className="text-primary" /> : <Check size={12} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}