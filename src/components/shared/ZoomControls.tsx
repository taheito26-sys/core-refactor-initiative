import { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { applyZoom, getStoredZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '@/lib/app-zoom';
import { cn } from '@/lib/utils';

interface ZoomControlsProps {
  className?: string;
  showPercent?: 'md' | 'always';
  /** 'hero' is the colourful stepper for the dark customer headers; the default is the plain merchant top-bar one. */
  variant?: 'default' | 'hero';
  /** Small caption in the middle of the hero stepper. */
  label?: string;
  /** Smaller buttons, for the one-line phone top bar. */
  compact?: boolean;
}

// The zoom stepper shared by the merchant top bar and the customer portal. Both drive the same
// app-wide zoom (lib/app-zoom), which main.tsx re-applies on every load.
export function ZoomControls({ className, showPercent = 'md', variant = 'default', label, compact = false }: ZoomControlsProps) {
  const [zoomLevel, setZoomLevel] = useState<number>(() => getStoredZoom());

  useEffect(() => {
    applyZoom(zoomLevel);
  }, [zoomLevel]);

  const handleZoom = (direction: 'in' | 'out') => {
    setZoomLevel((z) => applyZoom(direction === 'in' ? z + ZOOM_STEP : z - ZOOM_STEP));
  };

  if (variant === 'hero') {
    return (
      <div className={cn('zh', className)} role="group" aria-label={label || 'Zoom'}>
        <button type="button" className="zh-btn zh-out" onClick={() => handleZoom('out')} title="Zoom out" aria-label="Zoom out" disabled={zoomLevel <= ZOOM_MIN}>
          <ZoomOut strokeWidth={2.4} />
        </button>
        <div className="zh-mid">
          <b>{Math.round(zoomLevel * 100)}%</b>
          {label ? <small>{label}</small> : null}
        </div>
        <button type="button" className="zh-btn zh-in" onClick={() => handleZoom('in')} title="Zoom in" aria-label="Zoom in" disabled={zoomLevel >= ZOOM_MAX}>
          <ZoomIn strokeWidth={2.4} />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center bg-muted rounded-md', compact ? 'gap-0 p-[2px]' : 'gap-0.5 p-0.5', className)}>
      <button
        onClick={() => handleZoom('out')}
        title="Zoom out"
        className={cn('rounded text-muted-foreground hover:text-foreground hover:bg-background transition-all', compact ? 'p-[3px]' : 'p-1')}
        disabled={zoomLevel <= ZOOM_MIN}
      >
        <ZoomOut className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
      </button>
      <span className={cn('text-[9px] font-semibold text-muted-foreground px-0.5 min-w-[24px] text-center', showPercent === 'md' && 'hidden md:inline')}>
        {Math.round(zoomLevel * 100)}%
      </span>
      <button
        onClick={() => handleZoom('in')}
        title="Zoom in"
        className={cn('rounded text-muted-foreground hover:text-foreground hover:bg-background transition-all', compact ? 'p-[3px]' : 'p-1')}
        disabled={zoomLevel >= ZOOM_MAX}
      >
        <ZoomIn className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
      </button>
    </div>
  );
}
