import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * The list under a search-or-type field, drawn in a portal on a solid surface
 * above the rest of the page so nothing behind it shows through, and flipped
 * above the field when there is no room below.
 */
export function LookupMenuPortal({ anchorRef, onClose, children }: { anchorRef: RefObject<HTMLElement>; onClose: () => void; children: ReactNode }) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  const place = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    const room = Math.max(140, Math.min(360, up ? above : below));
    const next: CSSProperties = {
      left: r.left, width: r.width, maxHeight: room,
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    };
    // Keep the old object when nothing moved, or the layout effect would re-render forever.
    setStyle(prev => (prev && (Object.keys(next) as Array<keyof CSSProperties>).every(k => prev[k] === next[k]) && Object.keys(prev).length === Object.keys(next).length ? prev : next));
  };

  useLayoutEffect(() => { place(); });
  useEffect(() => {
    const onScroll = () => place();
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', onScroll); window.removeEventListener('scroll', onScroll, true); };
  }, []);

  if (!style || typeof document === 'undefined') return null;
  return createPortal(
    <div className="msel-panel lookup-portal" style={style} role="listbox" onMouseDown={e => e.preventDefault()} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="msel-list">{children}</div>
    </div>,
    document.body,
  );
}
