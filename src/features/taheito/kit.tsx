import type { KeyboardEvent, ReactNode } from 'react';
import { ChevronRight, Search, type LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PortalHero } from '@/features/customer/components/PortalHero';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import '@/styles/customer-home.css';
import '@/styles/customer-orders.css';
import '@/styles/customer-theme.css';
import '@/styles/customer-shipments.css';
import '@/styles/taheito-kit.css';

/**
 * The Taheito page kit for the merchant app: the same pieces as the portal's Orders, Cash and Shipments pages
 * (hero, white main card with chips and tiles, stripe cards, detail sheet), built once so every merchant page
 * assembled from them looks and behaves the same. Markup and class names follow the taheito-ui skill.
 */

export type Lang = 'en' | 'ar';

/** The page root. It must not contain position:fixed panels, because its container query makes it their containing block. */
export function ThRoot({ lang, className, children }: { lang: Lang; className?: string; children: ReactNode }) {
  return <div className={cn('ch-root co-root th-root', className)} dir={lang === 'ar' ? 'rtl' : 'ltr'}>{children}</div>;
}

/** The phone header: the merchant's name, the page title and one headline fact. Zoom, language and bell live in the top bar. */
export function MerchantHero({ lang, icon, title, subtitle, trendDown, trendTitle, trendText }: {
  lang: Lang; icon: ReactNode; title: string; subtitle: string; trendDown: boolean; trendTitle: string; trendText: string;
}) {
  const { merchantProfile } = useAuth();
  const { update } = useTheme();
  return (
    <PortalHero
      hideTop lang={lang} displayName={merchantProfile?.display_name ?? '—'} onLanguage={l => update({ language: l })}
      icon={icon} title={title} subtitle={subtitle} trendDown={trendDown} trendTitle={trendTitle} trendText={trendText}
    />
  );
}

/** The white card with the page's one primary button, its tabs, chips, tools and tiles. */
export function ThMain({ label, primary, tabs, children }: {
  label: string;
  primary?: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean };
  tabs?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="co-mainwrap">
      <div className="ch-card co-main">
        <div className="co-mtop">
          <div className="co-mlabel">{label}</div>
          {tabs}
          {primary && <button type="button" className="co-new" onClick={primary.onClick} disabled={primary.disabled}>{primary.icon}{primary.label}</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

export interface ThTab<T extends string> { id: T; label: string; icon?: LucideIcon; count?: number }

export function ThTabs<T extends string>({ tabs, active, onSelect, label }: { tabs: ThTab<T>[]; active: T; onSelect: (id: T) => void; label: string }) {
  return (
    <div className="cs-tabs th-tabs" role="tablist" aria-label={label}>
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={cn('cs-tab', active === tab.id && 'on')} onClick={() => onSelect(tab.id)}>
          {tab.icon && <tab.icon aria-hidden="true" />}{tab.label}{tab.count != null && tab.count > 0 && <b className="th-tabcount">{tab.count}</b>}
        </button>
      ))}
    </div>
  );
}

export interface ThChip { key: string; label: string; count?: number; alert?: boolean }

export function ThChips({ chips, selected, onSelect }: { chips: ThChip[]; selected: string; onSelect: (key: string) => void }) {
  return (
    <div className="co-months">
      {chips.map(c => (
        <button key={c.key} type="button" aria-pressed={selected === c.key} onClick={() => onSelect(c.key)} className={cn('co-chip', selected === c.key && 'on', c.alert && 'alert')}>
          {c.label}{c.count != null && <b>{c.count}</b>}
        </button>
      ))}
    </div>
  );
}

export function ThTools({ children }: { children: ReactNode }) {
  return <div className="co-tools th-tools">{children}</div>;
}

export function ThSearch({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <label className="cs-search">
      <Search aria-hidden="true" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
    </label>
  );
}

export interface ThTile { key: string; cls: string; icon: LucideIcon; label: string; value: ReactNode; unit?: string; tone?: 'good' | 'bad'; on?: boolean; onClick?: () => void; /** A small control beside the label, e.g. a show/hide toggle. */ action?: ReactNode }

