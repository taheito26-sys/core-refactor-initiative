import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Check, CheckCheck, Shield, Eye, Clock, Phone, Video } from 'lucide-react';
import { BusinessObjectCard } from './BusinessObjectCard';

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
  isEphemeral?: boolean;
}

export function MessageItem({ message, currentUserId, isEphemeral }: MessageProps) {
  const isMe = message.sender_id === currentUserId;
  const isSystem = message.type === 'system';
  
  if (isSystem) {
    return (
      <div className="flex justify-center my-3 relative">
        <span className="bg-slate-900/5 text-slate-500 text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-[0.2em] border border-slate-200/50 backdrop-blur-sm">
          {message.content}
        </span>
      </div>
    );
  }

  const isOneTime = !!message.expires_at && !message.metadata?.timer;

  return (
    <div className={cn("flex w-full mb-4 px-6 group/msg", isMe ? "justify-end" : "justify-start")}>
      <div className={cn("flex flex-col max-w-[80%]", isMe ? "items-end" : "items-start")}>
        
        <div className="flex items-center gap-2 mb-1.5 px-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-300">
           {!isMe && <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">zakaria</span>}
           <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">{format(new Date(message.created_at), 'HH:mm')}</span>
        </div>

        <div className="relative flex items-end gap-2 text-wrap break-all">
          {!isMe && <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-400 border border-slate-200">Z</div>}
          
          <div
            className={cn(
              "px-4 py-3 rounded-[20px] text-[12.5px] leading-[1.6] shadow-sm transition-all border relative overflow-hidden",
              isMe 
                ? "bg-violet-600 text-white rounded-br-none border-violet-500 shadow-violet-200/50" 
                : "bg-white text-slate-800 rounded-bl-none border-slate-100 shadow-slate-100"
            )}
          >
            {message.type === 'business_object' && message.metadata?.object_type ? (
              <div className="scale-95 origin-top-left -mx-1">
                <BusinessObjectCard 
                  obj={{ id: message.metadata.object_id, object_type: message.metadata.object_type, payload: message.metadata.object_data || {}, status: 'pending', room_id: '', created_by_merchant_id: '', state_snapshot_hash: null, created_at: '', updated_at: '' }}
                />
              </div>
            ) : (
              <p className="font-medium tracking-tight whitespace-pre-wrap">
                {message.content}
              </p>
            )}

            {isOneTime && (
               <div className="absolute top-0 right-0 p-1.5 bg-white/10 rounded-bl-xl backdrop-blur-md border-l border-b border-white/20">
                  <Eye size={10} className="text-white" />
               </div>
            )}
          </div>

          {isMe && (
            <div className="flex flex-col items-center gap-1.5 opacity-40 group-hover/msg:opacity-100 transition-opacity">
               {message.status === 'read' ? <CheckCheck size={12} className="text-violet-500" /> : <Check size={12} className="text-slate-300" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
