// ─── MessageComposer — Modern WhatsApp-style ──────────────────────────────
import { useState, useRef, useCallback } from 'react';
import {
  Send, Paperclip, Mic, X, Clock, Eye,
  Camera, Plus, Timer, EyeOff,
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

// ── Voice recorder ─────────────────────────────────────────────────────────
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
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(250);
      recorderRef.current = mr;
      streamRef.current   = stream;
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
  { label: 'Off',   value: null,   icon: '✕' },
  { label: '1 min', value: 60,     icon: '1m' },
  { label: '1 hr',  value: 3600,   icon: '1h' },
  { label: '24 hr', value: 86400,  icon: '24h' },
  { label: '7 d',   value: 604800, icon: '7d' },
];

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MessageComposer({ roomId, roomType, onSend, onTyping, meId }: Props) {
  const [content, setContent]       = useState('');
  const [viewOnce, setViewOnce]     = useState(false);
  const [expiresSec, setExpiresSec] = useState<number | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
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

  // Close menus on outside clicks
  const closeMenus = useCallback(() => {
    setShowAttachMenu(false);
    setShowTimerPicker(false);
  }, []);

  // ── Recording UI ─────────────────────────────────────────────────────────
  if (voice.recording) {
    return (
      <div className="border-t border-border/50 bg-card px-3 py-2.5">
        <div className="flex items-center gap-3">
          <button
            onClick={voice.cancel}
            className="h-10 w-10 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

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

          <button
            onClick={handleVoiceSend}
            disabled={uploading}
            className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-md hover:opacity-90 transition-opacity"
          >
            {uploading
              ? <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              : <Send className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>
    );
  }

  // ── Active modes indicator ──────────────────────────────────────────────
  const hasActiveMode = viewOnce || expiresSec;

  // ── Main composer ────────────────────────────────────────────────────────
  return (
    <div className="border-t border-border/50 bg-card">
      {/* Active mode chips — shown when view-once or disappearing is on */}
      {hasActiveMode && (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          {viewOnce && (
            <button
              onClick={() => setViewOnce(false)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-400/20 hover:bg-violet-500/25 transition-colors"
            >
              <Eye className="h-3 w-3" />
              View once
              <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          )}
          {expiresSec && (
            <button
              onClick={() => setExpiresSec(null)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-400/20 hover:bg-amber-500/25 transition-colors"
            >
              <Timer className="h-3 w-3" />
              {DISAPPEARING_OPTIONS.find((o) => o.value === expiresSec)?.label ?? 'Timer'}
              <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-end gap-1.5 px-3 py-2">
        {/* Attach menu */}
        <div className="relative">
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip" />
          <input ref={imageInputRef} type="file" className="hidden" onChange={handleFileSelect}
            accept="image/*,video/*" />

          <button
            onClick={() => { setShowAttachMenu((v) => !v); setShowTimerPicker(false); }}
            className={cn(
              'h-10 w-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all',
              showAttachMenu && 'text-primary bg-primary/10',
            )}
          >
            <Plus className={cn('h-5 w-5 transition-transform duration-200', showAttachMenu && 'rotate-45')} />
          </button>

          {showAttachMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={closeMenus} />
              <div className="absolute bottom-full mb-2 left-0 bg-popover border border-border rounded-2xl shadow-xl p-1.5 min-w-[180px] z-50 animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
                <button
                  onClick={() => { imageInputRef.current?.click(); setShowAttachMenu(false); }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm hover:bg-muted transition-colors"
                >
                  <div className="h-9 w-9 rounded-full bg-violet-500/15 flex items-center justify-center">
                    <Camera className="h-4.5 w-4.5 text-violet-500" />
                  </div>
                  <span className="font-medium">Photo & Video</span>
                </button>
                <button
                  onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm hover:bg-muted transition-colors"
                >
                  <div className="h-9 w-9 rounded-full bg-blue-500/15 flex items-center justify-center">
                    <Paperclip className="h-4.5 w-4.5 text-blue-500" />
                  </div>
                  <span className="font-medium">Document</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKey}
            placeholder="Type a message"
            rows={1}
            className="w-full resize-none bg-muted/40 rounded-3xl border-none px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/50 max-h-40 overflow-y-auto pr-20"
            style={{ height: 'auto' }}
          />

          {/* Inline action buttons — always visible inside the text field */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {/* View once toggle */}
            <button
              onClick={() => setViewOnce((v) => !v)}
              title={viewOnce ? 'View once: ON' : 'View once: OFF'}
              className={cn(
                'h-7 w-7 rounded-full flex items-center justify-center transition-all',
                viewOnce
                  ? 'bg-violet-500/20 text-violet-500'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/60',
              )}
            >
              {viewOnce ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>

            {/* Disappearing timer */}
            <div className="relative">
              <button
                onClick={() => { setShowTimerPicker((v) => !v); setShowAttachMenu(false); }}
                title="Disappearing message"
                className={cn(
                  'h-7 w-7 rounded-full flex items-center justify-center transition-all',
                  expiresSec
                    ? 'bg-amber-500/20 text-amber-500'
                    : 'text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/60',
                )}
              >
                <Timer className="h-3.5 w-3.5" />
              </button>

              {showTimerPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeMenus} />
                  <div className="absolute bottom-full mb-2 right-0 bg-popover border border-border rounded-2xl shadow-xl p-1.5 min-w-[140px] z-50 animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
                    <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                      Auto-delete after
                    </p>
                    {DISAPPEARING_OPTIONS.map((opt) => (
                      <button
                        key={String(opt.value)}
                        onClick={() => { setExpiresSec(opt.value); setShowTimerPicker(false); }}
                        className={cn(
                          'flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm transition-colors',
                          expiresSec === opt.value
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold'
                            : 'hover:bg-muted text-foreground',
                        )}
                      >
                        <span className={cn(
                          'h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                          expiresSec === opt.value
                            ? 'bg-amber-500/20 text-amber-600'
                            : 'bg-muted text-muted-foreground',
                        )}>
                          {opt.icon}
                        </span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
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
