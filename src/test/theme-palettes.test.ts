import { describe, expect, it } from 'vitest';
import { LAYOUTS } from '@/lib/theme/layouts';

const KEYS = ['bg', 'panel', 'panel2', 'panel3', 'text', 'muted', 'muted2', 'line', 'line2', 'brand', 'brand2', 'brand3',
  'good', 'bad', 'warn', 'sidebarBg', 'topbarBg', 'cardBg', 'inputBg', 'hoverCard', 'glow'];

describe('theme colour sets', () => {
  it('gives every layout at least five colour sets to pick from in the top bar', () => {
    for (const layout of LAYOUTS) expect(Object.keys(layout.themes).length, layout.id).toBeGreaterThanOrEqual(5);
  });

  it('fills in every colour of every set, and keeps the sets of a layout distinct', () => {
    for (const layout of LAYOUTS) {
      const brands = new Set<string>();
      for (const [id, theme] of Object.entries(layout.themes)) {
        for (const key of KEYS) expect(theme[key as keyof typeof theme], `${layout.id}.${id}.${key}`).toBeTruthy();
        brands.add(`${theme.bg}|${theme.brand}`.toLowerCase());
      }
      expect(brands.size, layout.id).toBe(Object.keys(layout.themes).length);
    }
  });
});

describe('featured colour sets', () => {
  it('offers all fifteen featured sets with every layout, complete and picked by id', async () => {
    const { PRESET_THEMES, PRESET_NAMES } = await import('@/lib/theme/presets');
    const { getTheme, resolveThemeForLayout } = await import('@/lib/theme/utils');
    expect(Object.keys(PRESET_THEMES)).toHaveLength(15);
    for (const [id, theme] of Object.entries(PRESET_THEMES)) {
      expect(PRESET_NAMES[id]?.en && PRESET_NAMES[id]?.ar, id).toBeTruthy();
      for (const key of KEYS) expect(theme[key as keyof typeof theme], `${id}.${key}`).toBeTruthy();
      for (const layout of LAYOUTS) {
        expect(getTheme(layout.id, id).theme).toBe(theme);
        expect(resolveThemeForLayout(layout.id, id)).toBe(id);
      }
    }
  });
});
