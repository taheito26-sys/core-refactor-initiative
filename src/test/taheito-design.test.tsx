import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { APP_DESIGN_KEY, DEFAULT_APP_DESIGN, readStoredDesign, usesNewLayout } from '@/lib/app-design';
import { readPageDesign } from '@/features/orders/v2/design';
import { LayoutSwitch } from '@/features/orders/v2/LayoutSwitch';
import { TAHEITO_LAYOUT, taheitoTheme } from '@/lib/theme/taheito';
import { applyThemeToDOM } from '@/lib/theme/utils';
import { PORTAL_PALETTES } from '@/lib/portal-palette';
import type { AppSettings, ThemeDef } from '@/lib/theme/types';

vi.mock('@/lib/theme-context', async () => ({ ...await vi.importActual<object>('@/lib/theme-context'), useTheme: () => ({ settings: { language: 'en' } }) }));

beforeEach(() => { localStorage.clear(); document.documentElement.className = ''; document.documentElement.removeAttribute('data-app-design'); });
afterEach(() => cleanup());

const lum = (hex: string) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('the saved design', () => {
  it('knows Taheito, and falls back to New for anything else', () => {
    expect(readStoredDesign()).toBe(DEFAULT_APP_DESIGN);
    localStorage.setItem(APP_DESIGN_KEY, 'taheito');
    expect(readStoredDesign()).toBe('taheito');
    localStorage.setItem(APP_DESIGN_KEY, 'nonsense');
    expect(readStoredDesign()).toBe('v2');
  });

  it('gives Taheito the same redesigned pages as New, and Classic its own', () => {
    expect(usesNewLayout('v2')).toBe(true);
    expect(usesNewLayout('taheito')).toBe(true);
    expect(usesNewLayout('classic')).toBe(false);
  });

  it('lets the address choose it and remembers the choice', () => {
    expect(readPageDesign(APP_DESIGN_KEY, ['home'], '?home=taheito')).toBe('taheito');
    expect(localStorage.getItem(APP_DESIGN_KEY)).toBe('taheito');
  });
});

describe('the Taheito palettes', () => {
  const REQUIRED: Array<keyof ThemeDef> = ['bg', 'panel', 'panel2', 'panel3', 'text', 'muted', 'muted2', 'line', 'line2', 'brand', 'brand2', 'brand3', 'good', 'bad', 'warn', 'sidebarBg', 'topbarBg', 'cardBg', 'inputBg', 'hoverCard', 'glow'];

  it.each(PORTAL_PALETTES.map(p => p.id))('%s defines every colour a theme needs', id => {
    const theme = taheitoTheme(id);
    for (const key of REQUIRED) expect(theme[key], key).toBeTruthy();
    expect(Object.keys(TAHEITO_LAYOUT.themes)).toContain(id);
  });

  it.each(PORTAL_PALETTES.map(p => p.id))('%s keeps text readable on its cards and buttons', id => {
    const t = taheitoTheme(id);
    expect(contrast(t.text, t.cardBg)).toBeGreaterThanOrEqual(7);
    expect(contrast(t.text, t.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(t.muted, t.cardBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', t.brand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.bad, t.cardBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.good, t.cardBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.warn, t.cardBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('treats an unknown palette as the default', () => {
    expect(taheitoTheme('purple')).toEqual(taheitoTheme('emerald'));
  });
});

describe('applying the theme', () => {
  const settings = { layout: 'quantum_ledger', theme: 't1', language: 'en', ledgerFont: 'Inter', ledgerFontSize: 11, fontVisionProfile: 'standard', autoFontDisable: true } as AppSettings;

  it('uses the portal palette and light cards while Taheito is on', () => {
    document.documentElement.classList.add('dark');
    applyThemeToDOM({ ...settings, portalPalette: 'ocean' }, 'taheito');
    const root = document.documentElement;
    expect(root.dataset.appDesign).toBe('taheito');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.style.getPropertyValue('--tracker-brand')).toBe(taheitoTheme('ocean').brand);
    expect(root.style.getPropertyValue('--tracker-card-bg')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--lt-radius')).toBe('14px');
  });

  it('switches back to the chosen layout and colours when another design is picked', () => {
    applyThemeToDOM({ ...settings, portalPalette: 'ocean' }, 'taheito');
    applyThemeToDOM(settings, 'v2');
    expect(document.documentElement.dataset.appDesign).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--tracker-brand')).not.toBe(taheitoTheme('ocean').brand);
  });

  it('reads the saved design when none is passed', () => {
    localStorage.setItem(APP_DESIGN_KEY, 'taheito');
    applyThemeToDOM(settings);
    expect(document.documentElement.dataset.appDesign).toBe('taheito');
  });
});

describe('LayoutSwitch', () => {
  it('offers New, Classic and Taheito, and reports the choice', () => {
    const onChange = vi.fn();
    render(<LayoutSwitch design="v2" onChange={onChange} />);
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('tab')[2]);
    expect(onChange).toHaveBeenCalledWith('taheito');
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });
});
