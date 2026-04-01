import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════════
   THEME & SETTINGS CONTEXT — 100% repo-accurate layout definitions
   Each layout+theme has exact bg/panel/text/brand/sidebar colors
   from the TRACKER_CLOUDFLARE- source repo.
   ═══════════════════════════════════════════════════════════════════ */

// ── Full theme definition per layout+theme combo ──
export interface ThemeDef {
  bg: string; panel: string; panel2: string; panel3: string;
  text: string; muted: string; muted2: string;
  line: string; line2: string;
  brand: string; brand2: string; brand3: string;
  good: string; bad: string; warn: string;
  sidebarBg: string; topbarBg: string;
  cardBg: string; inputBg: string;
  hoverCard: string; glow: string;
}

export interface LayoutDef {
  id: string;
  name: string;
  desc: string;
  font: string;
  fontMono: string;
  radius: string; radiusSm: string; radiusLg: string;
  shadow: string;
  swatches: string[];
  themes: Record<string, ThemeDef>;
}

// ═══ FLUX — Clean SaaS (LIGHT layout) ═══
const FLUX: LayoutDef = {
  id: 'flux', name: 'Flux', desc: 'Clean SaaS · rounded',
  font: 'Inter', fontMono: 'JetBrains Mono',
  radius: '12px', radiusSm: '8px', radiusLg: '16px',
  shadow: '0 4px 20px rgba(0,0,0,.06)',
  swatches: ['#f8faff','#4f46e5','#7c3aed','#16a34a','#dc2626','#0ea5e9','#e11d48','#d97706'],
  themes: {
    t1: { // Indigo Sky
      bg:'#f8faff', panel:'#ffffff', panel2:'#f0f4ff', panel3:'#e8effe',
      text:'#0f172a', muted:'#64748b', muted2:'#94a3b8',
      line:'rgba(15,23,42,.09)', line2:'rgba(15,23,42,.05)',
      brand:'#4f46e5', brand2:'#7c3aed', brand3:'rgba(79,70,229,.1)',
      good:'#16a34a', bad:'#dc2626', warn:'#d97706',
      sidebarBg:'#ffffff', topbarBg:'rgba(255,255,255,.95)',
      cardBg:'#ffffff', inputBg:'rgba(79,70,229,.05)',
      hoverCard:'rgba(79,70,229,.04)', glow:'rgba(79,70,229,.15)',
    },
    t2: { // Teal Mist
      bg:'#f0fdf9', panel:'#ffffff', panel2:'#f0fdfa', panel3:'#ccfbf1',
      text:'#0f2922', muted:'#4d7c6f', muted2:'#7aada4',
      line:'rgba(15,41,34,.09)', line2:'rgba(15,41,34,.05)',
      brand:'#0d9488', brand2:'#059669', brand3:'rgba(13,148,136,.1)',
      good:'#15803d', bad:'#dc2626', warn:'#d97706',
      sidebarBg:'#ffffff', topbarBg:'rgba(255,255,255,.95)',
      cardBg:'#ffffff', inputBg:'rgba(13,148,136,.05)',
      hoverCard:'rgba(13,148,136,.04)', glow:'rgba(13,148,136,.15)',
    },
    t3: { // Rose Quartz
      bg:'#fff1f5', panel:'#ffffff', panel2:'#fff1f5', panel3:'#ffe4e6',
      text:'#2d0014', muted:'#8b3560', muted2:'#c084a0',
      line:'rgba(45,0,20,.09)', line2:'rgba(45,0,20,.05)',
      brand:'#e11d48', brand2:'#db2777', brand3:'rgba(225,29,72,.1)',
      good:'#15803d', bad:'#b91c1c', warn:'#d97706',
      sidebarBg:'#ffffff', topbarBg:'rgba(255,255,255,.95)',
      cardBg:'#ffffff', inputBg:'rgba(225,29,72,.05)',
      hoverCard:'rgba(225,29,72,.04)', glow:'rgba(225,29,72,.15)',
    },
    t4: { // Amber Pro
      bg:'#fffbf0', panel:'#ffffff', panel2:'#fef9ee', panel3:'#fef3c7',
      text:'#1c1400', muted:'#78600a', muted2:'#a88e45',
      line:'rgba(28,20,0,.09)', line2:'rgba(28,20,0,.05)',
      brand:'#d97706', brand2:'#b45309', brand3:'rgba(217,119,6,.1)',
      good:'#15803d', bad:'#dc2626', warn:'#92400e',
      sidebarBg:'#ffffff', topbarBg:'rgba(255,255,255,.95)',
      cardBg:'#ffffff', inputBg:'rgba(217,119,6,.05)',
      hoverCard:'rgba(217,119,6,.04)', glow:'rgba(217,119,6,.15)',
    },
    t5: { // Slate Premium
      bg:'#f8fafc', panel:'#ffffff', panel2:'#f1f5f9', panel3:'#e2e8f0',
      text:'#0f172a', muted:'#475569', muted2:'#94a3b8',
      line:'rgba(15,23,42,.09)', line2:'rgba(15,23,42,.05)',
      brand:'#334155', brand2:'#1e293b', brand3:'rgba(51,65,85,.1)',
      good:'#15803d', bad:'#dc2626', warn:'#d97706',
      sidebarBg:'#1e293b', topbarBg:'rgba(248,250,252,.95)',
      cardBg:'#ffffff', inputBg:'rgba(51,65,85,.05)',
      hoverCard:'rgba(51,65,85,.04)', glow:'rgba(51,65,85,.15)',
    },
  },
};

