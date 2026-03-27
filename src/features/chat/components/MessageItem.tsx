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
        <span className="bg-muted text-muted-foreground text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-[0.2em] border border-border backdrop-blur-sm">
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
           {!isMe && <span className="text-[10px] font-black text-foreground uppercase tracking-widest">zakaria</span>}
           <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-tighter">{format(new Date(message.created_at), 'HH:mm')}</span>
        </div>

        <div className="relative flex items-end gap-2 text-wrap break-all">
          {!isMe && <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center text-[10px] font-black text-muted-foreground border border-border">Z</div>}
          
          <div
            className={cn(
              "px-4 py-3 rounded-[20px] text-[12.5px] leading-[1.6] shadow-sm transition-all border relative overflow-hidden",
              isMe 
                ? "bg-primary text-primary-foreground rounded-br-none border-primary/80 shadow-primary/20" 
                : "bg-card text-card-foreground rounded-bl-none border-border shadow-muted/30"
            )}
          >
            {message.type === 'business_object' && message.metadata?.object_type ? (
              <div className="scale-95 origin-top-left -mx-1">
                <BusinessObjectCard 
                  obj={{ id: message.metadata.object_id, type: 'business_object', object_type: message.metadata.object_type as any, payload: message.metadata.object_data || {}, status: 'pending', room_id: '', created_by: '', created_at: '' }}
                />
              </div>
            ) : (
              <p className="font-medium tracking-tight whitespace-pre-wrap">
                {message.content}
              </p>
            )}

            {isOneTime && (
               <div className="absolute top-0 right-0 p-1.5 bg-background/10 rounded-bl-xl backdrop-blur-md border-l border-b border-background/20">
                  <Eye size={10} className="text-primary-foreground" />
               </div>
            )}
          </div>

          {isMe && (
            <div className="flex flex-col items-center gap-1.5 opacity-40 group-hover/msg:opacity-100 transition-opacity">
               {message.status === 'read' ? <CheckCheck size={12} className="text-primary" /> : <Check size={12} className="text-muted-foreground/50" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
