import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { usePhotoUrl } from '../hooks';

/** A reefer-screen photo from private storage (signed URL); tapping it opens it full size. */
export function PhotoThumb({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const { data: url, isLoading, isError } = usePhotoUrl(path);
  const [open, setOpen] = useState(false);

  if (isLoading) return <Skeleton className={cn('h-16 w-16 rounded-lg', className)} />;
  if (isError || !url) {
    return (
      <div className={cn('flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground', className)} title={alt}>
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn('overflow-hidden rounded-lg bg-muted', className)} aria-label={alt}>
        <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-2">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">{alt}</DialogDescription>
          <img src={url} alt={alt} className="max-h-[80vh] w-full rounded-md object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
