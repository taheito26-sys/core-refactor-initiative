// ─── MessageComposer — WhatsApp-style ──────────────────────────────────────
import { useState, useRef, useCallback } from 'react';
import {
  Send, Paperclip, Mic, X, Clock, Eye,
  Camera, StopCircle, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { uploadAttachment, validateAttachment } from '../api/chat';
import type { ChatRoomType } from '../types';
import { toast } from 'sonner';

interface Props {
  roomId:   string;
  roomType: ChatRoomType;
  onSend:   (content: string, opts?: {
    replyToId?:   string;
    expiresAt?:   string;
    viewOnce?:    boolean;
    attachmentId?: string;
    type?:        string;
    metadata?:    Record<string, unknown>;
  }) => void;
  onTyping: () => void;
  meId:     string;
}

// ── Voice recorder (fixed: stores MediaRecorder, not stream) ───────────────
function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration]   = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Try opus first, fall back to default
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(250);
      recorderRef.current = mr;       // ← store MediaRecorder (was bug: stored stream)
      streamRef.current   = stream;   // ← store stream separately for cleanup
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
      return mr;
    } catch {
      toast.error('Microphone access denied');
      return null;
    }
  }, []);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const mr = recorderRef.current;
      if (!mr) { resolve(null); return; }

      if (mr.state !== 'inactive') {
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          resolve(blob);
        };
        mr.stop();
      } else {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: 'audio/webm' })
          : null;
        resolve(blob);
      }

      // Stop all tracks on the stream
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;

      if (timerRef.current) clearInterval(timerRef.current);
      setRecording(false);
      setDuration(0);
    });
  }, []);

  const cancel = useCallback(() => {
    const mr = recorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    setDuration(0);
  }, []);

  return { recording, duration, start, stop, cancel };
}

