// ─── AttachmentPreview ────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { FileText, Download, Eye, Image as ImageIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAttachment, getSignedUrl, markMessageViewed } from '../api/chat';
import type { ChatMessage, ChatAttachment } from '../types';

interface Props {
  message: ChatMessage;
  isMe:    boolean;
  onImageOpen?: (src: string) => void;
}

export function AttachmentPreview({ message, isMe, onImageOpen }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<ChatAttachment | null>(message.attachment ?? null);
  const [viewed,    setViewed]    = useState(false);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        // If attachment is already enriched on the message, use it directly
        let att = message.attachment ?? null;

        // If no attachment enriched, fetch it by message ID
        if (!att) {
          att = await getAttachment(message.id);
          if (cancelled) return;
          if (att) setAttachment(att);
        }

        if (!att?.storage_path) {
          setLoading(false);
          return;
        }

        // If the attachment already has a signed_url (from getAttachment), use it
        if (att.signed_url) {
          setSignedUrl(att.signed_url);
          setLoading(false);
          return;
        }

        // Otherwise generate a signed URL
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
    return () => { cancelled = true; };
  }, [message.id, message.attachment]);

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
      <div className="flex items-center gap-2 text-xs text-muted-foreground/70 italic py-1">
        <FileText className="h-4 w-4 opacity-50" /> Attachment unavailable
      </div>
    );
  }

  const effectiveAtt = attachment ?? message.attachment;
  const isImage  = effectiveAtt?.mime_type?.startsWith('image/');
  const isViewOnce = message.view_once;

  // View-once: tap to reveal
  if (isViewOnce && !viewed && !isMe) {
    return (
      <button
        onClick={async () => {
          setViewed(true);
          await markMessageViewed(message.id).catch(() => {});
        }}
        className={cn(
          'flex items-center gap-2.5 px-4 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-95',
          'bg-gradient-to-r from-violet-500/15 to-purple-500/10',
          'border border-violet-400/30 text-violet-600 dark:text-violet-400',
          'hover:from-violet-500/25 hover:to-purple-500/20',
          'shadow-sm',
        )}
      >
        <div className="h-8 w-8 rounded-full bg-violet-500/20 flex items-center justify-center">
          <Eye className="h-4 w-4" />
        </div>
        <div className="text-left">
          <span className="block text-xs font-bold">View once</span>
          <span className="block text-[10px] opacity-60">Tap to reveal</span>
        </div>
      </button>
    );
  }

  // Image preview
  if (isImage) {
    return (
      <div className="relative group/img">
        <img
          src={signedUrl}
          alt={effectiveAtt?.file_name ?? 'image'}
          className="max-w-[260px] max-h-[320px] rounded-xl object-cover cursor-pointer shadow-sm hover:shadow-md transition-shadow"
          onClick={() => window.open(signedUrl, '_blank')}
          loading="lazy"
        />
        {isViewOnce && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-semibold flex items-center gap-1">
            <Eye className="h-2.5 w-2.5" /> 1
          </div>
        )}
      </div>
    );
  }

  // File preview
  return (
    <a
      href={signedUrl}
      download={effectiveAtt?.file_name}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs transition-all hover:shadow-sm',
        isMe
          ? 'bg-primary-foreground/15 hover:bg-primary-foreground/25'
          : 'bg-muted/80 border border-border/30 hover:bg-muted',
      )}
    >
      <div className={cn(
        'h-9 w-9 rounded-xl flex items-center justify-center shrink-0',
        isMe ? 'bg-primary-foreground/20' : 'bg-primary/10',
      )}>
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-[13px] leading-tight">
          {effectiveAtt?.file_name ?? 'File'}
        </p>
        {effectiveAtt?.file_size && (
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            {(effectiveAtt.file_size / 1024).toFixed(0)} KB
          </p>
        )}
      </div>
      <Download className="h-4 w-4 shrink-0 opacity-40" />
    </a>
  );
}
