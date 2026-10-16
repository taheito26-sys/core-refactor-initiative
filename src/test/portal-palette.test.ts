import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PORTAL_PALETTES, DEFAULT_PORTAL_PALETTE, applyPortalPalette, normalizePortalPalette } from '@/lib/portal-palette';

describe('portal palettes', () => {
  it('offers emerald, gold and ocean with emerald as the default', () => {
    expect(PORTAL_PALETTES.map(p => p.id)).toEqual(['emerald', 'gold', 'ocean']);
    expect(DEFAULT_PORTAL_PALETTE).toBe('emerald');
  });

  it('falls back to the default for a missing or unknown saved value', () => {
    expect(normalizePortalPalette(undefined)).toBe('emerald');
    expect(normalizePortalPalette('purple')).toBe('emerald');
    expect(normalizePortalPalette('gold')).toBe('gold');
  });

  it('switches the attribute the stylesheet keys on', () => {
    applyPortalPalette('ocean');
    expect(document.documentElement.dataset.portalPalette).toBe('ocean');
    applyPortalPalette('nonsense');
    expect(document.documentElement.dataset.portalPalette).toBe('emerald');
  });

  it('has a full token set in the stylesheet for every palette', () => {
    const css = readFileSync('src/styles/customer-theme.css', 'utf8');
    const block = (selector: string) => {
      const start = css.indexOf(selector);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf('}', start));
    };
    const base = block(':root {');
    const required = ['--th-ink', '--th-a', '--th-a2', '--th-ad', '--th-al', '--th-all', '--th-page', '--th-h1', '--th-h2', '--th-c1a', '--th-c2a', '--th-vol', '--th-vn'];
    for (const token of required) expect(base).toContain(`${token}:`);
    for (const id of ['gold', 'ocean']) {
      const overrides = block(`:root[data-portal-palette="${id}"]`);
      // A palette overrides the colours, not just a few of them: accent, header and the dark card at least.
      for (const token of ['--th-a:', '--th-h1:', '--th-c1a:', '--th-vol:', '--th-vn:', '--th-page:']) expect(overrides).toContain(token);
    }
  });
});
