// ─── MessageComposer — Modern WhatsApp-style — All 40 phases ─────────────
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Send, Paperclip, Mic, X, Clock, Eye, Shield,
  Camera, Plus, Timer, EyeOff, Smile, Droplets,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { uploadAttachment, validateAttachment } from '../api/chat';
import type { ChatRoomPolicy, ChatRoomType } from '../types';
import { validateFileUpload } from '../lib/privacy-engine';
import { toast } from 'sonner';

interface Props {
  roomId:   string;
  roomType: ChatRoomType;
  roomPolicy?: ChatRoomPolicy | null;
  onSend:   (content: string, opts?: {
    replyToId?:   string;
    expiresAt?:   string;
    viewOnce?:    boolean;
    watermarkText?: string | null;
    attachmentId?: string;
    type?:        string;
    metadata?:    Record<string, unknown>;
  }) => void;
  onTyping: () => void;
  meId:     string;
  onPrivacyDashboard?: () => void;
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

// Phase 20: Emoji picker
const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: 'Recent', emojis: ['👍','❤️','😂','😮','😢','🙏','🔥','💯','👏','🎉'] },
  { label: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😮‍💨','🤥'] },
  { label: 'Gestures', emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏'] },
  { label: 'Objects', emojis: ['💰','💵','💴','💶','💷','💸','💳','🧾','📱','💻','⌨️','📧','📦','🔑','🔒','🔓','📎','✂️','📌','📍','🗂','📁','📊','📈','📉','🗓','⏰','⏳'] },
];

function EmojiPicker({ onSelect, onClose }: { onSelect: (e: string) => void; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState(0);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full mb-2 left-0 bg-popover border border-border rounded-2xl shadow-xl z-50 w-[280px] animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
        <div className="flex border-b border-border/50 px-1 pt-1">
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button key={cat.label} onClick={() => setActiveTab(i)}
              className={cn('flex-1 text-[9px] font-bold py-1.5 rounded-t-lg transition-colors',
                activeTab === i ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}>{cat.label}</button>
          ))}
        </div>
        <div className="grid grid-cols-8 gap-0.5 p-2 max-h-[200px] overflow-y-auto">
          {EMOJI_CATEGORIES[activeTab].emojis.map((e) => (
            <button key={e} onClick={() => { onSelect(e); onClose(); }}
              className="h-8 w-8 flex items-center justify-center text-lg hover:bg-muted rounded-md transition-colors hover:scale-110">
              {e}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function extractMediaMetadata(file: File): Promise<{
  width?: number;
  height?: number;
  durationMs?: number;
}> {
  if (file.type.startsWith('image/')) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('Image metadata unavailable'));
        image.src = objectUrl;
      });
      return dimensions;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const metadata = await new Promise<{ width?: number; height?: number; durationMs?: number }>((resolve, reject) => {
        const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
        media.preload = 'metadata';
        media.onloadedmetadata = () => {
          const next: { width?: number; height?: number; durationMs?: number } = {
            durationMs: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : undefined,
          };
          if (media instanceof HTMLVideoElement) {
            next.width = media.videoWidth || undefined;
            next.height = media.videoHeight || undefined;
          }
          resolve(next);
        };
        media.onerror = () => reject(new Error('Media metadata unavailable'));
        media.src = objectUrl;
      });
      return metadata;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return {};
}

async function createMediaThumbnail(file: File): Promise<Blob | null> {
  if (file.type.startsWith('image/')) {
    const objectUrl = URL.createObjectURL(file);
    try {
      return await new Promise<Blob | null>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const maxWidth = 480;
          const scale = Math.min(1, maxWidth / image.naturalWidth);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('Canvas unavailable'));
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.78);
        };
        image.onerror = () => reject(new Error('Thumbnail generation failed'));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  if (file.type.startsWith('video/')) {
    const objectUrl = URL.createObjectURL(file);
    try {
      return await new Promise<Blob | null>((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.onloadeddata = () => {
          const maxWidth = 480;
          const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((video.videoWidth || maxWidth) * scale));
          canvas.height = Math.max(1, Math.round((video.videoHeight || maxWidth * 0.56) * scale));
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('Canvas unavailable'));
            return;
          }
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72);
        };
        video.onerror = () => reject(new Error('Video thumbnail generation failed'));
        video.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return null;
}

