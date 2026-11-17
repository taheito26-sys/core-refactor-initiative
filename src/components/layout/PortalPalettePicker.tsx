import { useState } from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PORTAL_PALETTES, normalizePortalPalette } from '@/lib/portal-palette';

/** The four Taheito palettes, chosen from the top bar while the Taheito design is on. */
export function PortalPalettePicker({ compact = false }: { compact?: boolean }) {
  const { settings, update } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const active = normalizePortalPalette(settings.portalPalette);
  const current = PORTAL_PALETTES.find(p => p.id === active) ?? PORTAL_PALETTES[0];
  const label = t('taheitoPalette');
  const swatch = (colors: [string, string, string], size: number) => (
    <span aria-hidden="true" className="block shrink-0 rounded-full" style={{ width: size, height: size, background: `conic-gradient(${colors[0]} 0 50%, ${colors[1]} 50% 80%, ${colors[2]} 80% 100%)`, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)' }} />
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={label} className={cn('shrink-0 rounded-full border border-border bg-card hover:bg-muted', compact ? 'p-[2px]' : 'p-1')}>
          {swatch(current.swatches, compact ? 14 : 16)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[236px] p-2.5">
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{label}</div>
        <div className="grid grid-cols-4 gap-x-1 gap-y-2" role="radiogroup" aria-label={label}>
          {PORTAL_PALETTES.map(p => {
            const name = p.name[t.lang === 'ar' ? 'ar' : 'en'];
            const on = active === p.id;
            return (
              <div key={p.id} className="flex flex-col items-center gap-0.5">
                <button
                  type="button" role="radio" aria-checked={on} aria-label={name} title={name}
                  onClick={() => { update({ portalPalette: p.id }); setOpen(false); }}
                  className={cn('relative rounded-full p-[3px] transition-transform hover:scale-105', on ? 'ring-2 ring-primary' : 'ring-1 ring-transparent')}
                >
                  {swatch(p.swatches, 30)}
                  {on && <span className="absolute inset-0 flex items-center justify-center"><Check className="h-3.5 w-3.5 drop-shadow" style={{ color: '#fff' }} strokeWidth={3} /></span>}
                </button>
                <span className="text-center text-[9.5px] leading-tight text-muted-foreground">{name}</span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