// ═══ CIPHER — Dark Terminal (DARK layout) ═══
const CIPHER: LayoutDef = {
  id: 'cipher', name: 'Cipher', desc: 'Dark terminal · mono',
  font: 'JetBrains Mono', fontMono: 'JetBrains Mono',
  radius: '4px', radiusSm: '2px', radiusLg: '6px',
  shadow: '0 0 0 1px rgba(255,255,255,.08)',
  swatches: ['#000000','#00ff64','#00d4ff','#ff4040','#ffcc00','#aa44ff','#ff8c00','#6478ff'],
  themes: {
    t1: { // Matrix Green
      bg:'#000000', panel:'#0a0a0a', panel2:'#111111', panel3:'#1a1a1a',
      text:'#e0ffd4', muted:'#5a8c50', muted2:'#3d6035',
      line:'rgba(0,255,100,.1)', line2:'rgba(0,255,100,.05)',
      brand:'#00ff64', brand2:'#00cc50', brand3:'rgba(0,255,100,.1)',
      good:'#00ff64', bad:'#ff4040', warn:'#ffcc00',
      sidebarBg:'#050505', topbarBg:'rgba(0,0,0,.98)',
      cardBg:'#0a0a0a', inputBg:'rgba(0,255,100,.06)',
      hoverCard:'rgba(0,255,100,.05)', glow:'rgba(0,255,100,.2)',
    },
    t2: { // Deep Ocean
      bg:'#000b1a', panel:'#001428', panel2:'#00213d', panel3:'#002e52',
      text:'#b8d8ff', muted:'#4a7fa8', muted2:'#2d5b80',
      line:'rgba(0,150,255,.12)', line2:'rgba(0,150,255,.06)',
      brand:'#0096ff', brand2:'#0064cc', brand3:'rgba(0,150,255,.1)',
      good:'#00d4aa', bad:'#ff4455', warn:'#ffaa00',
      sidebarBg:'#000b1a', topbarBg:'rgba(0,11,26,.98)',
      cardBg:'#001428', inputBg:'rgba(0,150,255,.07)',
      hoverCard:'rgba(0,150,255,.05)', glow:'rgba(0,150,255,.2)',
    },
    t3: { // Neon Purple
      bg:'#0d0015', panel:'#150022', panel2:'#1e0033', panel3:'#280044',
      text:'#e8ccff', muted:'#7a4aa0', muted2:'#5a2880',
      line:'rgba(168,85,247,.12)', line2:'rgba(168,85,247,.06)',
      brand:'#aa44ff', brand2:'#8800ee', brand3:'rgba(168,85,247,.1)',
      good:'#44ff88', bad:'#ff4466', warn:'#ffaa22',
      sidebarBg:'#0d0015', topbarBg:'rgba(13,0,21,.98)',
      cardBg:'#150022', inputBg:'rgba(168,85,247,.07)',
      hoverCard:'rgba(168,85,247,.06)', glow:'rgba(168,85,247,.25)',
    },
    t4: { // Ember
      bg:'#1a0800', panel:'#260c00', panel2:'#331100', panel3:'#401600',
      text:'#ffd4a0', muted:'#a06030', muted2:'#704020',
      line:'rgba(255,140,0,.12)', line2:'rgba(255,140,0,.06)',
      brand:'#ff8c00', brand2:'#ff6600', brand3:'rgba(255,140,0,.1)',
      good:'#44ff88', bad:'#ff3300', warn:'#ffcc00',
      sidebarBg:'#1a0800', topbarBg:'rgba(26,8,0,.98)',
      cardBg:'#260c00', inputBg:'rgba(255,140,0,.07)',
      hoverCard:'rgba(255,140,0,.06)', glow:'rgba(255,140,0,.25)',
    },
    t5: { // Midnight Blue
      bg:'#0a0a14', panel:'#10101e', panel2:'#18182a', panel3:'#202035',
      text:'#c8d0ff', muted:'#5a60a0', muted2:'#3a4080',
      line:'rgba(100,120,255,.1)', line2:'rgba(100,120,255,.05)',
      brand:'#6478ff', brand2:'#4455ee', brand3:'rgba(100,120,255,.1)',
      good:'#44ffaa', bad:'#ff5566', warn:'#ffcc44',
      sidebarBg:'#080814', topbarBg:'rgba(10,10,20,.98)',
      cardBg:'#10101e', inputBg:'rgba(100,120,255,.07)',
      hoverCard:'rgba(100,120,255,.05)', glow:'rgba(100,120,255,.25)',
    },
  },
};













