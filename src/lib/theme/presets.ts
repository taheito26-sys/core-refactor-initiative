import type { ThemeDef } from './types';

// ─── Featured colour sets ───
// Seven palettes offered with every layout, from the colour button in the top bar, next to the layout's own sets.
// They change colours only; the layout keeps its fonts, shapes and spacing. Ids start with `p_` so they never
// collide with a layout's own t1…t5.

const light = (o: {
  bg: string; panel2: string; panel3: string; text: string; muted: string; muted2: string;
  brand: string; brand2: string; line: string; tint: string; sidebar?: string;
}): ThemeDef => ({
  bg: o.bg, panel: '#ffffff', panel2: o.panel2, panel3: o.panel3,
  text: o.text, muted: o.muted, muted2: o.muted2,
  line: `rgba(${o.line},.10)`, line2: `rgba(${o.line},.05)`,
  brand: o.brand, brand2: o.brand2, brand3: `rgba(${o.tint},.10)`,
  good: '#16a34a', bad: '#dc2626', warn: '#d97706',
  sidebarBg: o.sidebar ?? '#ffffff', topbarBg: 'rgba(255,255,255,.95)',
  cardBg: '#ffffff', inputBg: `rgba(${o.tint},.05)`,
  hoverCard: `rgba(${o.tint},.04)`, glow: `rgba(${o.tint},.14)`,
});

export const PRESET_THEMES: Record<string, ThemeDef> = {
  p_sage: { ...light({
    bg: '#F6F8F5', panel2: '#E7EDE7', panel3: '#CFDCD1', text: '#17241C', muted: '#5E6E64', muted2: '#94A3B8',
    brand: '#2E7D52', brand2: '#0F5132', line: '23,36,28', tint: '46,125,82',
  }), chartBar: '#6FB48C', chartLine: '#0F5132', cashTone: '#1F6B45' },
  p_sand: { ...light({
    bg: '#FAF8F5', panel2: '#EDE5DA', panel3: '#DCCBB4', text: '#2A2017', muted: '#76675A', muted2: '#B89B7A',
    brand: '#9A6B35', brand2: '#7C5A2B', line: '42,32,23', tint: '154,107,53',
  }), chartBar: '#C9AE8A', chartLine: '#7C5A2B', cashTone: '#8B6234' },
  p_steel: { ...light({
    bg: '#F5F7FA', panel2: '#E2E8F0', panel3: '#CBD5E1', text: '#1E293B', muted: '#64748B', muted2: '#94A3B8',
    brand: '#2563EB', brand2: '#1E293B', line: '30,41,59', tint: '37,99,235',
  }), chartBar: '#6E9CEB', chartLine: '#1E293B', cashTone: '#2563EB' },
  p_clean: { ...light({
    bg: '#F8F9FA', panel2: '#EEF1F3', panel3: '#DDE3E7', text: '#18212B', muted: '#6B7280', muted2: '#9CA3AF',
    brand: '#2FA36B', brand2: '#5B6470', line: '24,33,43', tint: '47,163,107',
  }), chartBar: '#5CC08F', chartLine: '#2FA36B', cashTone: '#E8892B' },
  p_softblue: { ...light({
    bg: '#EEF5FC', panel2: '#DBEAFE', panel3: '#BFD8F5', text: '#1C2B3D', muted: '#64748B', muted2: '#94A3B8',
    brand: '#3B82F6', brand2: '#93C5FD', line: '28,43,61', tint: '59,130,246',
  }), chartBar: '#7FB0F7', chartLine: '#3B82F6', cashTone: '#3B82F6' },
  p_slate: { ...light({
    bg: '#ECEEF1', panel2: '#E3E6EA', panel3: '#C9CED6', text: '#1F2933', muted: '#6B7280', muted2: '#9CA3AF',
    brand: '#374151', brand2: '#6B7280', line: '31,41,51', tint: '55,65,81',
  }), chartBar: '#8A919C', chartLine: '#374151', cashTone: '#374151' },
  p_dark: {
    bg: '#0B0B0C', panel: '#161617', panel2: '#1E1E20', panel3: '#2A2A2D',
    text: '#F4F2EE', muted: '#A3A09A', muted2: '#6E6B66',
    line: 'rgba(255,255,255,.08)', line2: 'rgba(255,255,255,.04)',
    brand: '#E9B872', brand2: '#C9A06A', brand3: 'rgba(233,184,114,.12)',
    good: '#22c55e', bad: '#ef4444', warn: '#f59e0b',
    sidebarBg: '#0B0B0C', topbarBg: 'rgba(11,11,12,.96)',
    cardBg: '#161617', inputBg: 'rgba(233,184,114,.05)',
    hoverCard: 'rgba(233,184,114,.05)', glow: 'rgba(233,184,114,.18)',
    chartBar: '#D9B57E', chartLine: '#E9B872', cashTone: '#E9B872',
  },
};

export const PRESET_NAMES: Record<string, { en: string; ar: string }> = {
  p_sage: { en: 'Sage Minimal', ar: 'المريمية' },
  p_sand: { en: 'Warm Sand', ar: 'الرمل الدافئ' },
  p_steel: { en: 'Steel Blue', ar: 'الأزرق الفولاذي' },
  p_clean: { en: 'Light (Clean)', ar: 'فاتح نظيف' },
  p_softblue: { en: 'Soft Blue', ar: 'أزرق ناعم' },
  p_slate: { en: 'Neutral Slate', ar: 'رمادي محايد' },
  p_dark: { en: 'Dark (Premium)', ar: 'داكن فاخر' },
};
