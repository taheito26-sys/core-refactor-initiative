import type { ThemeDef } from './types';

// ─── Featured colour sets ───
// Shared palettes offered with every layout, from the colour button in the top bar, next to the layout's own sets.
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
  p_lavender: { ...light({
    bg: '#F7F3FC', panel2: '#EDE4F7', panel3: '#DAC8EF', text: '#30213F', muted: '#756480', muted2: '#9C8BA8',
    brand: '#8B5FC0', brand2: '#684194', line: '48,33,63', tint: '139,95,192',
  }), chartBar: '#B69AD7', chartLine: '#684194', cashTone: '#8050B4' },
  p_rose: { ...light({
    bg: '#FFF5F9', panel2: '#FCE3EE', panel3: '#F4BFD5', text: '#402333', muted: '#856575', muted2: '#AD8A9B',
    brand: '#C7357B', brand2: '#922354', line: '64,35,51', tint: '199,53,123',
  }), chartBar: '#E78DB5', chartLine: '#922354', cashTone: '#B72C6D' },
  p_coral: { ...light({
    bg: '#FFF6F3', panel2: '#FCE5DD', panel3: '#F6C6B6', text: '#422A24', muted: '#856B62', muted2: '#B08C7E',
    brand: '#C75137', brand2: '#943D2B', line: '66,42,36', tint: '199,81,55',
  }), chartBar: '#EC9A82', chartLine: '#943D2B', cashTone: '#B54730' },
  p_mint: { ...light({
    bg: '#F0FBF7', panel2: '#DAF3E8', panel3: '#B3E4D1', text: '#19392D', muted: '#5C7A6D', muted2: '#85A697',
    brand: '#17835F', brand2: '#116247', line: '25,57,45', tint: '23,131,95',
  }), chartBar: '#77CCAA', chartLine: '#116247', cashTone: '#17835F' },
  p_ocean: { ...light({
    bg: '#F0FAFB', panel2: '#D9F0F2', panel3: '#AEE0E4', text: '#19363D', muted: '#5D7980', muted2: '#86A4AB',
    brand: '#087F8C', brand2: '#065B66', line: '25,54,61', tint: '8,127,140',
  }), chartBar: '#61BFC9', chartLine: '#065B66', cashTone: '#087F8C' },
  p_sunset: { ...light({
    bg: '#FFF8EF', panel2: '#FFEDD5', panel3: '#FED4AA', text: '#432D20', muted: '#866E5B', muted2: '#AD9075',
    brand: '#B85C09', brand2: '#C44450', line: '67,45,32', tint: '184,92,9',
  }), chartBar: '#F4AD56', chartLine: '#C44450', cashTone: '#B85C09' },
  p_amethyst: { ...light({
    bg: '#F7F0FC', panel2: '#EDDEF7', panel3: '#D9B8EC', text: '#352043', muted: '#796386', muted2: '#A088AF',
    brand: '#9238B5', brand2: '#64277E', line: '53,32,67', tint: '146,56,181',
  }), chartBar: '#BC80D5', chartLine: '#64277E', cashTone: '#9238B5' },
  p_graphite: {
    bg: '#16191E', panel: '#22262D', panel2: '#2C313A', panel3: '#3B424D',
    text: '#F3F4F6', muted: '#B0B7C2', muted2: '#87919F',
    line: 'rgba(255,255,255,.12)', line2: 'rgba(255,255,255,.06)',
    brand: '#B8C5D6', brand2: '#879BB5', brand3: 'rgba(184,197,214,.12)',
    good: '#4ADE80', bad: '#FB7185', warn: '#FBBF24',
    sidebarBg: '#16191E', topbarBg: 'rgba(22,25,30,.96)',
    cardBg: '#22262D', inputBg: 'rgba(184,197,214,.06)',
    hoverCard: 'rgba(184,197,214,.06)', glow: 'rgba(184,197,214,.16)',
    chartBar: '#879BB5', chartLine: '#B8C5D6', cashTone: '#D1DAE6',
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
  p_lavender: { en: 'Lavender', ar: 'لافندر' },
  p_rose: { en: 'Rose Pink', ar: 'وردي' },
  p_coral: { en: 'Coral', ar: 'مرجاني' },
  p_mint: { en: 'Mint', ar: 'نعناعي' },
  p_ocean: { en: 'Ocean Teal', ar: 'فيروزي المحيط' },
  p_sunset: { en: 'Sunset', ar: 'غروب الشمس' },
  p_amethyst: { en: 'Amethyst', ar: 'جمشت' },
  p_graphite: { en: 'Graphite', ar: 'جرافيت' },
};
