/* ═══════════════════════════════════════════════════════════════
   MessageItem — individual message bubble in the timeline
   ═══════════════════════════════════════════════════════════════ */

import { useMemo, useState, useRef, useEffect } from 'react';
import { Check, CheckCheck, Reply, Copy, Forward, Star, Trash2, Edit3 } from 'lucide-react';
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

  // Delivery status
  const isPending = !!message._pending;
  const isDelivered = !isPending && !message.read_at;
  const isRead = !!message.read_at;

  // ── Voice message playback ─────────────────────────────────────
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
      if (playing) { audioRef.current.pause(); }
      else { audioRef.current.play(); }
      setPlaying(!playing);
    };

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
        <button onClick={toggle} style={{
          width: 32, height: 32, borderRadius: 50, border: 'none', cursor: 'pointer',
          background: 'color-mix(in srgb, var(--brand) 20%, transparent)',
          color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }}>
          {playing ? '⏸' : '▶'}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            height: 4, borderRadius: 2, background: 'color-mix(in srgb, var(--text) 15%, transparent)',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`, height: '100%', background: 'var(--brand)',
              borderRadius: 2, transition: 'width 0.1s linear',
            }} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
            {parsed.voiceDuration ? `${Math.floor(parsed.voiceDuration / 60)}:${String(parsed.voiceDuration % 60).padStart(2, '0')}` : '0:00'}
          </div>
        </div>
      </div>
    );
  };

  // ── Poll rendering ─────────────────────────────────────────────
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
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>📊 {parsed.pollQuestion}</div>
        {(parsed.pollOptions || []).map((opt) => {
          const count = (votes[opt] || []).length;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          return (
            <div key={opt} onClick={() => vote(opt)} style={{
              padding: '5px 8px', marginBottom: 3, borderRadius: 4, cursor: hasVoted ? 'default' : 'pointer',
              border: '1px solid var(--line)', background: 'color-mix(in srgb, var(--brand) 5%, transparent)',
              position: 'relative', overflow: 'hidden', fontSize: 11,
            }}>
              {hasVoted && (
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${pct}%`, background: 'color-mix(in srgb, var(--brand) 15%, transparent)',
                  transition: 'width 0.3s',
                }} />
              )}
              <span style={{ position: 'relative', zIndex: 1 }}>{opt}</span>
              {hasVoted && <span style={{ position: 'relative', zIndex: 1, float: 'right', fontWeight: 700 }}>{pct}%</span>}
            </div>
          );
        })}
        {hasVoted && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>{totalVotes} votes</div>}
      </div>
    );
  };

  // ── Render text with links ─────────────────────────────────────
  const TextContent = ({ text }: { text: string }) => (
    <>
      {splitLinks(text).map((part, i) =>
        part.type === 'link' ? (
          <a key={i} href={part.value} target="_blank" rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'underline', opacity: 0.85 }}
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
      className={isHighlighted ? 'msg-highlight' : ''}
      style={{
        display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start',
        padding: `${isFirstInGroup ? 6 : 1}px 16px 1px`,
        position: 'relative',
      }}
      onContextMenu={(e) => { e.preventDefault(); setShowCtx(true); }}
    >
      <div style={{
        maxWidth: '70%', minWidth: 80,
        background: isOwn
          ? 'color-mix(in srgb, var(--brand) 15%, transparent)'
          : 'color-mix(in srgb, var(--text) 6%, transparent)',
        borderRadius: isOwn
          ? `12px 12px ${isLastInGroup ? '4px' : '12px'} 12px`
          : `12px 12px 12px ${isLastInGroup ? '4px' : '12px'}`,
        padding: '8px 12px',
        position: 'relative',
      }}>
        {/* Reply quote */}
        {parsed.isReply && parsed.replyPreview && (
          <div
            onClick={() => parsed.replyId && onScrollToMessage?.(parsed.replyId)}
            style={{
              borderLeft: '2px solid var(--brand)', paddingLeft: 8,
              marginBottom: 4, cursor: 'pointer',
              fontSize: 10, color: 'var(--muted)', lineHeight: 1.3,
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--brand)', fontSize: 9 }}>{parsed.replySender}</div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
              {parsed.replyPreview}
            </div>
          </div>
        )}

        {/* Forward banner */}
        {parsed.isFwd && (
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3, fontStyle: 'italic' }}>
            ↪ Forwarded from {parsed.fwdSender}
          </div>
        )}

        {/* Content */}
        {parsed.isVoice ? <VoicePlayer /> :
         parsed.isPoll ? <PollBubble /> :
         parsed.isSystemEvent ? (
          <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center' }}>
            ℹ️ {parsed.systemEventFields?.join(' · ') || 'System event'}
          </div>
        ) : (
          <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--text)', wordBreak: 'break-word' }}>
            <TextContent text={parsed.text} />
          </div>
        )}

        {/* Meta row: time + edited + delivery status */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 4, marginTop: 3,
        }}>
          {parsed.isEdited && (
            <span style={{ fontSize: 8, color: 'var(--muted)', fontStyle: 'italic' }}>edited</span>
          )}
          <span style={{ fontSize: 9, color: 'var(--muted)' }}>{fmtMsgTime(message.created_at)}</span>
          {isOwn && (
            isPending ? (
              <span style={{ fontSize: 9, color: 'var(--muted)' }}>○</span>
            ) : isRead ? (
              <CheckCheck size={12} style={{ color: 'var(--brand)' }} />
            ) : (
              <Check size={12} style={{ color: 'var(--muted)' }} />
            )
          )}
        </div>
      </div>

      {/* Context menu */}
      {showCtx && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setShowCtx(false)}
          />
          <div style={{
            position: 'absolute', top: 0, [isOwn ? 'left' : 'right']: 16,
            zIndex: 1000, background: 'var(--panel2)', border: '1px solid var(--line)',
            borderRadius: 8, padding: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            display: 'flex', flexDirection: 'column', minWidth: 120,
          }}>
            <CtxBtn icon={<Reply size={12} />} label="Reply" onClick={() => {
              setShowCtx(false);
              onReply(message);
            }} />
            <CtxBtn icon={<Copy size={12} />} label="Copy" onClick={() => {
              navigator.clipboard.writeText(parsed.text);
              setShowCtx(false);
            }} />
          </div>
        </>
      )}
    </div>
  );
}

function CtxBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
      border: 'none', background: 'transparent', cursor: 'pointer',
      color: 'var(--text)', fontSize: 11, borderRadius: 4, width: '100%',
      textAlign: 'left',
    }}>
      {icon} {label}
    </button>
  );
}
