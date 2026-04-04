export type Lang = 'en' | 'ar';

export interface ThemeDef {
  bg: string;
  panel: string;
  panel2: string;
  panel3: string;
  text: string;
  muted: string;
  muted2: string;
  line: string;
  line2: string;
  brand: string;
  brand2: string;
  brand3: string;
  good: string;
  bad: string;
  warn: string;
  sidebarBg: string;
  topbarBg: string;
  cardBg: string;
  inputBg: string;
  hoverCard: string;
  glow: string;
}

export interface LayoutDef {
  id: string;
  name: string;
  desc: string;
  font: string;
  fontMono: string;
  radius: string;
  radiusSm: string;
  radiusLg: string;
  shadow: string;
  swatches: string[];
  themes: Record<string, ThemeDef>;
}

export interface AppSettings {
  layout: string;
  theme: string;
  range: 'today' | '7d' | '30d' | 'this_month' | 'last_month' | 'all';
  currency: 'QAR' | 'USDT';
  language: 'en' | 'ar';
  searchQuery: string;
  lowStockThreshold: number;
  priceAlertThreshold: number;
  allowInvalidTrades: boolean;
  ledgerFont: string;
  ledgerFontSize: number;
  fontVisionProfile: string;
  autoFontDisable: boolean;
  autoBackup: boolean;
  logsEnabled: boolean;
  logLevel: 'error' | 'warn' | 'info';
}

export interface LogEntry {
  id: string;
  ts: number;
  level: 'error' | 'warn' | 'info';
  message: string;
  detail?: string;
}