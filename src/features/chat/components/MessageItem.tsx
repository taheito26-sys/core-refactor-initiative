/* ═══════════════════════════════════════════════════════════════
   MessageItem — Rocket.Chat-style message bubble
   Left-aligned with sender name, own messages highlighted
   ═══════════════════════════════════════════════════════════════ */

import { useMemo, useState, useRef, useEffect } from 'react';
import { Check, CheckCheck, Reply, Copy } from 'lucide-react';
import type { ChatMessage } from '@/lib/chat-store';
import { parseMsg, splitLinks, fmtMsgTime, getPalette } from '../lib/message-codec';

interface Props {
  message: ChatMessage;
  isOwn: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  currentUserId: string;
  counterpartyName: string;
  isHighlighted: boolean;
  onReply: (msg: ChatMessage) => void;
  onScrollToMessage?: (id: string) => void;
}

export function MessageItem({
  message, isOwn, isFirstInGroup, isLastInGroup,
  currentUserId, counterpartyName, isHighlighted,
  onReply, onScrollToMessage,
}: Props) {
  const [showCtx, setShowCtx] = useState(false);
  const parsed = useMemo(() => parseMsg(message.content), [message.content]);
  const palette = getPalette(counterpartyName);

  const isPending = !!message._pending;
  const isRead = !!message.read_at;

  // Sender display name
  const senderName = isOwn ? 'You' : counterpartyName;

  // ── Voice player ─────────────────────────────────────────────
  const VoicePlayer = () => {
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const srcUrl = useMemo(() => {
      if (!parsed.voiceBase64) return '';
      try {
        const bin = atob(parsed.voiceBase64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return URL.createObjectURL(new Blob([arr], { type: 'audio/webm' }));
      } catch { return ''; }
    }, []);

    useEffect(() => () => { if (srcUrl) URL.revokeObjectURL(srcUrl); }, [srcUrl]);

    const toggle = () => {
      if (!audioRef.current) {
        const a = new Audio(srcUrl);
        audioRef.current = a;
        a.ontimeupdate = () => setProgress((a.currentTime / a.duration) * 100 || 0);
        a.onended = () => { setPlaying(false); setProgress(0); };
      }
      if (playing) audioRef.current.pause();
      else audioRef.current.play();
      setPlaying(!playing);
    };

    return (
      <div className="flex items-center gap-2 min-w-[180px]">
        <button onClick={toggle} className="w-8 h-8 rounded-full border-none cursor-pointer bg-primary/20 text-primary flex items-center justify-center text-sm">
          {playing ? '⏸' : '▶'}
        </button>
        <div className="flex-1">
          <div className="h-1 rounded bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded transition-[width] duration-100" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5">
            {parsed.voiceDuration ? `${Math.floor(parsed.voiceDuration / 60)}:${String(parsed.voiceDuration % 60).padStart(2, '0')}` : '0:00'}
          </div>
        </div>
      </div>
    );
  };

  // ── Poll ──────────────────────────────────────────────────────
  const PollBubble = () => {
    const [votes, setVotes] = useState<Record<string, string[]>>(() => {
      try { return JSON.parse(localStorage.getItem(`poll_${message.id}`) || '{}'); } catch { return {}; }
    });
    const hasVoted = Object.values(votes).some((arr) => arr.includes(currentUserId));
    const totalVotes = Object.values(votes).reduce((s, a) => s + a.length, 0);

    const vote = (opt: string) => {
      if (hasVoted) return;
      const next = { ...votes, [opt]: [...(votes[opt] || []), currentUserId] };
      setVotes(next);
      localStorage.setItem(`poll_${message.id}`, JSON.stringify(next));
    };

    return (
      <div>
        <div className="text-xs font-bold mb-1.5">📊 {parsed.pollQuestion}</div>
        {(parsed.pollOptions || []).map((opt) => {
          const count = (votes[opt] || []).length;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          return (
            <div key={opt} onClick={() => vote(opt)} className="px-2 py-1 mb-0.5 rounded border border-border bg-primary/5 relative overflow-hidden text-[11px] cursor-pointer">
              {hasVoted && (
                <div className="absolute left-0 top-0 bottom-0 bg-primary/15 transition-[width] duration-300" style={{ width: `${pct}%` }} />
              )}
              <span className="relative z-10">{opt}</span>
              {hasVoted && <span className="relative z-10 float-right font-bold">{pct}%</span>}
            </div>
          );
        })}
        {hasVoted && <div className="text-[9px] text-muted-foreground mt-1">{totalVotes} votes</div>}
      </div>
    );
  };

  // ── Text with links ──────────────────────────────────────────
  const TextContent = ({ text }: { text: string }) => (
    <>
      {splitLinks(text).map((part, i) =>
        part.type === 'link' ? (
          <a key={i} href={part.value} target="_blank" rel="noopener noreferrer"
            className="text-primary underline opacity-85"
            onClick={(e) => e.stopPropagation()}>
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </>
  );

  return (
    <div
      data-msg-id={message.id}
      className={`relative px-4 ${isFirstInGroup ? 'pt-2' : 'pt-0.5'} ${isHighlighted ? 'msg-highlight' : ''}`}
      onContextMenu={(e) => { e.preventDefault(); setShowCtx(true); }}
    >
      {/* Bubble — Rocket.Chat style: all left-aligned, own messages get warm bg */}
      <div
        className={`rounded-md px-3 py-2 max-w-[75%] ${
          isOwn
            ? 'bg-amber-400/20 border border-amber-400/30 ml-auto'
            : 'bg-card border border-border'
        }`}
      >
        {/* Sender name — bold, colored */}
        {isFirstInGroup && (
          <div
            className="text-[11px] font-extrabold mb-0.5"
            style={{ color: isOwn ? 'hsl(var(--primary))' : palette.text === '#fff' ? undefined : palette.text }}
          >
            <span className={isOwn ? 'text-primary' : 'text-sky-400'}>
              {senderName}
            </span>
          </div>
        )}

        {/* Reply quote */}
        {parsed.isReply && parsed.replyPreview && (
          <div
            onClick={() => parsed.replyId && onScrollToMessage?.(parsed.replyId)}
            className="border-l-2 border-primary pl-2 mb-1 cursor-pointer"
          >
            <div className="text-[9px] font-bold text-primary">{parsed.replySender}</div>
            <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
              {parsed.replyPreview}
            </div>
          </div>
        )}

        {/* Forward */}
        {parsed.isFwd && (
          <div className="text-[9px] text-muted-foreground mb-1 italic">
            ↪ Forwarded from {parsed.fwdSender}
          </div>
        )}

        {/* Content */}
        {parsed.isVoice ? <VoicePlayer /> :
         parsed.isPoll ? <PollBubble /> :
         parsed.isSystemEvent ? (
          <div className="text-[11px] text-muted-foreground italic text-center">
            ℹ️ {parsed.systemEventFields?.join(' · ') || 'System event'}
          </div>
        ) : (
          <div className="text-[12px] leading-relaxed text-foreground break-words">
            <TextContent text={parsed.text} />
          </div>
        )}

        {/* Meta: time + status */}
        <div className="flex items-center justify-end gap-1 mt-1">
          {parsed.isEdited && (
            <span className="text-[8px] text-muted-foreground italic">edited</span>
          )}
          <span className="text-[9px] text-muted-foreground">{fmtMsgTime(message.created_at)}</span>
          {isOwn && (
            isPending ? (
              <span className="text-[9px] text-muted-foreground">○</span>
            ) : isRead ? (
              <CheckCheck size={12} className="text-primary" />
            ) : (
              <Check size={12} className="text-muted-foreground" />
            )
          )}
        </div>
      </div>

      {/* Context menu */}
      {showCtx && (
        <>
          <div className="fixed inset-0 z-[999]" onClick={() => setShowCtx(false)} />
          <div className="absolute top-0 z-[1000] bg-popover border border-border rounded-lg p-1 shadow-lg flex flex-col min-w-[120px]"
            style={{ [isOwn ? 'left' : 'right']: 16 }}>
            <CtxBtn icon={<Reply size={12} />} label="Reply" onClick={() => { setShowCtx(false); onReply(message); }} />
            <CtxBtn icon={<Copy size={12} />} label="Copy" onClick={() => { navigator.clipboard.writeText(parsed.text); setShowCtx(false); }} />
          </div>
        </>
      )}
    </div>
  );
}

function CtxBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-2.5 py-1.5 border-none bg-transparent cursor-pointer text-foreground text-[11px] rounded w-full text-left hover:bg-accent/30 transition-colors">
      {icon} {label}
    </button>
  );
}
