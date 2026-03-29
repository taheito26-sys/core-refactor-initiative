import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { 
  Play, 
  Pause, 
  MapPin, 
  Eye, 
  Lock, 
  Clock, 
  PhoneCall, 
  PhoneOff, 
  CheckCheck,
  MoreVertical,
  Reply,
  Square,
  ExternalLink,
  Shield
} from 'lucide-react';
import { decodeMessage, decodeVoice, decodeSystemEvent } from '../lib/message-codec';
import { useMemo, useState, useRef, useEffect } from 'react';
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
    message_type?: string;
    body?: string;
    location_lat?: number;
    location_lng?: number;
    location_label?: string;
  };
  currentUserId: string;
  isEphemeral?: boolean;
  onReact?: (emoji: string, remove?: boolean) => void;
  onPinToggle?: () => void;
  onMarkRead?: (id: string) => void;
  onDeleteForMe?: () => void;
  onDeleteForEveryone?: () => void;
  onCreateOrder?: () => void;
  onCreateTask?: () => void;
  onReply?: (m: any) => void;
  isHighlighted?: boolean;
}

export function MessageItem({
  message,
  currentUserId,
  onMarkRead,
  onReply,
  onCreateOrder,
  onCreateTask,
  onPinToggle,
  isHighlighted = false
}: MessageProps) {
  const isMe = message.sender_id === currentUserId;
  const [isRevealed, setIsRevealed] = useState(!message.metadata?.view_once || !!message.metadata?.viewed_at);
  const [timeLeft, setTimeLeft] = useState<string | null>(null);
  
  // Audio state
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const body = message.content || message.body || '';
  const decoded = useMemo(() => decodeMessage(body), [body]);

  // Expiry Timer
  useEffect(() => {
    if (!message.expires_at) return;
    const interval = setInterval(() => {
      const remaining = new Date(message.expires_at!).getTime() - Date.now();
      if (remaining <= 0) {
        setTimeLeft('Expired');
        clearInterval(interval);
      } else {
        const s = Math.floor(remaining / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) setTimeLeft(`${h}h`);
        else if (m > 0) setTimeLeft(`${m}m`);
        else setTimeLeft(`${s % 60}s`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [message.expires_at]);

  const handleReveal = () => {
    if (!isRevealed) {
      setIsRevealed(true);
      if (!message.metadata?.viewed_at) onMarkRead?.(message.id);
    }
  };

  const toggleAudio = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };

  // Render System Messages
  if (message.type === 'system' || message.message_type === 'system') {
    const sys = decodeSystemEvent(body);
    return (
      <div className="flex justify-center my-2 animate-in fade-in duration-500">
        <div className="bg-slate-100/50 backdrop-blur-sm border border-slate-200 px-3 py-1 rounded-full flex items-center gap-2">
           {(sys.systemEventType || '').includes('call') ? <PhoneCall size={12} className="text-violet-500" /> : <Clock size={12} className="text-slate-400" />}
           <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
             {(sys.systemEventType || '').replace(/_/g, ' ')} • {format(new Date(message.created_at), 'HH:mm')}
           </span>
        </div>
      </div>
    );
  }

  const msgType = message.type || message.message_type;

  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} px-3 py-1 group select-none relative w-full`}>
      <div className={`flex flex-col max-w-[85%] ${isMe ? 'items-end' : 'items-start'}`}>
        
        <div className={cn(
          "relative rounded-[24px] border transition-all duration-300 shadow-sm",
          isMe 
            ? "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-indigo-400 shadow-indigo-100" 
            : "bg-slate-50 text-slate-900 border-slate-200",
          !isRevealed && "cursor-pointer hover:scale-[1.02] active:scale-95",
          isMe ? "rounded-tr-none" : "rounded-tl-none",
          isHighlighted && "ring-4 ring-indigo-400/50 scale-[1.02] border-indigo-400"
        )}
        onClick={!isRevealed ? handleReveal : undefined}
        >
          {/* One-Time View Overlay */}
          {!isRevealed && (
            <div className="flex flex-col items-center justify-center p-6 gap-2">
              <div className="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center">
                <Lock size={18} className={isMe ? 'text-white' : 'text-slate-400'} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Reveal Secret</span>
            </div>
          )}

          {isRevealed && (
            <div className="px-4 py-3">
              {/* Voice Player */}
              {msgType === 'voice' && (
                <div className="flex items-center gap-3 min-w-[200px]">
                  <button 
                    onClick={toggleAudio}
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                      isMe ? "bg-white/20 hover:bg-white/30" : "bg-slate-200 hover:bg-slate-300"
                    )}
                  >
                    {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                  </button>
                  <div className="flex-1 h-1.5 rounded-full bg-black/10 relative overflow-hidden">
                    <div className={cn("h-full bg-current opacity-40 rounded-full", isPlaying && "animate-shimmer")} style={{ width: '60%' }} />
                  </div>
                  <span className="text-[10px] font-mono font-bold opacity-70 tabular-nums">
                    {message.metadata?.duration || '0:00'}
                  </span>
                  <audio 
                    ref={audioRef} 
                    src={`data:audio/webm;base64,${decodeVoice(body).voiceBase64 || ''}`} 
                    onEnded={() => setIsPlaying(false)}
                    className="hidden"
                  />
                </div>
              )}

              {/* Location Card */}
              {msgType === 'location' && (
                <div className="flex flex-col gap-2 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                      <MapPin size={16} />
                    </div>
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-tighter opacity-70">Secured Location</div>
                      <div className="text-[12px] font-bold truncate">{message.location_label || 'Shared Position'}</div>
                    </div>
                  </div>
                  <a 
                    href={`https://www.google.com/maps?q=${message.location_lat},${message.location_lng}`}
                    target="_blank"
                    className={cn(
                      "flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all",
                      isMe ? "bg-white/10 hover:bg-white/20" : "bg-slate-100 hover:bg-slate-200"
                    )}
                  >
                    Satellite Link <ExternalLink size={12} />
                  </a>
                </div>
              )}

              {/* Standard Content */}
              {['text', 'vanish', 'reply', 'text-with-links'].includes(msgType || 'text') && (
                <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{decoded.text || body}</div>
              )}

              {msgType === 'business_object' && message.metadata?.object_type && (
                <div className="scale-95 origin-top-left -mx-1">
                  <BusinessObjectCard
                    obj={{ id: message.metadata.object_id, type: 'business_object', object_type: message.metadata.object_type as any, payload: message.metadata.object_data || {}, status: 'pending', room_id: '', created_by: '', created_at: '' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Metadata Footer */}
          <div className="px-3 pb-1.5 flex items-center justify-end gap-1.5 opacity-60">
             {timeLeft && <div className="flex items-center gap-1 text-[9px] font-black uppercase"><Clock size={10} /> {timeLeft}</div>}
             <span className="text-[9px] font-bold tabular-nums">{format(new Date(message.created_at), 'HH:mm')}</span>
             {isMe && <CheckCheck size={12} className={message.status === 'read' ? 'text-amber-300' : 'text-white/60'} />}
          </div>
        </div>

        {/* Action Controls */}
        {!msgType?.includes('system') && (
          <div className="mt-1 flex items-center gap-2 px-1">
             <button onClick={() => onReply?.(message)} className="p-1 hover:bg-slate-100 rounded text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"><Reply size={14} /></button>
             <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
                <button onClick={onCreateOrder} className="p-1 hover:bg-slate-100 rounded text-slate-400 font-bold text-[10px] uppercase">Order</button>
                <button onClick={onPinToggle} className="p-1 rounded text-slate-400 hover:text-amber-500"><Lock size={14} /></button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