export function MessageComposer({ roomId, roomType, roomPolicy, onSend, onTyping, meId, onPrivacyDashboard }: Props) {
  const [content, setContent]       = useState('');
  const [viewOnce, setViewOnce]     = useState(false);
  const [watermark, setWatermark]   = useState(false);
  const [expiresSec, setExpiresSec] = useState<number | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { userId } = useAuth();
  const voice = useVoiceRecorder();
  const canSendImages = roomPolicy?.allow_images ?? true;
  const canSendFiles = roomPolicy?.allow_files ?? true;
  const canSendVoiceNotes = roomPolicy?.allow_voice_notes ?? true;
  const canOpenAttachMenu = canSendImages || canSendFiles;

  const expiresAt = expiresSec
    ? new Date(Date.now() + expiresSec * 1000).toISOString()
    : undefined;
  const watermarkText = watermark ? `${meId.slice(0, 8)} · ${new Date().toISOString().split('T')[0]}` : null;

  // Phase 36: Send animation
  const [sendPulse, setSendPulse] = useState(false);

  useEffect(() => {
    if (!uploading) {
      setUploadProgress(0);
      return;
    }
    const timer = window.setInterval(() => {
      setUploadProgress((value) => Math.min(value + (value < 40 ? 11 : value < 70 ? 6 : 2), 92));
    }, 180);
    return () => window.clearInterval(timer);
  }, [uploading]);

  const beginUpload = useCallback((label: string) => {
    setUploadLabel(label);
    setUploadProgress(8);
    setUploading(true);
  }, []);

  const finishUpload = useCallback(async () => {
    setUploadProgress(100);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    setUploading(false);
    setUploadLabel(null);
  }, []);

  const validateUploadForRoom = useCallback((file: File, kind: 'image' | 'file' | 'voice') => {
    if (kind === 'image' && !canSendImages) {
      return { ok: false, error: 'Images and videos are disabled in this room' };
    }
    if (kind === 'file' && !canSendFiles) {
      return { ok: false, error: 'Document uploads are disabled in this room' };
    }
    if (kind === 'voice' && !canSendVoiceNotes) {
      return { ok: false, error: 'Voice notes are disabled in this room' };
    }
    const baseValidation = validateAttachment(file);
    if (!baseValidation.ok) return baseValidation;
    return validateFileUpload(file, {
      allowed_mime_types: roomPolicy?.allowed_mime_types ?? null,
      max_file_size_mb: roomPolicy?.max_file_size_mb ?? undefined,
    });
  }, [canSendFiles, canSendImages, canSendVoiceNotes, roomPolicy?.allowed_mime_types, roomPolicy?.max_file_size_mb]);

  const handleSend = useCallback(() => {
    if (!content.trim()) return;
    onSend(content, { expiresAt, viewOnce, watermarkText });
    setContent('');
    setSendPulse(true);
    setTimeout(() => setSendPulse(false), 300);
    textareaRef.current?.focus();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [content, onSend, expiresAt, viewOnce, watermarkText]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Phase 24: Smooth composer height transition
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    onTyping();
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 176)}px`;
  }, [onTyping]);

  // Phase 22: Paste-image support
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || !userId) return;
    if (!canSendImages) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const validation = validateUploadForRoom(file, 'image');
        if (!validation.ok) {
          toast.error(validation.error);
          return;
        }
        beginUpload('Uploading pasted image');
        try {
          const mediaMetadata = await extractMediaMetadata(file);
          const thumbnailBlob = await createMediaThumbnail(file).catch(() => null);
          const att = await uploadAttachment(roomId, userId, file, { ...mediaMetadata, thumbnailBlob });
          setUploadProgress(94);
          onSend('🖼 Image', {
            attachmentId: att.id,
            viewOnce,
            watermarkText,
            type: 'image',
            metadata: {
              file_name: file.name,
              file_size: file.size,
              mime_type: file.type,
              width: mediaMetadata.width,
              height: mediaMetadata.height,
            },
          });
        } catch (err) {
          toast.error('Paste upload failed');
        } finally {
          await finishUpload();
        }
        return;
      }
    }
  }, [beginUpload, canSendImages, finishUpload, roomId, userId, onSend, validateUploadForRoom, viewOnce, watermarkText]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    const isImage = file.type.startsWith('image/') || file.type.startsWith('video/');
    const v = validateUploadForRoom(file, isImage ? 'image' : 'file');
    if (!v.ok) { toast.error(v.error); return; }
    beginUpload(isImage ? 'Uploading media' : 'Uploading document');
    setShowAttachMenu(false);
    try {
      const mediaMetadata = isImage || file.type.startsWith('audio/')
        ? await extractMediaMetadata(file)
        : undefined;
      const thumbnailBlob = isImage ? await createMediaThumbnail(file).catch(() => null) : null;
      const att = await uploadAttachment(roomId, userId, file, { ...mediaMetadata, thumbnailBlob });
      setUploadProgress(94);
      onSend(
        isImage ? '🖼 Image' : `📎 ${file.name}`,
        {
          attachmentId: att.id, viewOnce, watermarkText,
          type: isImage ? 'image' : 'file',
          metadata: {
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            width: mediaMetadata?.width,
            height: mediaMetadata?.height,
            duration_ms: mediaMetadata?.durationMs,
          },
        },
      );
    } catch (err) {
      toast.error('Upload failed: ' + (err as Error).message);
    } finally {
      await finishUpload();
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  }, [beginUpload, finishUpload, roomId, userId, onSend, validateUploadForRoom, viewOnce, watermarkText]);

  // Phase 21: Drag-and-drop file upload
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback(() => setIsDragOver(false), []);
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !userId) return;
    const isImage = file.type.startsWith('image/') || file.type.startsWith('video/');
    const v = validateUploadForRoom(file, isImage ? 'image' : 'file');
    if (!v.ok) { toast.error(v.error); return; }
    beginUpload(isImage ? 'Uploading dropped media' : 'Uploading dropped file');
    try {
      const mediaMetadata = isImage || file.type.startsWith('audio/')
        ? await extractMediaMetadata(file)
        : undefined;
      const thumbnailBlob = isImage ? await createMediaThumbnail(file).catch(() => null) : null;
      const att = await uploadAttachment(roomId, userId, file, { ...mediaMetadata, thumbnailBlob });
      setUploadProgress(94);
      onSend(
        isImage ? '🖼 Image' : `📎 ${file.name}`,
        {
          attachmentId: att.id, viewOnce, watermarkText,
          type: isImage ? 'image' : 'file',
          metadata: {
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            width: mediaMetadata?.width,
            height: mediaMetadata?.height,
            duration_ms: mediaMetadata?.durationMs,
          },
        },
      );
    } catch {
      toast.error('Drop upload failed');
    } finally {
      await finishUpload();
    }
  }, [beginUpload, finishUpload, roomId, userId, onSend, validateUploadForRoom, viewOnce, watermarkText]);

  const handleVoiceSend = useCallback(async () => {
    const recordedDurationSec = voice.duration;
    const blob = await voice.stop();
    if (!blob || !userId) return;
    const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
    const validation = validateUploadForRoom(file, 'voice');
    if (!validation.ok) {
      toast.error(validation.error);
      return;
    }
    beginUpload('Sending voice note');
    try {
      const mediaMetadata = await extractMediaMetadata(file).catch(() => ({} as Record<string, unknown>));
      const durMs = ('durationMs' in mediaMetadata ? (mediaMetadata as { durationMs?: number }).durationMs : undefined) ?? recordedDurationSec * 1000;
      const att = await uploadAttachment(roomId, userId, file, {
        durationMs: durMs,
      });
      setUploadProgress(94);
      onSend('🎙 Voice message', {
        attachmentId: att.id, type: 'voice_note', watermarkText,
        metadata: { duration_ms: durMs },
      });
    } catch (error) {
      toast.error((error as Error).message || 'Voice upload failed');
    } finally {
      await finishUpload();
    }
  }, [beginUpload, finishUpload, onSend, roomId, userId, validateUploadForRoom, voice, watermarkText]);

  const closeMenus = useCallback(() => {
    setShowAttachMenu(false);
    setShowTimerPicker(false);
    setShowEmojiPicker(false);
  }, []);

  // ── Recording UI ─────────────────────────────────────────────────────────
  if (voice.recording) {
    return (
      <div className="border-t border-border/50 bg-card px-3 py-2.5">
        <div className="flex items-center gap-3">
          <button onClick={voice.cancel}
            className="h-10 w-10 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors">
            <X className="h-5 w-5" />
          </button>
          <div className="flex-1 flex items-center gap-3 px-4 py-2 rounded-full bg-muted/50">
            <span className="flex h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-medium text-destructive">{formatDuration(voice.duration)}</span>
            <div className="flex-1 flex items-center gap-0.5 h-4">
              {Array.from({ length: 30 }, (_, i) => (
                <div key={i} className="w-0.5 bg-destructive/40 rounded-full"
                  style={{ height: `${Math.max(4, Math.random() * 16)}px`, opacity: i < (voice.duration % 30) ? 1 : 0.3 }} />
              ))}
            </div>
          </div>
          <button onClick={handleVoiceSend} disabled={uploading}
            className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-md hover:opacity-90 transition-opacity">
            {uploading
              ? <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              : <Send className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>
    );
  }

  const hasActiveMode = viewOnce || expiresSec || watermark;

  // ── Main composer ────────────────────────────────────────────────────────
  return (
    <div
      className="border-t border-border/50 bg-card relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Phase 21: Drag overlay */}
      {isDragOver && canOpenAttachMenu && (
        <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex items-center justify-center backdrop-blur-sm">
          <div className="text-sm font-semibold text-primary flex items-center gap-2">
            <Paperclip className="h-5 w-5" />
            Drop file to upload
          </div>
        </div>
      )}

      {/* Active mode chips */}
      {hasActiveMode && (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          {viewOnce && (
            <button onClick={() => setViewOnce(false)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-400/20 hover:bg-violet-500/25 transition-colors">
              <Eye className="h-3 w-3" /> View once <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          )}
          {watermark && (
            <button onClick={() => setWatermark(false)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-400/20 hover:bg-cyan-500/25 transition-colors">
              <Droplets className="h-3 w-3" /> Watermarked <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          )}
          {expiresSec && (
            <button onClick={() => setExpiresSec(null)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-400/20 hover:bg-amber-500/25 transition-colors">
              <Timer className="h-3 w-3" />
              {DISAPPEARING_OPTIONS.find((o) => o.value === expiresSec)?.label ?? 'Timer'}
              <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          )}
        </div>
      )}

      {uploading && (
        <div className="px-3 pt-2">
          <div className="rounded-2xl border border-primary/15 bg-primary/5 px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold text-foreground">
                {uploadLabel ?? 'Uploading attachment'}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground">
                {Math.round(uploadProgress)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {!canOpenAttachMenu && !canSendVoiceNotes && (
        <div className="px-4 pt-2">
          <span className="text-[10px] font-medium text-muted-foreground">
            This room is text-only by policy.
          </span>
        </div>
      )}

      {/* Phase 23: Character count */}
      {content.length > 3800 && (
        <div className="px-4 pt-1">
          <span className={cn('text-[10px] font-medium',
            content.length > 4000 ? 'text-destructive' : 'text-muted-foreground/50'
          )}>
            {content.length}/4096
          </span>
        </div>
      )}

      <div className="flex items-end gap-1 px-2.5 py-2">
        {/* Emoji picker */}
        <div className="relative">
          <button
            onClick={() => { setShowEmojiPicker((v) => !v); setShowAttachMenu(false); setShowTimerPicker(false); }}
            className={cn(
              'h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all shrink-0',
              showEmojiPicker && 'text-primary bg-primary/10',
            )}
          >
            <Smile className="h-4.5 w-4.5" />
          </button>
          {showEmojiPicker && (
            <EmojiPicker
              onSelect={(e) => setContent((c) => c + e)}
              onClose={() => setShowEmojiPicker(false)}
            />
          )}
        </div>

        {/* Attach menu */}
        <div className="relative">
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip" />
          <input ref={imageInputRef} type="file" className="hidden" onChange={handleFileSelect}
            accept="image/*,video/*" />
          <button
            onClick={() => {
              if (!canOpenAttachMenu) {
                toast.error('Attachments are disabled in this room');
                return;
              }
              setShowAttachMenu((v) => !v);
              setShowTimerPicker(false);
              setShowEmojiPicker(false);
            }}
            disabled={!canOpenAttachMenu}
            className={cn(
              'h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all shrink-0',
              !canOpenAttachMenu && 'opacity-40 cursor-not-allowed hover:text-muted-foreground hover:bg-transparent',
              showAttachMenu && 'text-primary bg-primary/10',
            )}
          >
            <Plus className={cn('h-4.5 w-4.5 transition-transform duration-200', showAttachMenu && 'rotate-45')} />
          </button>
          {showAttachMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={closeMenus} />
              <div className="absolute bottom-full mb-2 left-0 bg-popover border border-border rounded-2xl shadow-xl p-1.5 min-w-[180px] z-50 animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
                <button
                  disabled={!canSendImages}
                  onClick={() => { imageInputRef.current?.click(); setShowAttachMenu(false); }}
                  className={cn(
                    'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-colors',
                    canSendImages ? 'hover:bg-muted' : 'opacity-40 cursor-not-allowed',
                  )}>
                  <div className="h-9 w-9 rounded-full bg-violet-500/15 flex items-center justify-center">
                    <Camera className="h-4.5 w-4.5 text-violet-500" />
                  </div>
                  <span className="font-medium">Photo & Video</span>
                </button>
                <button
                  disabled={!canSendFiles}
                  onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                  className={cn(
                    'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-colors',
                    canSendFiles ? 'hover:bg-muted' : 'opacity-40 cursor-not-allowed',
                  )}>
                  <div className="h-9 w-9 rounded-full bg-blue-500/15 flex items-center justify-center">
                    <Paperclip className="h-4.5 w-4.5 text-blue-500" />
                  </div>
                  <span className="font-medium">Document</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Privacy & Security button */}
        {onPrivacyDashboard && (
          <button
            onClick={onPrivacyDashboard}
            className="h-9 w-9 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all shrink-0"
            title="Privacy & Security"
          >
            <Shield className="h-4.5 w-4.5" />
          </button>
        )}

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            placeholder="Type a message"
            rows={1}
            className="w-full resize-none bg-muted/40 rounded-3xl border-none px-3.5 py-3 text-base sm:px-4 sm:py-2.5 sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50 max-h-44 overflow-y-auto pr-16 sm:pr-20 transition-[height,box-shadow] duration-200"
            style={{ height: 'auto' }}
          />

          {/* Inline action buttons */}
          <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 z-10 sm:flex">
            <button onClick={() => setWatermark((v) => !v)} title={watermark ? 'Watermark: ON' : 'Watermark: OFF'}
              className={cn('h-6.5 w-6.5 rounded-full flex items-center justify-center transition-all',
                watermark ? 'bg-cyan-500/20 text-cyan-500' : 'text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/60')}>
              <Droplets className="h-3 w-3" />
            </button>
            <button onClick={() => setViewOnce((v) => !v)} title={viewOnce ? 'View once: ON' : 'View once: OFF'}
              className={cn('h-6.5 w-6.5 rounded-full flex items-center justify-center transition-all',
                viewOnce ? 'bg-violet-500/20 text-violet-500' : 'text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/60')}>
              {viewOnce ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
            <div className="relative">
              <button onClick={() => { setShowTimerPicker((v) => !v); setShowAttachMenu(false); setShowEmojiPicker(false); }} title="Disappearing message"
                className={cn('h-6.5 w-6.5 rounded-full flex items-center justify-center transition-all',
                  expiresSec ? 'bg-amber-500/20 text-amber-500' : 'text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/60')}>
                <Timer className="h-3 w-3" />
              </button>
              {showTimerPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeMenus} />
                  <div className="absolute bottom-full mb-2 right-0 bg-popover border border-border rounded-2xl shadow-xl p-1.5 min-w-[140px] z-50 animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
                    <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Auto-delete after</p>
                    {DISAPPEARING_OPTIONS.map((opt) => (
                      <button key={String(opt.value)}
                        onClick={() => { setExpiresSec(opt.value); setShowTimerPicker(false); }}
                        className={cn('flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm transition-colors',
                          expiresSec === opt.value ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold' : 'hover:bg-muted text-foreground')}>
                        <span className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                          expiresSec === opt.value ? 'bg-amber-500/20 text-amber-600' : 'bg-muted text-muted-foreground')}>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Voice OR Send button — Phase 36: send pulse */}
        {content.trim() ? (
          <button onClick={handleSend} disabled={uploading || content.length > 4096}
            className={cn(
              'h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-sm hover:opacity-90 transition-all shrink-0',
              sendPulse && 'scale-90',
            )}>
            {uploading
              ? <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              : <Send className="h-4.5 w-4.5" />}
          </button>
        ) : (
          <button
            onClick={() => {
              if (!canSendVoiceNotes) {
                toast.error('Voice notes are disabled in this room');
                return;
              }
              void voice.start();
            }}
            disabled={uploading || !canSendVoiceNotes}
            className={cn(
              'h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground transition-colors shrink-0',
              canSendVoiceNotes ? 'hover:text-foreground hover:bg-muted/50' : 'opacity-40 cursor-not-allowed',
            )}>
            <Mic className="h-4.5 w-4.5" />
          </button>
        )}
      </div>
    </div>
  );
}