// ═══ DARK LEDGER — Premium dark finance dashboard ═══
const DARK_LEDGER: LayoutDef = {
  id: 'dark_ledger', name: 'Dark Ledger', desc: 'Premium dark · high-contrast data',
  font: 'Inter', fontMono: 'JetBrains Mono',
  radius: '6px', radiusSm: '3px', radiusLg: '10px',
  shadow: '0 2px 8px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.04)',
  swatches: ['#0d1117','#58a6ff','#3fb950','#f85149','#d29922','#bc8cff','#79c0ff','#e3b341'],
  themes: {
    t1: { // GitHub Dark
      bg:'#0d1117', panel:'#161b22', panel2:'#21262d', panel3:'#30363d',
      text:'#c9d1d9', muted:'#8b949e', muted2:'#6e7681',
      line:'rgba(240,246,252,.06)', line2:'rgba(240,246,252,.03)',
      brand:'#58a6ff', brand2:'#79c0ff', brand3:'rgba(88,166,255,.1)',
      good:'#3fb950', bad:'#f85149', warn:'#d29922',
      sidebarBg:'#010409', topbarBg:'rgba(13,17,23,.98)',
      cardBg:'#161b22', inputBg:'rgba(88,166,255,.06)',
      hoverCard:'rgba(88,166,255,.04)', glow:'rgba(88,166,255,.15)',
    },
    t2: { // Violet Night
      bg:'#0f0b1a', panel:'#1a1428', panel2:'#241e38', panel3:'#2e2848',
      text:'#d8ccf0', muted:'#8a78b0', muted2:'#6a58a0',
      line:'rgba(188,140,255,.08)', line2:'rgba(188,140,255,.04)',
      brand:'#bc8cff', brand2:'#a855f7', brand3:'rgba(188,140,255,.1)',
      good:'#3fb950', bad:'#f85149', warn:'#e3b341',
      sidebarBg:'#0a0612', topbarBg:'rgba(15,11,26,.98)',
      cardBg:'#1a1428', inputBg:'rgba(188,140,255,.06)',
      hoverCard:'rgba(188,140,255,.04)', glow:'rgba(168,85,247,.2)',
    },
    t3: { // Emerald Terminal
      bg:'#0a1210', panel:'#0f1c18', panel2:'#142620', panel3:'#1a3028',
      text:'#c8f0d8', muted:'#58a878', muted2:'#388858',
      line:'rgba(63,185,80,.08)', line2:'rgba(63,185,80,.04)',
      brand:'#3fb950', brand2:'#56d364', brand3:'rgba(63,185,80,.1)',
      good:'#3fb950', bad:'#f85149', warn:'#d29922',
      sidebarBg:'#06100c', topbarBg:'rgba(10,18,16,.98)',
      cardBg:'#0f1c18', inputBg:'rgba(63,185,80,.06)',
      hoverCard:'rgba(63,185,80,.04)', glow:'rgba(86,211,100,.15)',
    },
    t4: { // Amber Trading
      bg:'#12100a', panel:'#1c1810', panel2:'#262018', panel3:'#302820',
      text:'#f0dca8', muted:'#b09848', muted2:'#907828',
      line:'rgba(227,179,65,.08)', line2:'rgba(227,179,65,.04)',
      brand:'#e3b341', brand2:'#d29922', brand3:'rgba(227,179,65,.1)',
      good:'#3fb950', bad:'#f85149', warn:'#d29922',
      sidebarBg:'#100e06', topbarBg:'rgba(18,16,10,.98)',
      cardBg:'#1c1810', inputBg:'rgba(227,179,65,.06)',
      hoverCard:'rgba(227,179,65,.04)', glow:'rgba(210,153,34,.2)',
    },
    t5: { // Ice Steel
      bg:'#0c1016', panel:'#121820', panel2:'#18202a', panel3:'#1e2834',
      text:'#c0d4e8', muted:'#6890b0', muted2:'#487098',
      line:'rgba(121,192,255,.08)', line2:'rgba(121,192,255,.04)',
      brand:'#79c0ff', brand2:'#58a6ff', brand3:'rgba(121,192,255,.1)',
      good:'#3fb950', bad:'#f85149', warn:'#e3b341',
      sidebarBg:'#080c12', topbarBg:'rgba(12,16,22,.98)',
      cardBg:'#121820', inputBg:'rgba(121,192,255,.06)',
      hoverCard:'rgba(121,192,255,.04)', glow:'rgba(88,166,255,.15)',
    },
  },
};




