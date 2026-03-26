/* ═══════════════════════════════════════════════════════════════
   MessageComposer — Rocket.Chat-style input bar
   Attach | Voice | 😊  Type a message...  🎤  [Send]
   ═══════════════════════════════════════════════════════════════ */

import { useState, useRef, useCallback } from 'react';
import { Send, Paperclip, Mic, MicOff, StopCircle, X, Reply, Smile } from 'lucide-react';
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
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [text, replyTo, onSend, onCancelReply]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape' && replyTo) onCancelReply();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onTyping();
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
          ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      mediaRecorderRef.current = mr;
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        const durationSec = recordingTimeRef.current || 1;
        const blob = new Blob(chunks, { type: mr.mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1] || '';
          if (b64) onSend(encodeVoice(durationSec, b64));
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
    } catch { /* mic denied */ }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
  };

  const fmtRecTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex-shrink-0 border-t border-border bg-card">
      {/* Reply bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-primary/5">
          <Reply size={13} className="text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold text-primary">{replyTo.sender}</div>
            <div className="text-[10px] text-muted-foreground truncate">{replyTo.preview}</div>
          </div>
          <button onClick={onCancelReply} className="bg-transparent border-none cursor-pointer text-muted-foreground p-0.5 flex">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input row — Rocket.Chat style */}
      <div className="flex items-end gap-0 px-3 py-2">
        {/* Attach + Voice toolbar buttons */}
        <div className="flex items-center gap-0 border-r border-border mr-2 pr-2">
          <button className="bg-transparent border-none cursor-pointer text-muted-foreground hover:text-foreground p-1.5 flex items-center text-[11px] font-semibold gap-1 transition-colors" title="Attach file">
            <Paperclip size={14} />
            <span className="hidden sm:inline">Attach</span>
          </button>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`bg-transparent border-none cursor-pointer p-1.5 flex items-center text-[11px] font-semibold gap-1 transition-colors ${
              isRecording ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Voice message"
          >
            {isRecording ? <StopCircle size={14} /> : <Mic size={14} />}
            <span className="hidden sm:inline">{isRecording ? fmtRecTime(recordingTime) : 'Voice'}</span>
          </button>
        </div>

        {/* Emoji */}
        <button className="bg-transparent border-none cursor-pointer text-muted-foreground hover:text-foreground p-1.5 flex flex-shrink-0 transition-colors">
          <Smile size={16} />
        </button>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={isRecording ? `🔴 Recording… ${fmtRecTime(recordingTime)}` : text}
          onChange={handleChange}
          onKeyDown={handleKey}
          disabled={disabled || isRecording}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 resize-none border-none bg-transparent text-foreground text-xs outline-none max-h-[120px] leading-relaxed px-2 py-1.5 placeholder:text-muted-foreground"
        />

        {/* Mic icon (right side) */}
        {!text.trim() && !isRecording && (
          <button onClick={startRecording} className="bg-transparent border-none cursor-pointer text-muted-foreground hover:text-foreground p-1.5 flex flex-shrink-0 transition-colors">
            <Mic size={16} />
          </button>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="bg-primary text-primary-foreground border-none rounded-md px-4 py-1.5 text-xs font-bold cursor-pointer flex-shrink-0 disabled:opacity-40 hover:opacity-90 transition-opacity ml-1"
        >
          Send
        </button>
      </div>
    </div>
  );
}
