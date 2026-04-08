// ─── MessageComposer ──────────────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Send, Paperclip, Mic, MicOff, X, Clock, Eye,
  Smile, StopCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/lib/chat-store';
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
  }) => void;
  onTyping: () => void;
  meId:     string;
}

// Voice recorder using MediaRecorder API
function useVoiceRecorder() {
  const [recording, setRecording]   = useState(false);
  const [duration,  setDuration]    = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(100);
      recorderRef.current = stream as unknown as MediaRecorder;
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
      if (!recorderRef.current) { resolve(null); return; }
      // @ts-expect-error MediaRecorder stored as stream
      const mr: MediaRecorder = recorderRef.current;
      if (mr.state !== 'inactive') {
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          resolve(blob);
        };
        mr.stop();
        // @ts-expect-error
        mr.stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      } else {
        resolve(null);
      }
      if (timerRef.current) clearInterval(timerRef.current);
      setRecording(false);
      setDuration(0);
      recorderRef.current = null;
    });
  }, []);

  return { recording, duration, start, stop };
}

const DISAPPEARING_OPTIONS = [
  { label: 'Off',   value: null },
  { label: '1 min', value: 60 },
  { label: '1 hr',  value: 3600 },
  { label: '24 hr', value: 86400 },
  { label: '7 d',   value: 604800 },
];

export function MessageComposer({ roomId, roomType, onSend, onTyping, meId }: Props) {
  const [content,   setContent]   = useState('');
  const [viewOnce,  setViewOnce]  = useState(false);
  const [expiresSec, setExpiresSec] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { userId } = useAuth();
  const voice = useVoiceRecorder();

  const canCalls    = roomType === 'merchant_private';
  const canFiles    = true;
  const canVoice    = true;

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
    // auto-resize
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
    try {
      const att = await uploadAttachment(roomId, userId, file);
      const isImage = file.type.startsWith('image/');
      onSend(isImage ? '🖼 Image' : `📎 ${file.name}`, { attachmentId: att.id, viewOnce });
    } catch (err) {
      toast.error('Upload failed: ' + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [roomId, userId, onSend, viewOnce]);

  const handleVoiceToggle = useCallback(async () => {
    if (voice.recording) {
      const blob = await voice.stop();
      if (!blob || !userId) return;
      setUploading(true);
      try {
        const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
        const att = await uploadAttachment(roomId, userId, file, {
          durationMs: voice.duration * 1000,
        });
        onSend('🎙 Voice message', { attachmentId: att.id });
      } catch (err) {
        toast.error('Voice upload failed');
      } finally {
        setUploading(false);
      }
    } else {
      voice.start();
    }
  }, [voice, userId, roomId, onSend]);

  return (
    <div className="border-t border-border/50 bg-card px-4 py-3">
      {/* Extras bar */}
      {showExtras && (
        <div className="flex items-center gap-3 mb-2 pb-2 border-b border-border/30">
          {/* Disappearing timer */}
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
          {/* View once */}
          <button
            onClick={() => setViewOnce((v) => !v)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
              viewOnce
                ? 'bg-violet-500 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            <Eye className="h-3 w-3" /> View once
          </button>
        </div>
      )}

      {/* Voice recording bar */}
      {voice.recording && (
        <div className="flex items-center gap-3 mb-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/20">
          <span className="flex h-2 w-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-xs font-semibold text-destructive">
            Recording {voice.duration}s
          </span>
          <button onClick={handleVoiceToggle} className="ml-auto">
            <StopCircle className="h-5 w-5 text-destructive" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* File attach */}
        {canFiles && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            />
            <Button
              variant="ghost" size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground/60 hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </>
        )}

        {/* Extras toggle */}
        <Button
          variant="ghost" size="icon"
          className={cn(
            'h-9 w-9 shrink-0 text-muted-foreground/60 hover:text-foreground',
            showExtras && 'text-primary',
          )}
          onClick={() => setShowExtras((v) => !v)}
        >
          <Clock className="h-4 w-4" />
        </Button>

        {/* Text area */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKey}
            placeholder="Type a message..."
            rows={1}
            className="w-full resize-none bg-muted/50 rounded-xl border border-border/30 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40 max-h-40 overflow-y-auto"
            style={{ height: 'auto' }}
          />
          {(viewOnce || expiresSec) && (
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              {viewOnce && <span className="text-[10px] text-violet-500">👁</span>}
              {expiresSec && <span className="text-[10px] text-amber-500">⏱</span>}
            </div>
          )}
        </div>

        {/* Voice note */}
        {canVoice && !content.trim() && (
          <Button
            variant="ghost" size="icon"
            className={cn(
              'h-9 w-9 shrink-0',
              voice.recording
                ? 'text-destructive'
                : 'text-muted-foreground/60 hover:text-foreground',
            )}
            onClick={handleVoiceToggle}
            disabled={uploading}
          >
            {voice.recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}

        {/* Send */}
        {content.trim() && (
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl"
            onClick={handleSend}
            disabled={uploading}
          >
            {uploading
              ? <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              : <Send className="h-4 w-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
