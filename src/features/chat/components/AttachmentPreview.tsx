// ─── AttachmentPreview ────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { FileText, Download, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAttachment, getSignedUrl } from '../api/chat';
import { markMessageViewed } from '../api/chat';
import type { ChatMessage } from '../types';

interface Props {
  message: ChatMessage;
  isMe:    boolean;
}

export function AttachmentPreview({ message, isMe }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [viewed,    setViewed]    = useState(false);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!message.attachment?.storage_path) {
      setLoading(false);
      return;
    }
    getSignedUrl(message.attachment.storage_path)
      .then((url) => { setSignedUrl(url); setLoading(false); })
      .catch(() => setLoading(false));
  }, [message.attachment?.storage_path]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 min-w-[120px]">
        <div className="h-4 w-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground italic">
        <FileText className="h-4 w-4" /> Attachment unavailable
      </div>
    );
  }

  const isImage  = message.attachment?.mime_type?.startsWith('image/');
  const isViewOnce = message.view_once;

  if (isViewOnce && !viewed && !isMe) {
    return (
      <button
        onClick={async () => {
          setViewed(true);
          await markMessageViewed(message.id).catch(() => {});
        }}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold',
          isMe ? 'bg-primary-foreground/20' : 'bg-violet-500/15 border border-violet-400/30 text-violet-600',
        )}
      >
        <Eye className="h-4 w-4" />
        Tap to view once
      </button>
    );
  }

  if (isImage) {
    return (
      <img
        src={signedUrl}
        alt="image"
        className="max-w-[240px] max-h-[300px] rounded-xl object-cover cursor-pointer"
        onClick={() => window.open(signedUrl, '_blank')}
      />
    );
  }

  return (
    <a
      href={signedUrl}
      download={message.attachment?.file_name}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-xl text-xs',
        isMe ? 'bg-primary-foreground/20' : 'bg-muted border border-border/30',
      )}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate max-w-[160px]">
        {message.attachment?.file_name ?? 'File'}
      </span>
      <Download className="h-3.5 w-3.5 shrink-0 opacity-60" />
    </a>
  );
}
