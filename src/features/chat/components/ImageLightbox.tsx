// ─── ImageLightbox — Phase 18: Full-screen image viewer ──────────────────
import { useCallback, useEffect, useState, useRef } from 'react';
import { X, Download, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: Props) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.min(5, Math.max(0.5, s + (e.deltaY > 0 ? -0.15 : 0.15))));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (scale <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    posStart.current = { ...position };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [scale, position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setPosition({
      x: posStart.current.x + (e.clientX - dragStart.current.x),
      y: posStart.current.y + (e.clientY - dragStart.current.y),
    });
  }, [dragging]);

  const handlePointerUp = useCallback(() => setDragging(false), []);

  const handleDownload = useCallback(() => {
    const a = document.createElement('a');
    a.href = src;
    a.download = alt || 'image';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [src, alt]);

  const resetView = useCallback(() => {
    setScale(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col animate-in fade-in-0 duration-200">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-white/70 text-sm font-medium truncate max-w-[50%]">
          {alt || 'Image'}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setScale((s) => Math.min(5, s + 0.5))}
            className="h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.5))}
            className="h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button onClick={() => setRotation((r) => r + 90)}
            className="h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
            <RotateCw className="h-4 w-4" />
          </button>
          <button onClick={handleDownload}
            className="h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
            <Download className="h-4 w-4" />
          </button>
          <button onClick={onClose}
            className="h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors ml-2">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Image area */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            if (scale > 1) resetView();
            else onClose();
          }
        }}
      >
        <img
          src={src}
          alt={alt || 'Full size image'}
          className={cn('max-w-[90vw] max-h-[85vh] object-contain select-none transition-transform', !dragging && 'duration-200')}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
          }}
          draggable={false}
          onDoubleClick={() => setScale((s) => s === 1 ? 2.5 : 1)}
        />
      </div>

      {/* Scale indicator */}
      {scale !== 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <button onClick={resetView}
            className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm text-white/80 text-xs font-medium hover:bg-white/20 transition-colors">
            {Math.round(scale * 100)}% · Click to reset
          </button>
        </div>
      )}
    </div>
  );
}
