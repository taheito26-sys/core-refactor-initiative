import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { applyThemeToDOM } from '@/lib/theme/utils';
import { PRESET_THEMES } from '@/lib/theme/presets';
import type { AppSettings } from '@/lib/theme/types';

const root = document.documentElement;
const initialStyle = root.style.cssText;
const initialClass = root.className;
const initialBodyStyle = document.body.style.cssText;
afterEach(() => { root.style.cssText = initialStyle; root.className = initialClass; document.body.style.cssText = initialBodyStyle; });

const settings: AppSettings = {
  layout: 'quantum_ledger', theme: 't1', range: 'all', currency: 'QAR', baseFiatCurrency: 'QAR', language: 'en',
  searchQuery: '', lowStockThreshold: 5000, priceAlertThreshold: 2, allowInvalidTrades: true,
  ledgerFont: 'Inter', ledgerFontSize: 11, fontVisionProfile: 'standard', autoFontDisable: true,
  autoBackup: false, logsEnabled: true, logLevel: 'info',
};

describe('calendar follows the active tracker theme', () => {
  it('updates surfaces, text, accents and status colours when switching light → dark → coloured themes', () => {
    for (const id of ['p_clean', 'p_dark', 'p_lavender', 'p_graphite', 'p_ocean', 'p_clean']) {
      applyThemeToDOM({ ...settings, theme: id });
      const theme = PRESET_THEMES[id];
      for (const [token, value] of Object.entries({ bg: theme.bg, 'card-bg': theme.cardBg, text: theme.text, muted: theme.muted, brand: theme.brand, brand2: theme.brand2, good: theme.good, bad: theme.bad })) {
        expect(root.style.getPropertyValue(`--tracker-${token}`), `${id}: ${token}`).toBe(value);
      }
      expect(root.classList.contains('dark')).toBe(id === 'p_dark' || id === 'p_graphite');
    }
  });

  it('does not override the theme with fixed calendar, chart, tooltip or navigation colours', () => {
    const css = readFileSync('src/styles/trading-calendar.css', 'utf8');
    const page = readFileSync('src/pages/CalendarPage.tsx', 'utf8');
    expect(css).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(page).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(css).toContain('--tc-card: var(--tracker-card-bg,');
    expect(css).toContain('--tc-green: var(--tracker-brand,');
    expect(page).toContain("background: 'var(--tc-card)'");
  });
});
