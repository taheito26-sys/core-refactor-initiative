import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight, ArrowUp, ArrowDown, CalendarDays, Check, Clock, ChevronDown, ChevronLeft, ChevronRight, Copy, Filter, LayoutGrid, List, MessageCircle,
  MoreVertical, Plus, Search, X, Zap, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Sparkline } from '@/features/dashboard/components/home/Sparkline';
import { cn } from '@/lib/utils';
import { splitAmount } from './orders-v2-model';

/** A figure with its unit drawn small beside it. */
const Amount = ({ text }: { text: string }) => { const { n, u } = splitAmount(text); return <>{n}{u && <small>{u}</small>}</>; };

export type V2Tone = 'good' | 'brand' | 'brand2' | 't5' | 'warn' | 'bad';
const toneVar = (tone: V2Tone) => `var(--${tone})`;

/** Closes whatever is open when the next tap lands outside it. */
function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open, close]);
  return ref;
}

// ── Header ──
export function OrdersV2Header({ title, subtitle, newLabel, onNew }: { title: string; subtitle: string; newLabel: string; onNew: () => void }) {
  return (
    <header className="ov2-head">
      <div className="ov2-head-t">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <button type="button" className="ov2-new" onClick={onNew}><Plus />{newLabel}</button>
    </header>
  );
}

// ── Figures ──
export interface V2Kpi {
  key: string;
  label: string;
  Icon: LucideIcon;
  tone: V2Tone;
  value: string;
  unit?: string;
  valueTone?: V2Tone;
  /** Percent change against the period before; null or undefined shows nothing. */
  delta?: number | null;
  deltaLabel?: string;
  spark?: number[];
  /** The trend's own colour when it differs from the icon's. */
  sparkTone?: V2Tone;
  /** A trend drawn across the whole card instead of in its corner. */
  sparkWide?: boolean;
  kind?: 'line' | 'bars';
}