const DISAPPEARING_OPTIONS = [
  { label: 'Off',   value: null },
  { label: '1 min', value: 60 },
  { label: '1 hr',  value: 3600 },
  { label: '24 hr', value: 86400 },
  { label: '7 d',   value: 604800 },
];

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MessageComposer({ roomId, roomType, onSend, onTyping, meId }: Props) {
  const [content, setContent]     = useState('');
  const [viewOnce, setViewOnce]   = useState(false);
  const [expiresSec, setExpiresSec] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { userId } = useAuth();
  const voice = useVoiceRecorder();

  const expiresAt = expiresSec
    ? new Date(Date.now() + expiresSec * 1000).toISOString()
    : undefined;

  const handleSend = useCallback(() => {
    if (!content.trim()) return;
    onSend(content, { expiresAt, viewOnce });
    setContent('');
    setViewOnce(false);
    textareaRef.current?.focus();
  }, [content, onSend, expiresAt, viewOnce]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    onTyping();
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [onTyping]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    const v = validateAttachment(file);
    if (!v.ok) { toast.error(v.error); return; }

    setUploading(true);
    setShowAttachMenu(false);
    try {
      const isImage = file.type.startsWith('image/');
      const att = await uploadAttachment(roomId, userId, file, isImage ? {
        width: 0, height: 0,
      } : undefined);
      onSend(
        isImage ? '🖼 Image' : `📎 ${file.name}`,
        {
          attachmentId: att.id,
          viewOnce,
          type: isImage ? 'image' : 'file',
          metadata: {
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
          },
        },
      );
    } catch (err) {
      toast.error('Upload failed: ' + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  }, [roomId, userId, onSend, viewOnce]);

  const handleVoiceSend = useCallback(async () => {
    const blob = await voice.stop();
    if (!blob || !userId) return;
    setUploading(true);
    try {
      const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
      const att = await uploadAttachment(roomId, userId, file, {
        durationMs: voice.duration * 1000,
      });
      onSend('🎙 Voice message', {
        attachmentId: att.id,
        type: 'voice_note',
        metadata: { duration_ms: voice.duration * 1000 },
      });
    } catch {
      toast.error('Voice upload failed');
    } finally {
      setUploading(false);
    }
  }, [voice, userId, roomId, onSend]);

  // ── WhatsApp-style recording UI ──────────────────────────────────────────
  if (voice.recording) {
    return (
      <div className="border-t border-border/50 bg-card px-3 py-2.5">
        <div className="flex items-center gap-3">
          {/* Cancel */}
          <button
            onClick={voice.cancel}
            className="h-10 w-10 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Recording indicator */}
          <div className="flex-1 flex items-center gap-3 px-4 py-2 rounded-full bg-muted/50">
            <span className="flex h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-medium text-destructive">
              {formatDuration(voice.duration)}
            </span>
            <div className="flex-1 flex items-center gap-0.5 h-4">
              {Array.from({ length: 30 }, (_, i) => (
                <div
                  key={i}
                  className="w-0.5 bg-destructive/40 rounded-full"
                  style={{
                    height: `${Math.max(4, Math.random() * 16)}px`,
                    opacity: i < (voice.duration % 30) ? 1 : 0.3,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Send voice */}
          <button
            onClick={handleVoiceSend}
            disabled={uploading}
            className="h-10 w-10 rounded-full bg-[hsl(var(--wa-green,142,70%,45%))] flex items-center justify-center text-primary-foreground shadow-md hover:opacity-90 transition-opacity"
          >
            {uploading
              ? <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              : <Send className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>
    );
  }

  // ── Main composer ────────────────────────────────────────────────────────
  return (
    <div className="border-t border-border/50 bg-card px-3 py-2">
      {/* Extras bar (disappearing / view once) */}
      {showExtras && (
        <div className="flex items-center gap-3 mb-2 pb-2 border-b border-border/30 px-1">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-[10px] text-muted-foreground/60">Disappear:</span>
            {DISAPPEARING_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setExpiresSec(opt.value)}
                className={cn(
                  'px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                  expiresSec === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setViewOnce((v) => !v)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
              viewOnce
                ? 'bg-[hsl(142,70%,45%)] text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            <Eye className="h-3 w-3" /> View once
          </button>
        </div>
      )}

      <div className="flex items-end gap-1.5">
        {/* Attach menu */}
        <div className="relative">
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip" />
          <input ref={imageInputRef} type="file" className="hidden" onChange={handleFileSelect}
            accept="image/*,video/*" />

          <button
            onClick={() => setShowAttachMenu((v) => !v)}
            className={cn(
              'h-10 w-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors',
              showAttachMenu && 'text-primary bg-primary/10',
            )}
          >
            <Plus className={cn('h-5 w-5 transition-transform', showAttachMenu && 'rotate-45')} />
          </button>

          {showAttachMenu && (
            <div className="absolute bottom-full mb-2 left-0 bg-popover border border-border rounded-2xl shadow-xl p-2 min-w-[160px] z-50">
              <button
                onClick={() => { imageInputRef.current?.click(); }}
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm hover:bg-muted transition-colors"
              >
                <div className="h-8 w-8 rounded-full bg-[hsl(270,70%,50%)] flex items-center justify-center">
                  <Camera className="h-4 w-4 text-primary-foreground" />
                </div>
                <span>Photo & Video</span>
              </button>
              <button
                onClick={() => { fileInputRef.current?.click(); }}
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm hover:bg-muted transition-colors"
              >
                <div className="h-8 w-8 rounded-full bg-[hsl(210,70%,50%)] flex items-center justify-center">
                  <Paperclip className="h-4 w-4 text-primary-foreground" />
                </div>
                <span>Document</span>
              </button>
              <button
                onClick={() => { setShowExtras((v) => !v); setShowAttachMenu(false); }}
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm hover:bg-muted transition-colors"
              >
                <div className="h-8 w-8 rounded-full bg-[hsl(30,80%,55%)] flex items-center justify-center">
                  <Clock className="h-4 w-4 text-primary-foreground" />
                </div>
                <span>Disappearing</span>
              </button>
            </div>
          )}
        </div>

        {/* Text input — WhatsApp style */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKey}
            placeholder="Type a message"
            rows={1}
            className="w-full resize-none bg-muted/40 rounded-3xl border-none px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/50 max-h-40 overflow-y-auto"
            style={{ height: 'auto' }}
          />
          {(viewOnce || expiresSec) && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {viewOnce && <Eye className="h-3.5 w-3.5 text-[hsl(142,70%,45%)]" />}
              {expiresSec && <Clock className="h-3.5 w-3.5 text-amber-500" />}
            </div>
          )}
        </div>

        {/* Voice OR Send button */}
        {content.trim() ? (
          <button
            onClick={handleSend}
            disabled={uploading}
            className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-sm hover:opacity-90 transition-opacity shrink-0"
          >
            {uploading
              ? <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              : <Send className="h-4.5 w-4.5" />}
          </button>
        ) : (
          <button
            onClick={() => voice.start()}
            disabled={uploading}
            className="h-10 w-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