// ═══ OPERATIONS DESK — Table-focused, medium-high density, ops workflow ═══
const OPERATIONS_DESK: LayoutDef = {
  id: 'operations_desk', name: 'Operations Desk', desc: 'Table-focused · ops workflow',
  font: 'DM Sans', fontMono: 'IBM Plex Mono',
  radius: '5px', radiusSm: '3px', radiusLg: '8px',
  shadow: '0 1px 4px rgba(0,0,0,.1), 0 0 0 1px rgba(0,0,0,.04)',
  swatches: ['#0b1622','#00c9a7','#ff6b6b','#4ecdc4','#ffe66d','#a855f7','#3b82f6','#f97316'],
  themes: {
    t1: { // Midnight Ops
      bg:'#0b1622', panel:'#111f30', panel2:'#172840', panel3:'#1d3250',
      text:'#d0e4f4', muted:'#5a8aaa', muted2:'#3a6a8a',
      line:'rgba(0,201,167,.1)', line2:'rgba(0,201,167,.05)',
      brand:'#00c9a7', brand2:'#00b094', brand3:'rgba(0,201,167,.1)',
      good:'#00c9a7', bad:'#ff6b6b', warn:'#ffe66d',
      sidebarBg:'#060e18', topbarBg:'rgba(11,22,34,.98)',
      cardBg:'#111f30', inputBg:'rgba(0,201,167,.06)',
      hoverCard:'rgba(0,201,167,.04)', glow:'rgba(0,201,167,.18)',
    },
    t2: { // Arctic Command
      bg:'#080e18', panel:'#0e1828', panel2:'#142238', panel3:'#1a2c48',
      text:'#c8d8f0', muted:'#4878a8', muted2:'#285888',
      line:'rgba(59,130,246,.1)', line2:'rgba(59,130,246,.05)',
      brand:'#3b82f6', brand2:'#60a5fa', brand3:'rgba(59,130,246,.1)',
      good:'#4ecdc4', bad:'#ff6b6b', warn:'#ffe66d',
      sidebarBg:'#04080e', topbarBg:'rgba(8,14,24,.98)',
      cardBg:'#0e1828', inputBg:'rgba(59,130,246,.06)',
      hoverCard:'rgba(59,130,246,.04)', glow:'rgba(96,165,250,.18)',
    },
    t3: { // Flame Console
      bg:'#14100a', panel:'#1e1810', panel2:'#282018', panel3:'#322820',
      text:'#f0d8b8', muted:'#a08050', muted2:'#806030',
      line:'rgba(249,115,22,.1)', line2:'rgba(249,115,22,.05)',
      brand:'#f97316', brand2:'#fb923c', brand3:'rgba(249,115,22,.1)',
      good:'#4ecdc4', bad:'#ff6b6b', warn:'#ffe66d',
      sidebarBg:'#100c06', topbarBg:'rgba(20,16,10,.98)',
      cardBg:'#1e1810', inputBg:'rgba(249,115,22,.06)',
      hoverCard:'rgba(249,115,22,.04)', glow:'rgba(251,146,60,.2)',
    },
  },
};







// ═══ ATLAS GRID — Command-center, spatial ops board ═══
const ATLAS_GRID: LayoutDef = {
  id: 'atlas_grid', name: 'Atlas Grid', desc: 'Command-center · spatial ops',
  font: 'Manrope', fontMono: 'IBM Plex Mono',
  radius: '4px', radiusSm: '2px', radiusLg: '6px',
  shadow: '0 0 0 1px rgba(44,36,26,.08)',
  swatches: ['#E9E2D3','#8E3B2E','#355C4B','#3E6B57','#A43A32','#C17A1C','#3B3124','#B7AA8B'],
  themes: {
    t1: { // Earth Grid
      bg:'#E9E2D3', panel:'#D6CCB8', panel2:'#B7AA8B', panel3:'#8C7A5B',
      text:'#2C241A', muted:'#5F5442', muted2:'#7B6E58',
      line:'rgba(44,36,26,.12)', line2:'rgba(44,36,26,.06)',
      brand:'#8E3B2E', brand2:'#355C4B', brand3:'rgba(142,59,46,.10)',
      good:'#3E6B57', bad:'#A43A32', warn:'#C17A1C',
      sidebarBg:'#3B3124', topbarBg:'rgba(233,226,211,.95)',
      cardBg:'#DCCFB7', inputBg:'rgba(142,59,46,.05)',
      hoverCard:'rgba(53,92,75,.06)', glow:'rgba(193,122,28,.08)',
    },
    t2: { // Survey Copper
      bg:'#EDE5D6', panel:'#DDD2BC', panel2:'#C4B59A', panel3:'#9A8768',
      text:'#2A1F14', muted:'#6B5038', muted2:'#8A7054',
      line:'rgba(42,31,20,.12)', line2:'rgba(42,31,20,.06)',
      brand:'#A85C3A', brand2:'#7A4A2F', brand3:'rgba(168,92,58,.10)',
      good:'#4A7D5E', bad:'#B24430', warn:'#D4882A',
      sidebarBg:'#3A281C', topbarBg:'rgba(237,229,214,.95)',
      cardBg:'#E0D4BE', inputBg:'rgba(168,92,58,.05)',
      hoverCard:'rgba(122,74,47,.06)', glow:'rgba(212,136,42,.08)',
    },
    t3: { // Moss Command
      bg:'#E4E2D4', panel:'#D0CCBA', panel2:'#AAA88E', panel3:'#7E7C64',
      text:'#1E2A1E', muted:'#445040', muted2:'#667860',
      line:'rgba(30,42,30,.12)', line2:'rgba(30,42,30,.06)',
      brand:'#355C4B', brand2:'#4A7A5E', brand3:'rgba(53,92,75,.10)',
      good:'#2E6A4F', bad:'#9E3A30', warn:'#B07820',
      sidebarBg:'#2A3828', topbarBg:'rgba(228,226,212,.95)',
      cardBg:'#D4D0B8', inputBg:'rgba(53,92,75,.05)',
      hoverCard:'rgba(74,122,94,.06)', glow:'rgba(46,106,79,.08)',
    },
  },
};

