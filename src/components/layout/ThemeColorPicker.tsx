import { useState } from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTheme, type ThemeDef } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PRESET_NAMES, PRESET_THEMES } from '@/lib/theme/presets';

/** A colour set drawn as one round swatch: its background, with its two brand colours on top. */
function Swatch({ theme, size }: { theme: ThemeDef; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="block shrink-0 rounded-full"
      style={{
        width: size, height: size,
        background: `conic-gradient(${theme.brand} 0 50%, ${theme.brand2} 50% 75%, ${theme.bg} 75% 100%)`,
        boxShadow: `inset 0 0 0 1px ${theme.line}, 0 0 0 1px hsl(var(--border))`,
      }}
    />
  );
}

/**
 * Colours picked from the top bar: the current layout's own sets, then the featured sets offered with every layout.
 * Only the colours change; the layout (fonts, shapes, spacing) stays what was chosen in Settings.
 */
export function ThemeColorPicker({ compact = false }: { compact?: boolean }) {
  const { settings, update, currentLayout, currentTheme } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const entries = Object.entries(currentLayout.themes) as [string, ThemeDef][];
  const featured = Object.entries(PRESET_THEMES);
  const activeId = currentLayout.themes[settings.theme] || PRESET_THEMES[settings.theme] ? settings.theme : 't1';
  const label = t('themeColors');
  const pick = (id: string) => { update({ theme: id }); setOpen(false); };
  const option = (id: string, theme: ThemeDef, name: string, size: number) => {
    const on = activeId === id;
    return (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={name}
        title={name}
        onClick={() => pick(id)}
        className={cn('relative rounded-full p-[3px] transition-transform hover:scale-105', on ? 'ring-2 ring-primary' : 'ring-1 ring-transparent')}
      >
        <Swatch theme={theme} size={size} />
        {on && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Check className="h-3.5 w-3.5 drop-shadow" style={{ color: '#fff' }} strokeWidth={3} />
          </span>
        )}
      </button>
    );
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn('shrink-0 rounded-full border border-border bg-card hover:bg-muted', compact ? 'p-[2px]' : 'p-1')}
        >
          <Swatch theme={currentTheme} size={compact ? 14 : 16} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="max-h-[var(--radix-popover-content-available-height)] w-[264px] overflow-y-auto overscroll-contain p-2.5">
        {entries.length > 1 && (
          <>
            <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{label} · {currentLayout.name}</div>
            <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${label} ${currentLayout.name}`}>
              {entries.map(([id, theme], i) => option(id, theme, `${currentLayout.name} ${i + 1}`, 28))}
            </div>
          </>
        )}
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{t('themeFeatured')}</div>
        <div className="grid grid-cols-4 gap-x-1 gap-y-2" role="radiogroup" aria-label={t('themeFeatured')}>
          {featured.map(([id, theme]) => {
            const name = PRESET_NAMES[id]?.[t.lang === 'ar' ? 'ar' : 'en'] ?? id;
            return (
              <div key={id} className="flex flex-col items-center gap-0.5">
                {option(id, theme, name, 30)}
                <span className="text-center text-[9.5px] leading-tight text-muted-foreground">{name}</span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
