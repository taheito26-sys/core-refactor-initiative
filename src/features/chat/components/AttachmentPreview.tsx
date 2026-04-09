// ─── AttachmentPreview ────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Download, Eye, EyeOff, FileText, Loader2, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAttachment, getSignedUrl, markMessageViewed } from '../api/chat';
import type { ChatAttachment, ChatMessage } from '../types';
import { SecureWatermark } from './SecureWatermark';

const VIEW_ONCE_WINDOW_SECONDS = 8;

interface Props {
  message: ChatMessage;
  isMe: boolean;
  viewerId: string;
  onImageOpen?: (src: string) => void;
  watermarkEnabled?: boolean;
}

export function AttachmentPreview({ message, isMe, viewerId, onImageOpen, watermarkEnabled = false }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<ChatAttachment | null>(message.attachment ?? null);
  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(VIEW_ONCE_WINDOW_SECONDS);
  const [loading, setLoading] = useState(true);

  const isViewOnce = message.view_once;
  const viewedByMe = message.viewed_by.includes(viewerId);
  const openedByAnyone = message.viewed_by.length > 0;
  const consumed = isMe ? openedByAnyone : viewedByMe;
  const canResolveAttachment = !isViewOnce || (isMe && !consumed) || revealed;

  useEffect(() => {
    setRevealed(false);
    setSecondsLeft(VIEW_ONCE_WINDOW_SECONDS);
  }, [message.id]);

  useEffect(() => {
    let cancelled = false;

    if (!canResolveAttachment) {
      setLoading(false);
      setSignedUrl(null);
      return () => {
        cancelled = true;
      };
    }

    async function resolve() {
      setLoading(true);
      try {
        let att = message.attachment ?? null;

        if (!att) {
          att = await getAttachment(message.id);
          if (cancelled) return;
          if (att) setAttachment(att);
        }

        if (!att?.storage_path) {
          setLoading(false);
          return;
        }

        if (att.signed_url) {
          setSignedUrl(att.signed_url);
          setLoading(false);
          return;
        }

        const url = await getSignedUrl(att.storage_path);
        if (!cancelled) {
          setSignedUrl(url);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [message.id, message.attachment, canResolveAttachment]);

  useEffect(() => {
    if (!revealed || !isViewOnce || isMe) return;

    const interval = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          setRevealed(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [revealed, isViewOnce, isMe]);

  const handleReveal = async () => {
    if (isMe || revealed || viewedByMe) return;

    setSecondsLeft(VIEW_ONCE_WINDOW_SECONDS);
    setRevealed(true);
    await markMessageViewed(message.id).catch(() => {});
  };

  if (isViewOnce && consumed && !revealed) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs italic text-muted-foreground/70">
        <EyeOff className="h-4 w-4 shrink-0" />
        <span>{isMe ? 'Opened once' : 'Opened once · attachment removed'}</span>
      </div>
    );
  }

  if (isViewOnce && !isMe && !revealed) {
    return (
      <button
        type="button"
        onClick={handleReveal}
        className="flex items-center gap-2.5 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-left text-primary transition-colors hover:bg-primary/15 active:scale-[0.98]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
          <Shield className="h-4 w-4" />
        </span>
        <span>
          <span className="block text-xs font-semibold">View once</span>
          <span className="block text-[10px] text-muted-foreground">Tap once to reveal</span>
        </span>
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 min-w-[140px] py-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary/60" />
        <span className="text-xs text-muted-foreground">Loading attachment...</span>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs italic text-muted-foreground/70">
        <FileText className="h-4 w-4 opacity-50" />
        <span>Attachment unavailable</span>
      </div>
    );
  }

  const effectiveAtt = attachment ?? message.attachment;
  const isImage = effectiveAtt?.mime_type?.startsWith('image/');
  const previewUrl = effectiveAtt?.thumbnail_signed_url ?? signedUrl;

  if (isImage) {
    return (
      <div className="relative overflow-hidden rounded-xl group/img">
        <img
          src={previewUrl}
          alt={effectiveAtt?.file_name ?? 'image'}
          className="max-w-[260px] max-h-[320px] cursor-pointer rounded-xl object-cover shadow-sm transition-shadow hover:shadow-md"
          onClick={() => onImageOpen ? onImageOpen(signedUrl) : window.open(signedUrl, '_blank')}
          loading="lazy"
        />

        {(watermarkEnabled || message.watermark_text) && (
          <SecureWatermark
            enabled
            customText={message.watermark_text ?? undefined}
            density="medium"
            overlay
            surface="media"
          />
        )}

        {isViewOnce && (
          <div className="absolute left-2 top-2 z-[60] inline-flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm">
            <Eye className="h-2.5 w-2.5" />
            {isMe ? '1 view' : `${secondsLeft}s`}
          </div>
        )}
      </div>
    );
  }

  return (
    <a
      href={signedUrl}
      download={effectiveAtt?.file_name}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'relative flex items-center gap-3 overflow-hidden rounded-2xl px-3.5 py-2.5 text-xs transition-all hover:shadow-sm',
        isMe
          ? 'bg-primary-foreground/15 hover:bg-primary-foreground/25'
          : 'border border-border/30 bg-muted/80 hover:bg-muted',
      )}
    >
      {(watermarkEnabled || message.watermark_text) && (
        <SecureWatermark
          enabled
          customText={message.watermark_text ?? undefined}
          density="medium"
          overlay
          surface="media"
        />
      )}

      <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <FileText className="h-4 w-4" />
      </div>

      <div className="relative z-10 min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-tight">
          {effectiveAtt?.file_name ?? 'File'}
        </p>
        {effectiveAtt?.file_size && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
            {(effectiveAtt.file_size / 1024).toFixed(0)} KB
          </p>
        )}
      </div>

      <div className="relative z-10 flex items-center gap-2">
        {isViewOnce && (
          <span className="inline-flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm">
            <Eye className="h-2.5 w-2.5" />
            {isMe ? '1 view' : `${secondsLeft}s`}
          </span>
        )}
        <Download className="h-4 w-4 shrink-0 opacity-40" />
      </div>
    </a>
  );
}