// ═══ VELVET MONO — Luxury private desk, dark premium ═══
const VELVET_MONO: LayoutDef = {
  id: 'velvet_mono', name: 'Velvet Mono', desc: 'Luxury dark · editorial restraint',
  font: 'Fraunces', fontMono: 'IBM Plex Mono',
  radius: '10px', radiusSm: '6px', radiusLg: '14px',
  shadow: '0 4px 16px rgba(0,0,0,.2)',
  swatches: ['#161116','#D3A15F','#8C6A9F','#7FA483','#C46A6A','#D9A441','#120D12','#3A2B37'],
  themes: {
    t1: { // Gold Reserve
      bg:'#161116', panel:'#211821', panel2:'#2B202A', panel3:'#3A2B37',
      text:'#F4E9E2', muted:'#B9A6AE', muted2:'#8E7C84',
      line:'rgba(244,233,226,.08)', line2:'rgba(244,233,226,.04)',
      brand:'#D3A15F', brand2:'#8C6A9F', brand3:'rgba(211,161,95,.10)',
      good:'#7FA483', bad:'#C46A6A', warn:'#D9A441',
      sidebarBg:'#120D12', topbarBg:'rgba(22,17,22,.95)',
      cardBg:'#241B24', inputBg:'rgba(211,161,95,.05)',
      hoverCard:'rgba(140,106,159,.06)', glow:'rgba(211,161,95,.10)',
    },
    t2: { // Plum Ledger
      bg:'#18101A', panel:'#261A28', panel2:'#342438', panel3:'#442E48',
      text:'#EDE0F0', muted:'#A890B0', muted2:'#886E98',
      line:'rgba(237,224,240,.08)', line2:'rgba(237,224,240,.04)',
      brand:'#9E6AB8', brand2:'#C89ADF', brand3:'rgba(158,106,184,.10)',
      good:'#78A880', bad:'#C46A6A', warn:'#D4A040',
      sidebarBg:'#140C16', topbarBg:'rgba(24,16,26,.95)',
      cardBg:'#2A1E2E', inputBg:'rgba(158,106,184,.05)',
      hoverCard:'rgba(200,154,223,.06)', glow:'rgba(158,106,184,.10)',
    },
    t3: { // Steel Orchid
      bg:'#141418', panel:'#1E1E26', panel2:'#282832', panel3:'#38384A',
      text:'#E8E4F0', muted:'#9A98B0', muted2:'#7A7890',
      line:'rgba(232,228,240,.08)', line2:'rgba(232,228,240,.04)',
      brand:'#7A8A9F', brand2:'#9F7AAF', brand3:'rgba(122,138,159,.10)',
      good:'#7AAF8A', bad:'#BF6868', warn:'#D0A040',
      sidebarBg:'#0E0E14', topbarBg:'rgba(20,20,24,.95)',
      cardBg:'#222228', inputBg:'rgba(122,138,159,.05)',
      hoverCard:'rgba(159,122,175,.06)', glow:'rgba(122,138,159,.10)',
    },
  },
};

// ═══ PAPERWIRE — Analytical newsroom, audit-desk ═══
const PAPERWIRE: LayoutDef = {
  id: 'paperwire', name: 'Paperwire', desc: 'Audit-desk · document-first',
  font: 'Instrument Serif', fontMono: 'IBM Plex Mono',
  radius: '2px', radiusSm: '0px', radiusLg: '3px',
  shadow: 'none',
  swatches: ['#F3EFE6','#005F73','#9B2226','#2D6A4F','#AE2012','#BB7A00','#2A2118','#CFC1AA'],
  themes: {
    t1: { // Blue Dossier
      bg:'#F3EFE6', panel:'#FFFDF8', panel2:'#E7DECF', panel3:'#CFC1AA',
      text:'#181512', muted:'#6A6056', muted2:'#94877A',
      line:'rgba(24,21,18,.10)', line2:'rgba(24,21,18,.05)',
      brand:'#005F73', brand2:'#9B2226', brand3:'rgba(0,95,115,.08)',
      good:'#2D6A4F', bad:'#AE2012', warn:'#BB7A00',
      sidebarBg:'#2A2118', topbarBg:'rgba(243,239,230,.96)',
      cardBg:'#FFFDF8', inputBg:'rgba(0,95,115,.04)',
      hoverCard:'rgba(155,34,38,.04)', glow:'rgba(0,95,115,.06)',
    },
    t2: { // Redline Review
      bg:'#F5F0E8', panel:'#FFFCF6', panel2:'#EBDDD0', panel3:'#D4C0A8',
      text:'#1A1210', muted:'#6E4A3A', muted2:'#9A7466',
      line:'rgba(26,18,16,.10)', line2:'rgba(26,18,16,.05)',
      brand:'#9B2226', brand2:'#005F73', brand3:'rgba(155,34,38,.08)',
      good:'#2D6A4F', bad:'#7A1510', warn:'#C47A00',
      sidebarBg:'#2C1A14', topbarBg:'rgba(245,240,232,.96)',
      cardBg:'#FFFCF6', inputBg:'rgba(155,34,38,.04)',
      hoverCard:'rgba(0,95,115,.04)', glow:'rgba(155,34,38,.06)',
    },
    t3: { // Archive Moss
      bg:'#F0EDE4', panel:'#FDFBF4', panel2:'#E2DDD0', panel3:'#C8C0AC',
      text:'#161810', muted:'#4A5842', muted2:'#788A6E',
      line:'rgba(22,24,16,.10)', line2:'rgba(22,24,16,.05)',
      brand:'#2D6A4F', brand2:'#9B2226', brand3:'rgba(45,106,79,.08)',
      good:'#1E5A3A', bad:'#AE2012', warn:'#A87800',
      sidebarBg:'#1E2A1C', topbarBg:'rgba(240,237,228,.96)',
      cardBg:'#FDFBF4', inputBg:'rgba(45,106,79,.04)',
      hoverCard:'rgba(155,34,38,.04)', glow:'rgba(45,106,79,.06)',
    },
  },
};

