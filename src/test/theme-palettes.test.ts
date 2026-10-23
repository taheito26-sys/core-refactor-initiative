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
