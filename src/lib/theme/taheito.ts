import type { LayoutDef, ThemeDef } from './types';
import { DEFAULT_PORTAL_PALETTE, normalizePortalPalette, type PortalPaletteId } from '../portal-palette';

/**
 * The Taheito design for the merchant app: the portal's four palettes as full app themes, so every page, the
 * navigation and the shadcn components pick them up through the same variables the other layouts use.
 * Values mirror the tokens in src/styles/customer-theme.css. The brand colour is the palette's dark accent, so
 * white text on buttons stays readable on every palette, including gold.
 */
interface PaletteTokens { page: string; ink: string; accent: string; accentDark: string; tint: string; tint2: string; hero: string; heroSoft: string; rgb: string; bad: string }

const TOKENS: Record<PortalPaletteId, PaletteTokens> = {
  emerald: { page: '#f1f8f5', ink: '#0f2a24', accent: '#10b981', accentDark: '#047857', tint: '#ecfaf4', tint2: '#f6fcf9', hero: '#07231d', heroSoft: '#0c3b30', rgb: '16, 185, 129', bad: '#e11d48' },
  gold: { page: '#f6f3ee', ink: '#1c1f26', accent: '#c58a0e', accentDark: '#8a5d06', tint: '#fbf5e6', tint2: '#fdf9ef', hero: '#13151a', heroSoft: '#232832', rgb: '197, 138, 14', bad: '#e11d48' },
  ocean: { page: '#eff8fa', ink: '#0b2f3a', accent: '#0891b2', accentDark: '#0e7490', tint: '#ebf9fc', tint2: '#f4fcfd', hero: '#052a36', heroSoft: '#08485b', rgb: '8, 145, 178', bad: '#e11d48' },
  navy: { page: '#eef3fb', ink: '#0f1f5e', accent: '#2f73f4', accentDark: '#1f56c9', tint: '#eef4ff', tint2: '#f6f9ff', hero: '#0a1630', heroSoft: '#17306e', rgb: '47, 115, 244', bad: '#e11d48' },
};

export function taheitoTheme(palette: unknown): ThemeDef {
  const p = TOKENS[normalizePortalPalette(palette)];
  return {
    bg: p.page, panel: '#ffffff', panel2: p.tint2, panel3: p.tint,
    text: p.ink, muted: '#5b6b8c', muted2: '#8794b0',
    line: `rgba(${p.rgb}, .22)`, line2: `rgba(${p.rgb}, .10)`,
    brand: p.accentDark, brand2: p.accent, brand3: `rgba(${p.rgb}, .12)`,
    good: '#15803d', bad: p.bad, warn: '#b45309',
    sidebarBg: p.hero, topbarBg: '#ffffff', cardBg: '#ffffff', inputBg: p.tint,
    hoverCard: `rgba(${p.rgb}, .06)`, glow: `rgba(${p.rgb}, .20)`,
    chartBar: p.accent, chartLine: p.accentDark, cashTone: p.accent,
  };
}

/** Rounded white cards with a soft shadow, as on the portal pages. */
export const TAHEITO_LAYOUT: LayoutDef = {
  id: 'taheito', name: 'Taheito', desc: 'Portal card design · four palettes',
  font: 'Inter', fontMono: 'JetBrains Mono',
  radius: '14px', radiusSm: '10px', radiusLg: '18px',
  shadow: '0 6px 18px rgba(15, 31, 94, 0.08)',
  swatches: Object.values(TOKENS).map(t => t.accent),
  themes: Object.fromEntries((Object.keys(TOKENS) as PortalPaletteId[]).map(id => [id, taheitoTheme(id)])),
  fontWeightUi: '800', fontWeightVal: '800', labelTracking: '.2px', valTracking: '-.4px', cardOrnament: '0',
};

export const taheitoLayoutAndTheme = (palette: unknown = DEFAULT_PORTAL_PALETTE): { layout: LayoutDef; theme: ThemeDef } => ({ layout: TAHEITO_LAYOUT, theme: taheitoTheme(palette) });
