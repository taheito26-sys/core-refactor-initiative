import { useState } from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTheme, type ThemeDef } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

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
 * The colours of the current layout, picked from the top bar. Only the colour set changes; the layout (fonts,
 * shapes, spacing) stays what was chosen in Settings. Hidden when the layout has a single colour set.
 */
export function ThemeColorPicker({ compact = false }: { compact?: boolean }) {
  const { settings, update, currentLayout, currentTheme } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const entries = Object.entries(currentLayout.themes) as [string, ThemeDef][];
  if (entries.length < 2) return null;
  const label = t('themeColors');
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
      <PopoverContent align="end" sideOffset={6} className="w-auto p-2">
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{label}</div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
          {entries.map(([id, theme], i) => {
            const on = settings.theme === id || (!currentLayout.themes[settings.theme] && id === 't1');
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`${label} ${i + 1}`}
                onClick={() => { update({ theme: id }); setOpen(false); }}
                className={cn('relative rounded-full p-[3px] transition-transform hover:scale-105', on ? 'ring-2 ring-primary' : 'ring-1 ring-transparent')}
              >
                <Swatch theme={theme} size={28} />
                {on && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Check className="h-3.5 w-3.5 drop-shadow" style={{ color: '#fff' }} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
