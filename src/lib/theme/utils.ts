import { AppSettings, LayoutDef, ThemeDef } from './types';
import { LAYOUTS } from './layouts';

export const FONT_CONFIG = {
  baseSize: 11, minSize: 9, maxSize: 18,
  breakpoints: { mobile: 480, tablet: 900, desktop: 1366, wide: 1920 },
  scaleFactors: { mobile: 0.9, tablet: 1.0, desktop: 1.05, wide: 1.1 },
  visionProfiles: { standard: 1.0, large: 1.15, xlarge: 1.3, compact: 0.9 } as Record<string, number>,
};

export function hexToHSL(hex: string): string {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function isDark(hex: string): boolean {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.4;
}

export function detectOptimalFontSize(baseSize: number, visionProfile: string): number {
  const width = typeof window !== 'undefined' ? window.innerWidth : 1366;
  const base = Number(baseSize || FONT_CONFIG.baseSize) || FONT_CONFIG.baseSize;

  let scale = 1.0;
  if (width < FONT_CONFIG.breakpoints.mobile) scale = FONT_CONFIG.scaleFactors.mobile;
  else if (width < FONT_CONFIG.breakpoints.tablet) scale = FONT_CONFIG.scaleFactors.tablet;
  else if (width < FONT_CONFIG.breakpoints.desktop) scale = FONT_CONFIG.scaleFactors.desktop;
  else scale = FONT_CONFIG.scaleFactors.wide;

  const vm = FONT_CONFIG.visionProfiles[String(visionProfile || 'standard')] || 1.0;
  let finalSize = Math.round(base * scale * vm);
  finalSize = Math.max(FONT_CONFIG.minSize, Math.min(FONT_CONFIG.maxSize, finalSize));
  return finalSize;
}

export function getTheme(layoutId: string, themeId: string): { layout: LayoutDef; theme: ThemeDef } {
  const layout = LAYOUTS.find(l => l.id === layoutId) || LAYOUTS[0];
  const theme = layout.themes[themeId] || layout.themes.t1;
  return { layout, theme };
}

export function applyThemeToDOM(settings: AppSettings) {
  const root = document.documentElement;
  const { layout, theme } = getTheme(settings.layout, settings.theme);
  const dark = isDark(theme.bg);

  if (dark) root.classList.add('dark');
  else root.classList.remove('dark');

  root.style.setProperty('--background', hexToHSL(theme.bg));
  root.style.setProperty('--foreground', hexToHSL(theme.text));
  root.style.setProperty('--card', hexToHSL(theme.cardBg));
  root.style.setProperty('--card-foreground', hexToHSL(theme.text));
  root.style.setProperty('--popover', hexToHSL(theme.panel));
  root.style.setProperty('--popover-foreground', hexToHSL(theme.text));
  root.style.setProperty('--primary', hexToHSL(theme.brand));
  root.style.setProperty('--primary-foreground', dark ? hexToHSL(theme.bg) : '0 0% 100%');
  root.style.setProperty('--secondary', hexToHSL(theme.panel2));
  root.style.setProperty('--secondary-foreground', hexToHSL(theme.text));
  root.style.setProperty('--muted', hexToHSL(theme.panel3));
  root.style.setProperty('--muted-foreground', hexToHSL(theme.muted));
  root.style.setProperty('--accent', hexToHSL(theme.panel2));
  root.style.setProperty('--accent-foreground', hexToHSL(theme.text));
  root.style.setProperty('--destructive', hexToHSL(theme.bad));
  root.style.setProperty('--destructive-foreground', '0 0% 100%');
  root.style.setProperty('--warning', hexToHSL(theme.warn));
  root.style.setProperty('--warning-foreground', '0 0% 100%');
  root.style.setProperty('--success', hexToHSL(theme.good));
  root.style.setProperty('--success-foreground', '0 0% 100%');
  root.style.setProperty('--border', hexToHSL(theme.panel3));
  root.style.setProperty('--input', hexToHSL(theme.panel3));
  root.style.setProperty('--ring', hexToHSL(theme.brand));
  root.style.setProperty('--radius', layout.radius);

  const sidebarDark = isDark(theme.sidebarBg);
  root.style.setProperty('--sidebar-background', hexToHSL(theme.sidebarBg));
  root.style.setProperty('--sidebar-foreground', sidebarDark ? '210 40% 92%' : hexToHSL(theme.text));
  root.style.setProperty('--sidebar-primary', hexToHSL(theme.brand));
  root.style.setProperty('--sidebar-primary-foreground', '0 0% 100%');
  root.style.setProperty('--sidebar-accent', sidebarDark ? hexToHSL(theme.panel2) : hexToHSL(theme.panel3));
  root.style.setProperty('--sidebar-accent-foreground', sidebarDark ? '210 40% 92%' : hexToHSL(theme.text));
  root.style.setProperty('--sidebar-border', hexToHSL(theme.panel3));
  root.style.setProperty('--sidebar-ring', hexToHSL(theme.brand));

  root.style.setProperty('--tracker-bg', theme.bg);
  root.style.setProperty('--tracker-panel', theme.panel);
  root.style.setProperty('--tracker-panel2', theme.panel2);
  root.style.setProperty('--tracker-panel3', theme.panel3);
  root.style.setProperty('--tracker-text', theme.text);
  root.style.setProperty('--tracker-muted', theme.muted);
  root.style.setProperty('--tracker-muted2', theme.muted2);
  root.style.setProperty('--tracker-line', theme.line);
  root.style.setProperty('--tracker-line2', theme.line2);
  root.style.setProperty('--tracker-brand', theme.brand);
  root.style.setProperty('--tracker-brand2', theme.brand2);
  root.style.setProperty('--tracker-brand3', theme.brand3);
  root.style.setProperty('--tracker-good', theme.good);
  root.style.setProperty('--tracker-bad', theme.bad);
  root.style.setProperty('--tracker-warn', theme.warn);
  root.style.setProperty('--tracker-sidebar-bg', theme.sidebarBg);
  root.style.setProperty('--tracker-topbar-bg', theme.topbarBg);
  root.style.setProperty('--tracker-card-bg', theme.cardBg);
  root.style.setProperty('--tracker-input-bg', theme.inputBg);
  root.style.setProperty('--tracker-hover-card', theme.hoverCard);
  root.style.setProperty('--tracker-glow', theme.glow);
  root.style.setProperty('--tracker-kpi-accent', `linear-gradient(135deg, ${theme.brand}, ${theme.brand2})`);
  root.style.setProperty('--tracker-t1', theme.brand);
  root.style.setProperty('--tracker-t2', theme.brand2);
  root.style.setProperty('--tracker-t3', theme.good);
  root.style.setProperty('--tracker-t4', theme.bad);
  root.style.setProperty('--tracker-t5', layout.themes.t5?.brand ?? theme.warn);

  root.style.setProperty('--lt-radius', layout.radius);
  root.style.setProperty('--lt-radius-sm', layout.radiusSm);
  root.style.setProperty('--lt-radius-lg', layout.radiusLg);
  root.style.setProperty('--lt-shadow', layout.shadow);
  root.style.setProperty('--lt-shadow2', dark ? '0 2px 8px rgba(0,0,0,.2)' : '0 2px 8px rgba(0,0,0,.08)');

  root.style.setProperty('--font-display', `'${layout.font}', ${layout.font === layout.fontMono ? 'monospace' : 'sans-serif'}`);
  root.style.setProperty('--font-body', `'${layout.font}', sans-serif`);
  root.style.setProperty('--font-ledger', `'${settings.ledgerFont}', sans-serif`);
  root.style.setProperty('--lt-font', `'${settings.ledgerFont}', sans-serif`);
  root.style.setProperty('--lt-font-mono', `'${layout.fontMono}', 'Fira Code', monospace`);

  const base = Number(settings.ledgerFontSize || FONT_CONFIG.baseSize) || FONT_CONFIG.baseSize;
  const computed = settings.autoFontDisable ? base : detectOptimalFontSize(base, settings.fontVisionProfile);
  const lfsClamped = Math.max(FONT_CONFIG.minSize, Math.min(FONT_CONFIG.maxSize, computed));
  const uiScale = Number((lfsClamped / FONT_CONFIG.baseSize).toFixed(4));
  root.style.setProperty('--app-font', `'${settings.ledgerFont}', sans-serif`);
  root.style.setProperty('--ui-fs', `${lfsClamped}px`);
  root.style.setProperty('--ui-scale', String(uiScale));
  root.style.setProperty('--ledger-font', `'${settings.ledgerFont}', sans-serif`);
  root.style.setProperty('--ledger-fs', `${lfsClamped}px`);
  root.style.setProperty('--ledger-font-size', `${lfsClamped}px`);

  document.body.style.fontFamily = `'${settings.ledgerFont}', sans-serif`;
  document.body.style.fontSize = `${lfsClamped}px`;

  root.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
  root.lang = settings.language;
}