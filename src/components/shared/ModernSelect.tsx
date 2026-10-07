import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isolateScroll } from './isolateScroll';
import { pageZoom } from './pageZoom';

interface ParsedOption { value: string; label: string; disabled: boolean; header?: boolean }

/** Reads `<option>` children (including inside fragments and mapped arrays) into plain data. */
function parseOptions(children: ReactNode, out: ParsedOption[] = []): ParsedOption[] {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
    if (el.type === Fragment) { parseOptions(el.props.children, out); return; }
    if (el.type === 'optgroup') {
      const g = el as unknown as ReactElement<{ label?: string; children?: ReactNode }>;
      out.push({ value: `__group__${g.props.label ?? ''}`, label: String(g.props.label ?? ''), disabled: true, header: true });
      parseOptions(g.props.children, out);
      return;
    }
    if (el.type === 'option') {
      const label = Children.toArray(el.props.children).map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')).join('');
      out.push({ value: String(el.props.value ?? label), label, disabled: !!el.props.disabled });
    }
  });
  return out;
}

export interface ModernSelectProps {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  style?: CSSProperties;
  className?: string;
  placeholder?: string;
  title?: string;
  /** Sized to its content so it can sit on one line with other filters. */
  compact?: boolean;
}

/**
 * Drop-in replacement for a native `<select>` whose list is drawn in a portal on a solid
 * surface above everything else, so nothing behind it shows through. It opens just under
 * the field (above it when there is no room) and stays compact.
 */
export function ModernSelect({ value, onChange, children, disabled, style, className, placeholder, title, compact }: ModernSelectProps) {
  const options = useMemo(() => parseOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The search box only takes focus with a mouse or keyboard; on a phone it would raise the keyboard over the list.
  const canAutoFocus = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;
  const current = options.find(o => o.value === String(value ?? ''));
  const filtered = query.trim() ? options.filter(o => !o.header && o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

  useLayoutEffect(() => {
    if (open && btnRef.current) setRect(btnRef.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [open]);

  useEffect(() => {
    if (open) setActive(Math.max(0, filtered.findIndex(o => !o.header && o.value === String(value ?? ''))));
  }, [open, query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const pick = (o: ParsedOption) => {
    if (o.disabled) return;
    onChange({ target: { value: o.value } });
    setOpen(false);
    setQuery('');
  };

  const stepActive = (from: number, dir: 1 | -1) => {
    let i = from + dir;
    while (i >= 0 && i < filtered.length && filtered[i].header) i += dir;
    return i < 0 || i >= filtered.length ? from : i;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => stepActive(i, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => stepActive(i, -1)); }
    else if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); pick(filtered[active]); }
  };

  const pos: CSSProperties | undefined = rect
    ? (() => {
        const z = pageZoom();
        const vh = window.visualViewport?.height ?? window.innerHeight;
        const below = vh - rect.bottom;
        const openUp = below < 200 && rect.top > below;
        const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
        return {
          left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) / z,
          width: width / z,
          ...(openUp ? { bottom: (window.innerHeight - rect.top + 4) / z } : { top: (rect.bottom + 4) / z }),
          maxHeight: Math.min(240, Math.max(120, (openUp ? rect.top : below) - 12)) / z,
        };
      })()
    : undefined;

  const hasSearch = options.filter(o => !o.header).length > 7;
  const listMax = typeof pos?.maxHeight === 'number' ? pos.maxHeight - (hasSearch ? 46 : 0) - 8 : undefined;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        title={title}
        className={`msel-trigger${compact ? ' msel-compact' : ''} ${className ?? ''}`}
        style={style}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen(v => !v)}
        onKeyDown={onKey}
      >
        <span className={current ? 'msel-value' : 'msel-value msel-placeholder'}>{current?.label || placeholder || options[0]?.label || ''}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <>
          <div className="msel-layer" onMouseDown={() => { setOpen(false); setQuery(''); }} onTouchStart={() => { setOpen(false); setQuery(''); }} />
          <div className="msel-panel" ref={isolateScroll} style={pos ?? { visibility: 'hidden' }} role="listbox" onKeyDown={onKey}>
            {options.filter(o => !o.header).length > 7 && (
              <input autoFocus={canAutoFocus} className="msel-search" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} />
            )}
            <div className="msel-list" ref={listRef} style={{ maxHeight: listMax }}>
              {filtered.length ? filtered.map((o, i) => {
                if (o.header) return <div key={`${o.value}-${i}`} className="msel-group">{o.label}</div>;
                const selected = o.value === String(value ?? '');
                return (
                  <button
                    key={`${o.value}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={i === active}
                    disabled={o.disabled}
                    className={`msel-item${selected ? ' selected' : ''}${i === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o)}
                  >
                    <span className="msel-item-label">{o.label || '—'}</span>
                    {selected && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>}
                  </button>
                );
              }) : <div className="msel-empty">—</div>}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
