import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Check, CheckCheck, Shield, Eye, Clock, Phone, Video, Mic, BarChart3, Forward, Reply, Play, Pause } from 'lucide-react';
import { BusinessObjectCard } from './BusinessObjectCard';
import { parseMsg, splitLinks } from '../lib/message-codec';
import { useMemo, useState, useRef, useCallback, useEffect } from 'react';

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

  const parsed = useMemo(() => parseMsg(message.content), [message.content]);

  if (isSystem) {
    return (
      <div className="flex justify-center my-3 relative">
        <span className="bg-muted text-muted-foreground text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-[0.2em] border border-border backdrop-blur-sm">
          {parsed.text || message.content}
        </span>
      </div>
    );
  }

  const isOneTime = !!message.expires_at && !message.metadata?.timer;

  // ── Voice message renderer ──
  const VoicePlayer = () => {
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const animRef = useRef<number>(0);
    const totalDuration = parsed.voiceDuration || 0;
    const mins = Math.floor(totalDuration / 60);
    const secs = totalDuration % 60;

    const audioSrc = useMemo(() => {
      if (!parsed.voiceBase64) return '';
      return `data:audio/webm;base64,${parsed.voiceBase64}`;
    }, []);

    const tick = useCallback(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      setProgress(pct);
      setCurrentTime(audio.currentTime);
      animRef.current = requestAnimationFrame(tick);
    }, []);

    const toggle = useCallback(() => {
      if (!audioRef.current) {
        const audio = new Audio(audioSrc);
        audioRef.current = audio;
        audio.onended = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
        audio.onpause = () => { cancelAnimationFrame(animRef.current); };
        audio.onplay = () => { animRef.current = requestAnimationFrame(tick); };
      }
      const audio = audioRef.current;
      if (audio.paused) { audio.play(); setPlaying(true); }
      else { audio.pause(); setPlaying(false); }
    }, [audioSrc, tick]);

    useEffect(() => () => { audioRef.current?.pause(); cancelAnimationFrame(animRef.current); }, []);

    const elapsed = playing || currentTime > 0 ? currentTime : totalDuration;
    const eM = Math.floor(elapsed / 60);
    const eS = Math.floor(elapsed % 60);

    const BARS = [3, 5, 8, 6, 9, 4, 7, 5, 3, 6, 8, 4, 7, 5, 3];

    return (
      <div className="flex items-center gap-3 min-w-[180px]">
        <button
          onClick={toggle}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all cursor-pointer border-none",
            isMe ? "bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground" : "bg-primary/15 hover:bg-primary/25 text-primary"
          )}
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-end gap-[2px] h-5">
            {BARS.map((h, i) => {
              const barPct = (i / BARS.length) * 100;
              const filled = barPct < progress;
              return (
                <div
                  key={i}
                  className={cn(
                    "w-[2.5px] rounded-full transition-colors duration-150",
                    filled
                      ? (isMe ? "bg-primary-foreground" : "bg-primary")
                      : (isMe ? "bg-primary-foreground/30" : "bg-foreground/20")
                  )}
                  style={{ height: `${h * 2}px` }}
                />
              );
            })}
          </div>
          <span className="text-[10px] opacity-70 mt-0.5 block tabular-nums">
            {eM}:{String(eS).padStart(2, '0')}
          </span>
        </div>
      </div>
    );
  };

  // ── Poll renderer ──
  const renderPoll = () => (
    <div className="space-y-2 min-w-[200px]">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 size={14} />
        <span className="font-bold text-[12px]">Poll</span>
      </div>
      <p className="font-bold text-[13px]">{parsed.pollQuestion}</p>
      {parsed.pollOptions?.map((opt, i) => (
        <div key={i} className={cn("px-3 py-2 rounded-lg text-[12px] border cursor-pointer transition-colors", isMe ? "border-primary-foreground/20 hover:bg-primary-foreground/10" : "border-border hover:bg-accent")}>
          {opt}
        </div>
      ))}
    </div>
  );

  // ── Forward renderer ──
  const renderForward = () => (
    <div>
      <div className={cn("flex items-center gap-1.5 text-[10px] mb-1.5 opacity-70")}>
        <Forward size={10} />
        <span>Forwarded from <strong>{parsed.fwdSender}</strong></span>
      </div>
      <div className={cn("border-l-2 pl-2 mb-1.5 text-[11px] italic opacity-80", isMe ? "border-primary-foreground/30" : "border-border")}>
        {parsed.fwdText}
      </div>
      {parsed.text && <p className="font-medium tracking-tight whitespace-pre-wrap">{parsed.text}</p>}
    </div>
  );

  // ── Reply renderer ──
  const renderReply = () => (
    <div>
      <div className={cn("rounded-lg px-2.5 py-1.5 mb-2 text-[11px] border-l-2", isMe ? "bg-primary-foreground/10 border-primary-foreground/30" : "bg-muted border-primary/40")}>
        <div className="font-bold text-[10px] mb-0.5 opacity-80">{parsed.replySender}</div>
        <div className="opacity-70 line-clamp-2">{parsed.replyPreview}</div>
      </div>
      <p className="font-medium tracking-tight whitespace-pre-wrap">{parsed.text}</p>
    </div>
  );

  // ── Text with links ──
  const renderText = () => {
    const parts = splitLinks(parsed.text);
    return (
      <p className="font-medium tracking-tight whitespace-pre-wrap">
        {parts.map((part, i) =>
          part.type === 'link' ? (
            <a key={i} href={part.value} target="_blank" rel="noopener noreferrer" className="underline break-all">{part.value}</a>
          ) : (
            <span key={i}>{part.value}</span>
          )
        )}
        {parsed.isEdited && <span className="text-[9px] opacity-50 ml-2 italic">(edited)</span>}
      </p>
    );
  };

  // ── Pick content renderer ──
  const renderContent = () => {
    if (message.type === 'business_object' && message.metadata?.object_type) {
      return (
        <div className="scale-95 origin-top-left -mx-1">
          <BusinessObjectCard
            obj={{ id: message.metadata.object_id, type: 'business_object', object_type: message.metadata.object_type as any, payload: message.metadata.object_data || {}, status: 'pending', room_id: '', created_by: '', created_at: '' }}
          />
        </div>
      );
    }
    if (parsed.isVoice) return renderVoice();
    if (parsed.isPoll) return renderPoll();
    if (parsed.isFwd) return renderForward();
    if (parsed.isReply) return renderReply();
    if (parsed.isSystemEvent) return <p className="font-medium tracking-tight text-[11px] italic opacity-80">{parsed.systemEventFields?.join(' · ') || 'System event'}</p>;
    return renderText();
  };

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
            {renderContent()}

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