export function ThTiles({ tiles }: { tiles: ThTile[] }) {
  return (
    <div className="co-tiles">
      {tiles.map(tile => {
        const body = (
          <>
            <div className="co-t-top"><span className="co-t-l">{tile.label}</span>{tile.action}<span className="co-t-ic"><tile.icon /></span></div>
            <div className={cn('co-t-v', tile.tone === 'bad' && 'th-bad', tile.tone === 'good' && 'th-good')}>{tile.value}{tile.unit && <small className="th-unit"> {tile.unit}</small>}</div>
          </>
        );
        // A tile that carries its own control cannot itself be a button, so it becomes a clickable box instead.
        if (tile.onClick && tile.action) {
          const go = tile.onClick;
          return (
            <div key={tile.key} role="button" tabIndex={0} aria-pressed={!!tile.on} onClick={go}
              onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(); } }}
              className={cn('co-t', tile.cls, tile.on && 'on')} style={{ cursor: 'pointer' }}>{body}</div>
          );
        }
        return tile.onClick
          ? <button key={tile.key} type="button" aria-pressed={!!tile.on} onClick={tile.onClick} className={cn('co-t', tile.cls, tile.on && 'on')}>{body}</button>
          : <div key={tile.key} className={cn('co-t', tile.cls)}>{body}</div>;
      })}
    </div>
  );
}

export function ThHead({ title, count, action }: { title: string; count?: number; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="cs-head">
      <span>{title}{count != null && <> <small>({count})</small></>}</span>
      {action && <button type="button" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

export function ThList({ children }: { children: ReactNode }) {
  return <div className="cs-list">{children}</div>;
}

export function ThEmpty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <section className="ch-card cs-empty">
      <span className="ic">{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {children && <div className="row">{children}</div>}
    </section>
  );
}

export function ThSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="cs-list" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="cs-skel" />)}</div>;
}

export type ThStripe = 'prep' | 'road' | 'done' | 'void' | 'alert';
export type ThTone = 'warn' | 'ok' | 'bad' | 'blue' | 'grey';

export interface ThCardColumn { k: string; v: string; unit?: string; end?: boolean; tone?: 'good' | 'bad' | 'muted' }

/** One record as a white card with a coloured stripe for its state. The whole card opens the record. */
export function ThCard({ stripe, no, name, date, tag, columns, foot, goLabel, onOpen, id }: {
  stripe: ThStripe; no?: string; name: string; date: string; tag: { label: string; tone: ThTone };
  columns: ThCardColumn[]; foot?: ReactNode; goLabel: string; onOpen: () => void; id?: string;
}) {
  const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } };
  return (
    <div role="button" tabIndex={0} id={id} className={cn('co-card cs-card', stripe)} onClick={onOpen} onKeyDown={key}>
      <div className="co-card-top">
        {no && <span className="co-no">{no}</span>}
        <span className="cs-cargo th-name">{name}</span>
        <span className="co-date" style={{ marginInlineStart: 'auto' }}>{date}</span>
        <span className={cn('co-tag', tag.tone)} style={{ marginInlineStart: 0 }}>{tag.label}</span>
      </div>
      <div className="co-card-mid">
        {columns.map(c => (
          <div key={c.k} className={cn('co-amt-col', c.end && 'end')}>
            <div className="k">{c.k}</div>
            <div className={cn('co-amt', c.tone && `th-${c.tone}`)}>{c.unit && <small>{c.unit}</small>}<b>{c.v}</b></div>
          </div>
        ))}
      </div>
      <div className="cs-foot">
        <span className="th-foot">{foot}</span>
        <span className="cs-go">{goLabel}<ChevronRight aria-hidden="true" /></span>
      </div>
    </div>
  );
}

/** The record's side panel in the same language: a gradient header, then white boxes. The close button shows on the header. */
export function ThSheet({ open, onClose, lang, title, tag, subtitle, children }: {
  open: boolean; onClose: () => void; lang: Lang; title: string; tag?: { label: string; tone: ThTone }; subtitle?: string; children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side={lang === 'ar' ? 'left' : 'right'} className="w-full overflow-hidden border-0 p-0 sm:max-w-xl [&>button]:z-20 [&>button]:rounded-full [&>button]:bg-black/45 [&>button]:p-2 [&>button]:text-white [&>button]:opacity-100 [&>button>svg]:h-5 [&>button>svg]:w-5" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{subtitle ?? title}</SheetDescription>
        </SheetHeader>
        <div className="h-full overflow-y-auto overscroll-contain">
        <div className="ch-root co-root cs-sheet th-sheet" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <div className="cs-dh">
            <div className="cs-dh-top">
              <h2>{title}</h2>
              {tag && <span className={cn('co-tag', tag.tone)} style={{ marginInlineStart: 0 }}>{tag.label}</span>}
            </div>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="cs-dbody">{children}</div>
        </div>
        <div className="cs-closebar"><button type="button" onClick={onClose}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button></div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A white box inside the sheet. Existing merchant content (tracker styling) goes inside `th-embed`. */
export function ThBox({ title, icon, note, children }: { title?: string; icon?: ReactNode; note?: string; children: ReactNode }) {
  return (
    <section className="ch-card cs-box">
      {title && <h3>{icon}{title}{note && <small>{note}</small>}</h3>}
      {children}
    </section>
  );
}