// ═══ SIGNAL DECK — Navy command dashboard, color-coded KPIs ═══
const SIGNAL_DECK: LayoutDef = {
  id: 'signal_deck', name: 'Signal Deck', desc: 'Navy command · color-coded data',
  font: 'Inter', fontMono: 'JetBrains Mono',
  radius: '10px', radiusSm: '8px', radiusLg: '14px',
  shadow: '0 1px 3px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.03)',
  swatches: ['#0d1321','#10b981','#6366f1','#f59e0b','#a855f7','#ec4899','#06b6d4','#ef4444'],
  themes: {
    t1: { // Emerald Signal (primary reference)
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#10b981', brand2:'#34d399', brand3:'rgba(16,185,129,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(16,185,129,.04)', glow:'rgba(16,185,129,.15)',
    },
    t2: { // Azure Signal
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#6366f1', brand2:'#818cf8', brand3:'rgba(99,102,241,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(99,102,241,.04)', glow:'rgba(129,140,248,.15)',
    },
    t3: { // Amber Signal
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#f59e0b', brand2:'#fbbf24', brand3:'rgba(245,158,11,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(245,158,11,.04)', glow:'rgba(251,191,36,.15)',
    },
    t4: { // Violet Signal
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#a855f7', brand2:'#c084fc', brand3:'rgba(168,85,247,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(168,85,247,.04)', glow:'rgba(192,132,252,.15)',
    },
    t5: { // Cyan Signal
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#06b6d4', brand2:'#22d3ee', brand3:'rgba(6,182,212,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(6,182,212,.04)', glow:'rgba(34,211,238,.15)',
    },
  },
};

export const LAYOUTS: LayoutDef[] = [FLUX, CIPHER, DARK_LEDGER, OPERATIONS_DESK, ATLAS_GRID, VELVET_MONO, PAPERWIRE, SIGNAL_DECK];
export const THEME_NAMES: Record<string, string> = { t1: 'Theme 1', t2: 'Theme 2', t3: 'Theme 3', t4: 'Theme 4', t5: 'Theme 5' };
export const FONTS = ['Inter','JetBrains Mono','Space Grotesk','Sora','Plus Jakarta Sans','DM Sans','Outfit','Fira Code','IBM Plex Mono','Roboto','Manrope','Fraunces','Instrument Serif','Public Sans'];
export const FONT_SIZES = [9,10,11,12,13,14];
export const VISION_PROFILES = ['standard','large','xlarge','compact'] as const;

// ── FONT_CONFIG — exact match from TRACKER_CLOUDFLARE- repo ──
export const FONT_CONFIG = {
  baseSize: 11, minSize: 9, maxSize: 18,
  breakpoints: { mobile: 480, tablet: 900, desktop: 1366, wide: 1920 },
  scaleFactors: { mobile: 0.9, tablet: 1.0, desktop: 1.05, wide: 1.1 },
  visionProfiles: { standard: 1.0, large: 1.15, xlarge: 1.3, compact: 0.9 } as Record<string, number>,
};

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