/** `compact` draws each figure in a short card: one-line label, the unit beside the number and a thin trend strip. */
export function OrdersV2Kpis({ cards, extras, compact }: { cards: V2Kpi[]; extras?: Array<{ key: string; label: string; value: string }>; compact?: boolean }) {
  return (
    <div className="ov2-kpis-wrap">
      <div className={cn('ov2-kpis', compact && 'compact')} style={cards.length < 4 ? { gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` } : undefined}>
        {cards.map(k => (
          <section key={k.key} className="ov2-kpi" style={{ ['--tone' as string]: toneVar(k.tone) }}>
            <header><span className="ov2-ic"><k.Icon /></span><h3 title={k.label}>{k.label}</h3></header>
            <div className="ov2-kval" style={k.valueTone ? { color: toneVar(k.valueTone) } : undefined}><b>{k.value}</b>{compact && k.unit && <small>{k.unit}</small>}</div>
            {!compact && k.unit && <div className="ov2-kunit">{k.unit}</div>}
            {k.delta != null && (
              <div className={cn('ov2-kdelta', k.delta >= 0 ? 'up' : 'down')}>
                {k.delta >= 0 ? <ArrowUp /> : <ArrowDown />}<b>{k.delta >= 0 ? '+' : ''}{Math.round(k.delta)}%</b>
                {k.deltaLabel && <span>{k.deltaLabel}</span>}
              </div>
            )}
            {k.spark && k.spark.some(v => v !== 0) && <Sparkline className={cn('ov2-kspark', k.kind ?? 'bars', k.sparkWide && 'wide')} values={k.spark} color={toneVar(k.sparkTone ?? k.tone)} kind={k.kind ?? 'bars'} />}
          </section>
        ))}
      </div>
      {extras && extras.length > 0 && (
        <div className="ov2-extras">
          {extras.map(x => <span key={x.key}>{x.label}<b>{x.value}</b></span>)}
        </div>
      )}
    </div>
  );
}

// ── Tabs ──
export function OrdersV2Tabs<T extends string>({ tabs, active, onSelect, scroll }: { tabs: Array<{ id: T; label: string; Icon: LucideIcon }>; active: T; onSelect: (id: T) => void; scroll?: boolean }) {
  return (
    <div className={cn('ov2-tabs', scroll && 'scroll')} role="tablist" style={scroll ? undefined : { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={cn('ov2-tab', active === tab.id && 'on')} onClick={() => onSelect(tab.id)}>
          <tab.Icon />{tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Search ──
export function OrdersV2SearchBar({ value, onChange, placeholder, onFilter, filterActive, filterLabel }: {
  value: string; onChange: (v: string) => void; placeholder: string; onFilter?: () => void; filterActive?: boolean; filterLabel?: string;
}) {
  return (
    <div className="ov2-search">
      <label className="ov2-search-box">
        <Search />
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} />
        {value && <button type="button" onClick={() => onChange('')} aria-label="Clear"><X /></button>}
      </label>
      {onFilter && (
        <button type="button" className={cn('ov2-filterbtn', filterActive && 'on')} onClick={onFilter} aria-label={filterLabel} title={filterLabel}>
          <Filter />{filterActive && <i />}
        </button>
      )}
    </div>
  );
}

// ── Months ──
export function OrdersV2Months({ months, selected, onSelect, allLabel }: {
  months: Array<{ key: string; label: string; long: string }>; selected: string; onSelect: (key: string) => void; allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const chipsRef = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => chipsRef.current?.scrollBy({ left: dir * 160, behavior: 'smooth' });
  return (
    <div className="ov2-months">
      <div className="ov2-mdrop" ref={ref}>
        <button type="button" className="ov2-mbtn" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
          <span className="ov2-mcal"><CalendarDays /></span><span className="ov2-mlabel">{allLabel}</span><ChevronDown className={open ? 'open' : ''} />
        </button>
        {open && (
          <ul className="ov2-menu" role="listbox">
            {[{ key: 'all', long: allLabel }, ...months].map(m => (
              <li key={m.key}>
                <button type="button" role="option" aria-selected={selected === m.key} className={selected === m.key ? 'on' : ''} onClick={() => { onSelect(m.key); setOpen(false); }}>
                  {m.long}{selected === m.key && <Check />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ov2-chips" ref={chipsRef}>
        {months.map(m => (
          <button key={m.key} type="button" className={cn('ov2-chip', selected === m.key && 'on')} onClick={() => onSelect(m.key)}>{m.label}</button>
        ))}
      </div>
      <button type="button" className="ov2-mnext" onClick={() => scroll(1)} aria-label="Next"><ChevronRight className="rtl-flip" /></button>
      <button type="button" className="ov2-mprev" onClick={() => scroll(-1)} aria-label="Previous"><ChevronLeft className="rtl-flip" /></button>
    </div>
  );
}

// ── List header ──
export function OrdersV2ListHeader({ count, word, sortLabel, onSort, sortAsc, view, onView }: {
  count: number; word: string; sortLabel: string; onSort: () => void; sortAsc: boolean; view: 'list' | 'grid'; onView: (v: 'list' | 'grid') => void;
}) {
  return (
    <div className="ov2-listhead">
      <h2>{count} {word}</h2>
      <button type="button" className="ov2-sort" onClick={onSort}>
        {sortAsc ? <ArrowUp /> : <ArrowDown />}{sortLabel}
      </button>
      <div className="ov2-view" role="group">
        <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => onView('list')} aria-label="List"><List /></button>
        <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => onView('grid')} aria-label="Grid"><LayoutGrid /></button>
      </div>
    </div>
  );
}

// ── Sheet ──
export function OrdersV2Sheet({ open, title, onClose, children, doneLabel }: { open: boolean; title: string; onClose: () => void; children: ReactNode; doneLabel: string }) {
  if (!open) return null;
  return (
    <div className="ov2-scrim" onClick={onClose}>
      <div className="ov2-sheet" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <header><h2><Filter />{title}</h2><button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
        <div className="ov2-sheet-body">{children}</div>
        <footer><button type="button" className="ov2-new" onClick={onClose}>{doneLabel}</button></footer>
      </div>
    </div>
  );
}

// ── Card ──
export interface V2MenuItem { key: string; label: string; onClick: () => void; tone?: 'bad' | 'warn' | 'brand' }

export interface V2CardProps {
  id: string;
  name: string;
  /** Index into the avatar palette. */
  tone: number;
  initial: string;
  /** What sits next to the name: a source mark, a partner mark and loan badges. */
  marks?: ReactNode;
  /** The copyable number under the name; without one, `subtitle` is shown there instead. */
  reference?: string;
  subtitle?: ReactNode;
  statusLabel: string;
  statusKind: 'good' | 'warn' | 'bad';
  dateText: string;
  timeText?: string;
  qty: string;
  rate: string;
  volume: string;
  net: string;
  netTone: 'good' | 'bad' | 'muted';
  detailsLabel: string;
  detailsOpen: boolean;
  onDetails: () => void;
  menu: V2MenuItem[];
  onChat?: () => void;
  chatLabel: string;
  copyLabel: string;
  copiedLabel: string;
  menuLabel: string;
  labels: { qty: string; rate: string; volume: string; net: string };
  /** The colour of the third figure; orders draw their volume in the warning colour. */
  volumeTone?: 'vol' | 'good' | 'bad' | 'muted' | 'plain';
  rateTone?: 'good' | 'bad' | 'muted';
  highlight?: 'loan' | null;
  children?: ReactNode;
}

const AVATARS = ['brand', 'good', 'brand2', 'warn', 'bad'] as const;

export function OrdersV2Card(p: V2CardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useOutsideClose(menuOpen, () => setMenuOpen(false));
  const copy = async () => {
    try { await navigator.clipboard.writeText(p.reference); toast.success(p.copiedLabel); } catch { toast.error(p.reference); }
  };
  return (
    <article className={cn('ov2-card', p.highlight === 'loan' && 'loan')} data-trade-id={p.id} style={{ ['--tone' as string]: toneVar(AVATARS[p.tone % AVATARS.length]) }}>
      <div className="ov2-c-top">
        <span className="ov2-avatar">{p.initial}</span>
        <div className="ov2-c-main">
          <div className="ov2-c-name"><span title={p.name}>{p.name}</span>{p.marks}</div>
          {p.reference
            ? <button type="button" className="ov2-c-ref" onClick={copy} title={p.copyLabel} aria-label={p.copyLabel}>#{p.reference}<Copy /></button>
            : p.subtitle != null && <span className="ov2-c-ref">{p.subtitle}</span>}
        </div>
        <div className="ov2-c-meta">
          <span className={cn('ov2-status', p.statusKind)}>{p.statusLabel}</span>
          <div className="ov2-c-when"><span><CalendarDays />{p.dateText}</span>{p.timeText && <span><Clock />{p.timeText}</span>}</div>
        </div>
        <div className="ov2-c-acts">
          {p.onChat && <button type="button" className="ov2-icbtn" onClick={p.onChat} aria-label={p.chatLabel} title={p.chatLabel}><MessageCircle /></button>}
          <div className="ov2-kebab" ref={ref}>
            <button type="button" className="ov2-icbtn plain" onClick={() => setMenuOpen(o => !o)} aria-label={p.menuLabel} aria-haspopup="menu" aria-expanded={menuOpen}><MoreVertical /></button>
            {menuOpen && (
              <ul className="ov2-menu" role="menu">
                {p.menu.map(item => (
                  <li key={item.key}>
                    <button type="button" role="menuitem" className={item.tone} onClick={() => { setMenuOpen(false); item.onClick(); }}>{item.label}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <div className="ov2-c-bottom">
        <dl className="ov2-stats">
          <div><dt>{p.labels.qty}</dt><dd><Amount text={p.qty} /></dd></div>
          <div><dt>{p.labels.rate}</dt><dd className={p.rateTone}><Amount text={p.rate} /></dd></div>
          <div><dt>{p.labels.volume}</dt><dd className={(p.volumeTone ?? 'vol') === 'plain' ? undefined : (p.volumeTone ?? 'vol')}><Amount text={p.volume} /></dd></div>
          <div><dt>{p.labels.net}</dt><dd className={p.netTone}><Amount text={p.net} /></dd></div>
        </dl>
        <button type="button" className="ov2-details" onClick={p.onDetails}>{p.detailsLabel}<ArrowRight /></button>
      </div>
      {p.detailsOpen && p.children && <div className="ov2-c-detail">{p.children}</div>}
    </article>
  );
}

/** The mark a card shows for an order that came from an exchange. */
export const BoltMark = () => <Zap className="ov2-bolt" aria-hidden="true" />;
