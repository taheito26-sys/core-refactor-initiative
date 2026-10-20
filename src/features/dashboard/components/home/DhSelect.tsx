import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface DhSelectProps<T extends string> {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * A small dropdown drawn with the theme's variables. A native <select> cannot be used here: the app
 * forces every native select to fixed dark colours, which would ignore the theme the user picked.
 */
export function DhSelect<T extends string>({ value, options, onChange, ariaLabel, className }: DhSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];
  return (
    <div className={`dh-select ${className ?? ''}`} ref={ref}>
      <button type="button" className="dh-select-btn" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>{current?.label}</span>
        <ChevronDown className={open ? 'open' : ''} />
      </button>
      {open && (
        <ul className="dh-menu" role="listbox">
          {options.map(o => (
            <li key={o.value}>
              <button type="button" role="option" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => { onChange(o.value); setOpen(false); }}>
                {o.label}{o.value === value && <Check />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