// ── Settings shape ──
export interface AppSettings {
  layout: string;
  theme: string;
  range: 'today' | '7d' | '30d' | 'all';
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

const DEFAULT_SETTINGS: AppSettings = {
  layout: 'flux', theme: 't1',
  range: '7d', currency: 'QAR', language: 'en', searchQuery: '',
  lowStockThreshold: 5000, priceAlertThreshold: 2,
  allowInvalidTrades: true,
  ledgerFont: 'Inter', ledgerFontSize: 11,
  fontVisionProfile: 'standard', autoFontDisable: false,
  autoBackup: false, logsEnabled: true, logLevel: 'info',
};

// ── Log entry ──
export interface LogEntry {
  id: string;
  ts: number;
  level: 'error' | 'warn' | 'info';
  message: string;
  detail?: string;
}

// ── Context shape ──
interface ThemeContextValue {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  save: () => void;
  discard: () => void;
  isDirty: boolean;
  currentLayout: LayoutDef;
  currentTheme: ThemeDef;
  logs: LogEntry[];
  addLog: (level: LogEntry['level'], message: string, detail?: string) => void;
  clearLogs: () => void;
  downloadLogs: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Hex to HSL converter ──
function hexToHSL(hex: string): string {
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

// Is a color "dark"? (luminance < 0.4)
function isDark(hex: string): boolean {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.4;
}

// Removed layout IDs that must migrate to valid replacements
const REMOVED_LAYOUTS: Record<string, string> = { aurora: 'cipher', carbon: 'cipher', prism: 'flux', pulse: 'cipher', solid_advisory: 'flux', editorial_finance: 'flux', executive_hub: 'flux', ledger_pro: 'dark_ledger' };

function loadSavedSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('tracker_settings');
    if (raw) {
      const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      // Migrate removed layouts
      if (REMOVED_LAYOUTS[parsed.layout]) {
        parsed.layout = REMOVED_LAYOUTS[parsed.layout];
        parsed.theme = 't1';
        localStorage.setItem('tracker_settings', JSON.stringify(parsed));
      }
      return parsed;
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function loadLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem('tracker_logs');
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

// visionMultiplier removed — now using detectOptimalFontSize from FONT_CONFIG

function getTheme(layoutId: string, themeId: string): { layout: LayoutDef; theme: ThemeDef } {
  const layout = LAYOUTS.find(l => l.id === layoutId) || LAYOUTS[0];
  const theme = layout.themes[themeId] || layout.themes.t1;
  return { layout, theme };
}

// ── Apply CSS variables to :root ──
function applyThemeToDOM(settings: AppSettings) {
  const root = document.documentElement;
  const { layout, theme } = getTheme(settings.layout, settings.theme);
  const dark = isDark(theme.bg);

  // Toggle dark class based on actual background luminance
  if (dark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  // Background & foreground
  root.style.setProperty('--background', hexToHSL(theme.bg));
  root.style.setProperty('--foreground', hexToHSL(theme.text));

  // Card
  root.style.setProperty('--card', hexToHSL(theme.cardBg));
  root.style.setProperty('--card-foreground', hexToHSL(theme.text));

  // Popover
  root.style.setProperty('--popover', hexToHSL(theme.panel));
  root.style.setProperty('--popover-foreground', hexToHSL(theme.text));

  // Primary
  root.style.setProperty('--primary', hexToHSL(theme.brand));
  root.style.setProperty('--primary-foreground', dark ? hexToHSL(theme.bg) : '0 0% 100%');

  // Secondary
  root.style.setProperty('--secondary', hexToHSL(theme.panel2));
  root.style.setProperty('--secondary-foreground', hexToHSL(theme.text));

  // Muted
  root.style.setProperty('--muted', hexToHSL(theme.panel3));
  root.style.setProperty('--muted-foreground', hexToHSL(theme.muted));

  // Accent (good/success)
  root.style.setProperty('--accent', hexToHSL(theme.panel2));
  root.style.setProperty('--accent-foreground', hexToHSL(theme.text));

  // Destructive
  root.style.setProperty('--destructive', hexToHSL(theme.bad));
  root.style.setProperty('--destructive-foreground', '0 0% 100%');

  // Warning & Success semantic colors
  root.style.setProperty('--warning', hexToHSL(theme.warn));
  root.style.setProperty('--warning-foreground', '0 0% 100%');
  root.style.setProperty('--success', hexToHSL(theme.good));
  root.style.setProperty('--success-foreground', '0 0% 100%');

  // Border / Input / Ring
  root.style.setProperty('--border', hexToHSL(theme.panel3));
  root.style.setProperty('--input', hexToHSL(theme.panel3));
  root.style.setProperty('--ring', hexToHSL(theme.brand));

  // Radius
  root.style.setProperty('--radius', layout.radius);

  // Sidebar — use sidebar-specific bg or derive from theme
  const sidebarDark = isDark(theme.sidebarBg);
  root.style.setProperty('--sidebar-background', hexToHSL(theme.sidebarBg));
  root.style.setProperty('--sidebar-foreground', sidebarDark ? '210 40% 92%' : hexToHSL(theme.text));
  root.style.setProperty('--sidebar-primary', hexToHSL(theme.brand));
  root.style.setProperty('--sidebar-primary-foreground', '0 0% 100%');
  root.style.setProperty('--sidebar-accent', sidebarDark ? hexToHSL(theme.panel2) : hexToHSL(theme.panel3));
  root.style.setProperty('--sidebar-accent-foreground', sidebarDark ? '210 40% 92%' : hexToHSL(theme.text));
  root.style.setProperty('--sidebar-border', hexToHSL(theme.panel3));
  root.style.setProperty('--sidebar-ring', hexToHSL(theme.brand));

  // Chart colors
  root.style.setProperty('--chart-1', hexToHSL(theme.brand));
  root.style.setProperty('--chart-2', hexToHSL(theme.good));
  root.style.setProperty('--chart-3', hexToHSL(theme.warn));
  root.style.setProperty('--chart-4', hexToHSL(theme.brand2));
  root.style.setProperty('--chart-5', hexToHSL(theme.bad));

  // Tracker palette (for tracker.css pages)
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

  // Tracker layout geometry
  root.style.setProperty('--lt-radius', layout.radius);
  root.style.setProperty('--lt-radius-sm', layout.radiusSm);
  root.style.setProperty('--lt-radius-lg', layout.radiusLg);
  root.style.setProperty('--lt-shadow', layout.shadow);
  root.style.setProperty('--lt-shadow2', dark ? '0 2px 8px rgba(0,0,0,.2)' : '0 2px 8px rgba(0,0,0,.08)');

  // Fonts
  root.style.setProperty('--font-display', `'${layout.font}', ${layout.font === layout.fontMono ? 'monospace' : 'sans-serif'}`);
  root.style.setProperty('--font-body', `'${layout.font}', sans-serif`);
  root.style.setProperty('--font-ledger', `'${settings.ledgerFont}', sans-serif`);
  root.style.setProperty('--lt-font', `'${settings.ledgerFont}', sans-serif`);
  root.style.setProperty('--lt-font-mono', `'${layout.fontMono}', 'Fira Code', monospace`);

  // Font size — exact replica of detectOptimalFontSize_ from source repo
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

  // Global font application
  document.body.style.fontFamily = `'${settings.ledgerFont}', sans-serif`;
  document.body.style.fontSize = `${lfsClamped}px`;

  // RTL support
  root.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
  root.lang = settings.language;
}

// ── Provider ──
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<AppSettings>(loadSavedSettings);
  const [draft, setDraft] = useState<AppSettings>(loadSavedSettings);
  const [dirty, setDirty] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(loadLogs);
  const [cloudPrefsLoaded, setCloudPrefsLoaded] = useState(false);
  const logsRef = useRef(logs);
  const settingsRef = useRef(draft);
  logsRef.current = logs;
  settingsRef.current = draft;

  const pushLog = useCallback((level: LogEntry['level'], message: string, detail?: string) => {
    const settingsNow = settingsRef.current;
    if (!settingsNow.logsEnabled) return;
    const levels: Record<LogEntry['level'], number> = { error: 0, warn: 1, info: 2 };
    if (levels[level] > levels[settingsNow.logLevel]) return;

    const entry: LogEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      level,
      message,
      detail,
    };

    setLogs(prev => {
      const next = [entry, ...prev].slice(0, 500);
      localStorage.setItem('tracker_logs', JSON.stringify(next));
      return next;
    });
  }, []);

  // Apply theme on every draft change (live preview)
  useEffect(() => {
    applyThemeToDOM(draft);
  }, [draft]);

  // Auto-refresh font size on resize (matching source repo)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        // Only re-apply if auto-font is enabled
        if (!settingsRef.current.autoFontDisable) {
          applyThemeToDOM(settingsRef.current);
        }
      }, 250);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (t) clearTimeout(t);
    };
  }, []);

  // Runtime error capture
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      pushLog('error', event.message || 'Runtime error', String(event.error?.stack || event.error || 'Unknown error'));
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      pushLog('error', 'Unhandled promise rejection', String(event.reason ?? 'Unknown reason'));
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [pushLog]);

  // Load all Google Fonts on mount + load cloud preferences
  useEffect(() => {
    applyThemeToDOM(saved);
    const fonts = [...new Set(LAYOUTS.map(l => l.font).concat(FONTS))];
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${fonts.map(f => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700;800`).join('&')}&display=swap`;
    document.head.appendChild(link);

    // Load preferences from cloud
    import('./tracker-sync').then(({ loadPreferencesFromCloud }) => {
      loadPreferencesFromCloud().then((cloudPrefs) => {
        setCloudPrefsLoaded(true);
        if (!cloudPrefs) return;
        // Merge cloud prefs with defaults, cloud wins
        const merged = { ...DEFAULT_SETTINGS, ...cloudPrefs } as AppSettings;
        // Validate layout exists
        if (!LAYOUTS.find(l => l.id === merged.layout)) {
          merged.layout = DEFAULT_SETTINGS.layout;
          merged.theme = DEFAULT_SETTINGS.theme;
        }
        setSaved(merged);
        setDraft(merged);
        setDirty(false);
        localStorage.setItem('tracker_settings', JSON.stringify(merged));
        applyThemeToDOM(merged);
        pushLog('info', 'Preferences loaded from cloud');
      }).catch(() => {
        setCloudPrefsLoaded(true);
      });
    });
  }, []);

  // Auto-save timer ref
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback((patch: Partial<AppSettings>) => {
    const changed = (Object.keys(patch) as (keyof AppSettings)[]).filter((key) => draft[key] !== patch[key]);
    if (changed.length === 0) return;

    const next = { ...draft, ...patch };
    setDraft(next);
    setDirty(true);

    const isTypingOnly = changed.length === 1 && changed[0] === 'searchQuery';
    if (!(patch.logsEnabled === false && changed.length === 1) && !isTypingOnly) {
      pushLog('info', `Settings updated: ${changed.join(', ')}`);
    }

    // Auto-save after 800ms debounce
    if (!isTypingOnly) {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        localStorage.setItem('tracker_settings', JSON.stringify(next));
        setSaved(next);
        setDirty(false);
        pushLog('info', 'Auto-saved settings');
        // Sync preferences to cloud
        import('./tracker-sync').then(({ savePreferencesToCloud }) => {
          savePreferencesToCloud(next as unknown as Record<string, unknown>);
        });
      }, 800);
    }
  }, [draft, pushLog]);

  const save = useCallback(() => {
    localStorage.setItem('tracker_settings', JSON.stringify(draft));
    setSaved(draft);
    setDirty(false);
    pushLog('info', 'Settings saved');
    // Sync preferences to cloud immediately
    import('./tracker-sync').then(({ savePreferencesNow }) => {
      void savePreferencesNow(draft as unknown as Record<string, unknown>);
    });
  }, [draft, pushLog]);

  const discard = useCallback(() => {
    setDraft(saved);
    setDirty(false);
    pushLog('warn', 'Pending settings changes discarded');
  }, [saved, pushLog]);

  const addLog = useCallback((level: LogEntry['level'], message: string, detail?: string) => {
    pushLog(level, message, detail);
  }, [pushLog]);

  const clearLogs = useCallback(() => {
    setLogs([]);
    localStorage.setItem('tracker_logs', '[]');
  }, []);

  const downloadLogs = useCallback(() => {
    const content = JSON.stringify(logsRef.current, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tracker-logs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }, []);

  const { layout: currentLayout, theme: currentTheme } = getTheme(draft.layout, draft.theme);

  return (
    <ThemeContext.Provider value={{
      settings: draft, update, save, discard, isDirty: dirty,
      currentLayout, currentTheme,
      logs, addLog, clearLogs, downloadLogs,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
