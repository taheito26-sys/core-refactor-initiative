// ─── Customer portal palettes ───
// The phone pages of the customer portal (home and orders) draw their colours
// from CSS tokens; the palette chosen here switches which set of tokens apply.
// The tokens themselves live in src/styles/customer-theme.css.

export type PortalPaletteId = 'emerald' | 'gold' | 'ocean';

export interface PortalPalette {
  id: PortalPaletteId;
  name: { en: string; ar: string };
  /** Header colour, accent and light tint, for the picker's preview. */
  swatches: [string, string, string];
}

export const DEFAULT_PORTAL_PALETTE: PortalPaletteId = 'emerald';

export const PORTAL_PALETTES: PortalPalette[] = [
  { id: 'emerald', name: { en: 'Emerald', ar: 'زمردي' }, swatches: ['#0c3b30', '#10b981', '#d6f5e8'] },
  { id: 'gold', name: { en: 'Gold & Charcoal', ar: 'ذهبي وفحمي' }, swatches: ['#232832', '#c58a0e', '#f6e8c4'] },
  { id: 'ocean', name: { en: 'Ocean Teal', ar: 'تركوازي المحيط' }, swatches: ['#08485b', '#0891b2', '#d3f1f8'] },
];

/** An unknown or missing saved value falls back to the default. */
export function normalizePortalPalette(value: unknown): PortalPaletteId {
  return PORTAL_PALETTES.some(p => p.id === value) ? (value as PortalPaletteId) : DEFAULT_PORTAL_PALETTE;
}

export function applyPortalPalette(value: unknown): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.portalPalette = normalizePortalPalette(value);
}
