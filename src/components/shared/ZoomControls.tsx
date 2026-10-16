import { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { applyZoom, getStoredZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '@/lib/app-zoom';
import { cn } from '@/lib/utils';

// The zoom stepper shared by the merchant top bar and the customer portal. Both drive the same
// app-wide zoom (lib/app-zoom), which main.tsx re-applies on every load.
export function ZoomControls({ className, showPercent = 'md' }: { className?: string; showPercent?: 'md' | 'always' }) {
  const [zoomLevel, setZoomLevel] = useState<number>(() => getStoredZoom());

  useEffect(() => {
    applyZoom(zoomLevel);
  }, [zoomLevel]);

  const handleZoom = (direction: 'in' | 'out') => {
    setZoomLevel((z) => applyZoom(direction === 'in' ? z + ZOOM_STEP : z - ZOOM_STEP));
  };

  return (
    <div className={cn('flex items-center gap-0.5 bg-muted rounded-md p-0.5', className)}>
      <button
        onClick={() => handleZoom('out')}
        title="Zoom out"
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background transition-all"
        disabled={zoomLevel <= ZOOM_MIN}
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <span className={cn('text-[9px] font-semibold text-muted-foreground px-0.5 min-w-[24px] text-center', showPercent === 'md' && 'hidden md:inline')}>
        {Math.round(zoomLevel * 100)}%
      </span>
      <button
        onClick={() => handleZoom('in')}
        title="Zoom in"
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background transition-all"
        disabled={zoomLevel >= ZOOM_MAX}
      >
        <ZoomIn className="h-4 w-4" />
      </button>
    </div>
  );
}
