/* ═══════════════════════════════════════════════════════════════
   MessageComposer — pinned input bar at bottom of chat
   Always visible, never scrolls out of view.
   ═══════════════════════════════════════════════════════════════ */

import { useState, useRef, useCallback } from 'react';
import { Send, Smile, Mic, MicOff, StopCircle, X, Reply, Image as ImageIcon } from 'lucide-react';
import { encodeReply, encodeVoice } from '../lib/message-codec';

interface ReplyContext {
  id: string;
  sender: string;
  preview: string;
}

interface Props {
  onSend: (content: string) => void;
  onTyping: () => void;
  replyTo: ReplyContext | null;
  onCancelReply: () => void;
  disabled?: boolean;
}

export function MessageComposer({ onSend, onTyping, replyTo, onCancelReply, disabled }: Props) {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimeRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    let content = trimmed;
    if (replyTo) {
      content = encodeReply(replyTo.id, replyTo.sender, replyTo.preview, trimmed);
      onCancelReply();
    }

    onSend(content);
    setText('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, replyTo, onSend, onCancelReply]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && replyTo) {
      onCancelReply();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onTyping();
    // Auto-expand
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  // ── Voice recording ──────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      mediaRecorderRef.current = mr;

      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      // onstop MUST be attached before .start() — race condition fix
      mr.onstop = async () => {
        const durationSec = recordingTimeRef.current || 1;
        const blob = new Blob(chunks, { type: mr.mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1] || '';
          if (b64) {
            onSend(encodeVoice(durationSec, b64));
          }
        };
        reader.readAsDataURL(blob);
      };

      mr.start(100);
      setIsRecording(true);
      recordingTimeRef.current = 0;
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        recordingTimeRef.current += 1;
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch {
      // Microphone permission denied
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const fmtRecTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid var(--line)', background: 'var(--panel)' }}>
      {/* Reply bar */}
      {replyTo && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
          borderBottom: '1px solid var(--line)',
          background: 'color-mix(in srgb, var(--brand) 5%, transparent)',
        }}>
          <Reply size={13} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand)' }}>
              {replyTo.sender}
            </div>
            <div style={{
              fontSize: 10, color: 'var(--muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {replyTo.preview}
            </div>
          </div>
          <button
            onClick={onCancelReply}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--muted)', padding: 2, display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input row */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 6, padding: '8px 12px',
      }}>
        {/* Emoji button */}
        <button
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', padding: 6, display: 'flex', flexShrink: 0,
          }}
        >
          <Smile size={18} />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={isRecording ? `🔴 Recording… ${fmtRecTime(recordingTime)}` : text}
          onChange={handleChange}
          onKeyDown={handleKey}
          disabled={disabled || isRecording}
          placeholder="Type a message..."
          rows={1}
          style={{
            flex: 1, resize: 'none', border: '1px solid var(--line)',
            borderRadius: 8, padding: '8px 12px', fontSize: 12,
            background: 'var(--input-bg)', color: 'var(--text)',
            outline: 'none', maxHeight: 120, lineHeight: 1.4,
            fontFamily: 'inherit',
          }}
        />

        {/* Voice / Send / Stop */}
        {isRecording ? (
          <button
            onClick={stopRecording}
            style={{
              background: 'var(--bad)', border: 'none', borderRadius: 50,
              width: 36, height: 36, display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <StopCircle size={18} style={{ color: '#fff' }} />
          </button>
        ) : text.trim() ? (
          <button
            onClick={handleSend}
            disabled={disabled}
            style={{
              background: 'var(--brand)', border: 'none', borderRadius: 50,
              width: 36, height: 36, display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Send size={16} style={{ color: '#fff' }} />
          </button>
        ) : (
          <button
            onClick={startRecording}
            style={{
              background: 'transparent', border: '1px solid var(--line)',
              borderRadius: 50, width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, color: 'var(--muted)',
            }}
          >
            <Mic size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
