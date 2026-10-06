import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ParsedOption { value: string; label: string; disabled: boolean }

/** Reads `<option>` children (including inside fragments and mapped arrays) into plain data. */
function parseOptions(children: ReactNode, out: ParsedOption[] = []): ParsedOption[] {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
    if (el.type === Fragment) { parseOptions(el.props.children, out); return; }
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
}

/**
 * Drop-in replacement for a native `<select>` whose list is drawn in a portal on a solid
 * surface above everything else, so nothing behind it shows through. On phones it opens
 * as a bottom sheet; on larger screens it sits under the field.
 */
export function ModernSelect({ value, onChange, children, disabled, style, className, placeholder, title }: ModernSelectProps) {
  const options = useMemo(() => parseOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sheet = typeof window !== 'undefined' && window.innerWidth < 640;
  const current = options.find(o => o.value === String(value ?? ''));
  const filtered = query.trim() ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

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
    if (open) setActive(Math.max(0, filtered.findIndex(o => o.value === String(value ?? ''))));
  }, [open, query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (o: ParsedOption) => {
    if (o.disabled) return;
    onChange({ target: { value: o.value } });
    setOpen(false);
    setQuery('');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); pick(filtered[active]); }
  };

  const desktopPos: CSSProperties | undefined = !sheet && rect
    ? (() => {
        const below = window.innerHeight - rect.bottom;
        const openUp = below < 260 && rect.top > below;
        return {
          left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 220) - 8),
          width: Math.max(rect.width, 220),
          ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
          maxHeight: Math.max(160, (openUp ? rect.top : below) - 16),
        };
      })()
    : undefined;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        title={title}
        className={`msel-trigger ${className ?? ''}`}
        style={style}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen(v => !v)}
        onKeyDown={onKey}
      >
        <span className={current ? 'msel-value' : 'msel-value msel-placeholder'}>{current?.label || placeholder || options[0]?.label || ''}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="msel-layer" onMouseDown={e => { if (e.target === e.currentTarget) { setOpen(false); setQuery(''); } }}>
          <div className={sheet ? 'msel-panel msel-sheet' : 'msel-panel'} style={sheet ? undefined : desktopPos} role="listbox" onKeyDown={onKey}>
            {sheet && <div className="msel-grip" />}
            {options.length > 7 && (
              <input autoFocus className="msel-search" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} />
            )}
            <div className="msel-list" ref={listRef}>
              {filtered.length ? filtered.map((o, i) => {
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
        </div>,
        document.body,
      )}
    </>
  );
}
