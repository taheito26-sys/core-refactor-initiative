import { LayoutDef } from './types';

// ═══ TERMINAL HIGH-CONTRAST — Maximum Visibility ═══
const TERMINAL_HC: LayoutDef = {
  id: 'terminal_hc', name: 'Terminal HC', desc: 'Maximum contrast · neon numbers',
  font: 'JetBrains Mono', fontMono: 'JetBrains Mono',
  radius: '4px', radiusSm: '2px', radiusLg: '8px',
  shadow: '0 0 0 2px #ffffff, 0 10px 40px rgba(0,0,0,0.8)',
  swatches: ['#000000','#00ffff','#00ff00','#ff0000','#ffff00','#ffffff','#1a1a1a','#333333'],
  themes: {
    t1: { // Neon Matrix
      bg:'#000000', panel:'#0a0a0a', panel2:'#141414', panel3:'#222222',
      text:'#ffffff', muted:'#a0a0a0', muted2:'#666666',
      line:'#333333', line2:'#1a1a1a',
      brand:'#00ffff', brand2:'#00cccc', brand3:'rgba(0,255,255,0.15)',
      good:'#00ff00', bad:'#ff0000', warn:'#ffff00',
      sidebarBg:'#000000', topbarBg:'#000000',
      cardBg:'#050505', inputBg:'#111111',
      hoverCard:'rgba(255,255,255,0.05)', glow:'rgba(0,255,255,0.4)',
    }
  }
};

// ═══ QUANTUM LEDGER — High Visibility Terminal ═══
const QUANTUM_LEDGER: LayoutDef = {
  id: 'quantum_ledger', name: 'Quantum Ledger', desc: 'High-visibility · terminal numbers',
  font: 'Public Sans', fontMono: 'JetBrains Mono',
  radius: '8px', radiusSm: '4px', radiusLg: '12px',
  shadow: '0 8px 32px rgba(0,0,0,.3), 0 0 0 1px rgba(255,255,255,.05)',
  swatches: ['#020617','#3b82f6','#10b981','#ef4444','#f59e0b','#8b5cf6','#06b6d4','#f8fafc'],
  themes: {
    t1: {
      bg:'#020617', panel:'#0f172a', panel2:'#1e293b', panel3:'#334155',
      text:'#f8fafc', muted:'#94a3b8', muted2:'#64748b',
      line:'rgba(59,130,246,.2)', line2:'rgba(59,130,246,.1)',
      brand:'#3b82f6', brand2:'#60a5fa', brand3:'rgba(59,130,246,.15)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#020617', topbarBg:'rgba(2,6,23,.98)',
      cardBg:'#0f172a', inputBg:'rgba(59,130,246,.08)',
      hoverCard:'rgba(59,130,246,.06)', glow:'rgba(59,130,246,.3)',
    },
    t2: {
      bg:'#050505', panel:'#121212', panel2:'#1a1a1a', panel3:'#262626',
      text:'#ffffff', muted:'#a3a3a3', muted2:'#737373',
      line:'rgba(132,204,22,.2)', line2:'rgba(132,204,22,.1)',
      brand:'#84cc16', brand2:'#a3e635', brand3:'rgba(132,204,22,.15)',
      good:'#22c55e', bad:'#ef4444', warn:'#eab308',
      sidebarBg:'#000000', topbarBg:'rgba(5,5,5,.98)',
      cardBg:'#121212', inputBg:'rgba(132,204,22,.08)',
      hoverCard:'rgba(132,204,22,.06)', glow:'rgba(132,204,22,.3)',
    }
  }
};

// ═══ FLUX — Clean SaaS ═══
const FLUX: LayoutDef = {
  id: 'flux', name: 'Flux', desc: 'Clean SaaS · rounded',
  font: 'Inter', fontMono: 'JetBrains Mono',
  radius: '12px', radiusSm: '8px', radiusLg: '16px',
  shadow: '0 4px 20px rgba(0,0,0,.06)',
  swatches: ['#f8faff','#4f46e5','#7c3aed','#16a34a','#dc2626','#0ea5e9','#e11d48','#d97706'],
  themes: {
    t1: {
      bg:'#f8faff', panel:'#ffffff', panel2:'#f0f4ff', panel3:'#e8effe',
      text:'#0f172a', muted:'#64748b', muted2:'#94a3b8',
      line:'rgba(15,23,42,.09)', line2:'rgba(15,23,42,.05)',
      brand:'#4f46e5', brand2:'#7c3aed', brand3:'rgba(79,70,229,.1)',
      good:'#16a34a', bad:'#dc2626', warn:'#d97706',
      sidebarBg:'#ffffff', topbarBg:'rgba(255,255,255,.95)',
      cardBg:'#ffffff', inputBg:'rgba(79,70,229,.05)',
      hoverCard:'rgba(79,70,229,.04)', glow:'rgba(79,70,229,.15)',
    },
    t2: {
      bg:'#f0fdf9', panel:'#ffffff', panel2:'#f0fdfa', panel3:'#ccfbf1',
      text:'#0f2922', muted:'#4d7c6f', muted2:'#7aada4',
      line:'rgba(15,41,34,.09)', line2:'rgba(15,41,34,.05)',
      brand:'#0d9488', brand2:'#059669', brand3:'rgba(13,148,136,.1)',
      good:'#15803d', bad:'#dc2626', warn:'#d97706',
      sidebarBg:'#ffffff', topbarBg:'rgba(255,255,255,.95)',
      cardBg:'#ffffff', inputBg:'rgba(13,148,136,.05)',
      hoverCard:'rgba(13,148,136,.04)', glow:'rgba(13,148,136,.15)',
    },
    t3: {
      bg:'#fff1f5', panel:'#ffffff', panel2:'#fff1f5', panel3:'#ffe4e6',
      text:'#2d0014', muted:'#8b3560', muted2:'#c084a0',
      line:'rgba(45,0,20,.09)', line2:'rgba(45,0,20,.05)',
      brand:'#e11d48', brand2:'#db2777', brand3:'rgba(225,29,72,.1)',
      good:'#15803d', bad:'#b91c1c', warn:'#d97706',
      sidebarBg:'#ffffff', topbarBg:'rgba(255,255,255,.95)',
      cardBg:'#ffffff', inputBg:'rgba(225,29,72,.05)',
      hoverCard:'rgba(225,29,72,.04)', glow:'rgba(225,29,72,.15)',
    },
    t4: {
      bg:'#fffbf0', panel:'#ffffff', panel2:'#fef9ee', panel3:'#fef3c7',
      text:'#1c1400', muted:'#78600a', muted2:'#a88e45',
      line:'rgba(28,20,0,.09)', line2:'rgba(28,20,0,.05)',
      brand:'#d97706', brand2:'#b45309', brand3:'rgba(217,119,6,.1)',
      good:'#15803d', bad:'#dc2626', warn:'#92400e',
      sidebarBg:'#ffffff', topbarBg:'rgba(255,255,255,.95)',
      cardBg:'#ffffff', inputBg:'rgba(217,119,6,.05)',
      hoverCard:'rgba(217,119,6,.04)', glow:'rgba(217,119,6,.15)',
    },
    t5: {
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

// ═══ CIPHER — Dark Terminal ═══
const CIPHER: LayoutDef = {
  id: 'cipher', name: 'Cipher', desc: 'Dark terminal · mono',
  font: 'JetBrains Mono', fontMono: 'JetBrains Mono',
  radius: '4px', radiusSm: '2px', radiusLg: '6px',
  shadow: '0 0 0 1px rgba(255,255,255,.08)',
  swatches: ['#000000','#00ff64','#00d4ff','#ff4040','#ffcc00','#aa44ff','#ff8c00','#6478ff'],
  themes: {
    t1: {
      bg:'#000000', panel:'#0a0a0a', panel2:'#111111', panel3:'#1a1a1a',
      text:'#e0ffd4', muted:'#5a8c50', muted2:'#3d6035',
      line:'rgba(0,255,100,.1)', line2:'rgba(0,255,100,.05)',
      brand:'#00ff64', brand2:'#00cc50', brand3:'rgba(0,255,100,.1)',
      good:'#00ff64', bad:'#ff4040', warn:'#ffcc00',
      sidebarBg:'#050505', topbarBg:'rgba(0,0,0,.98)',
      cardBg:'#0a0a0a', inputBg:'rgba(0,255,100,.06)',
      hoverCard:'rgba(0,255,100,.05)', glow:'rgba(0,255,100,.2)',
    },
    t2: {
      bg:'#000b1a', panel:'#001428', panel2:'#00213d', panel3:'#002e52',
      text:'#b8d8ff', muted:'#4a7fa8', muted2:'#2d5b80',
      line:'rgba(0,150,255,.12)', line2:'rgba(0,150,255,.06)',
      brand:'#0096ff', brand2:'#0064cc', brand3:'rgba(0,150,255,.1)',
      good:'#00d4aa', bad:'#ff4455', warn:'#ffaa00',
      sidebarBg:'#000b1a', topbarBg:'rgba(0,11,26,.98)',
      cardBg:'#001428', inputBg:'rgba(0,150,255,.07)',
      hoverCard:'rgba(0,150,255,.05)', glow:'rgba(0,150,255,.2)',
    },
    t3: {
      bg:'#0d0015', panel:'#150022', panel2:'#1e0033', panel3:'#280044',
      text:'#e8ccff', muted:'#7a4aa0', muted2:'#5a2880',
      line:'rgba(168,85,247,.12)', line2:'rgba(168,85,247,.06)',
      brand:'#aa44ff', brand2:'#8800ee', brand3:'rgba(168,85,247,.1)',
      good:'#44ff88', bad:'#ff4466', warn:'#ffaa22',
      sidebarBg:'#0d0015', topbarBg:'rgba(13,0,21,.98)',
      cardBg:'#150022', inputBg:'rgba(168,85,247,.07)',
      hoverCard:'rgba(168,85,247,.06)', glow:'rgba(168,85,247,.25)',
    },
    t4: {
      bg:'#1a0800', panel:'#260c00', panel2:'#331100', panel3:'#401600',
      text:'#ffd4a0', muted:'#a06030', muted2:'#704020',
      line:'rgba(255,140,0,.12)', line2:'rgba(255,140,0,.06)',
      brand:'#ff8c00', brand2:'#ff6600', brand3:'rgba(255,140,0,.1)',
      good:'#44ff88', bad:'#ff3300', warn:'#ffcc00',
      sidebarBg:'#1a0800', topbarBg:'rgba(26,8,0,.98)',
      cardBg:'#260c00', inputBg:'rgba(255,140,0,.07)',
      hoverCard:'rgba(255,140,0,.06)', glow:'rgba(255,140,0,.25)',
    },
    t5: {
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

// ═══ DARK LEDGER ═══
const DARK_LEDGER: LayoutDef = {
  id: 'dark_ledger', name: 'Dark Ledger', desc: 'Premium dark · high-contrast data',
  font: 'Inter', fontMono: 'JetBrains Mono',
  radius: '6px', radiusSm: '3px', radiusLg: '10px',
  shadow: '0 2px 8px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.04)',
  swatches: ['#0d1117','#58a6ff','#3fb950','#f85149','#d29922','#bc8cff','#79c0ff','#e3b341'],
  themes: {
    t1: {
      bg:'#0d1117', panel:'#161b22', panel2:'#21262d', panel3:'#30363d',
      text:'#c9d1d9', muted:'#8b949e', muted2:'#6e7681',
      line:'rgba(240,246,252,.06)', line2:'rgba(240,246,252,.03)',
      brand:'#58a6ff', brand2:'#79c0ff', brand3:'rgba(88,166,255,.1)',
      good:'#3fb950', bad:'#f85149', warn:'#d29922',
      sidebarBg:'#010409', topbarBg:'rgba(13,17,23,.98)',
      cardBg:'#161b22', inputBg:'rgba(88,166,255,.06)',
      hoverCard:'rgba(88,166,255,.04)', glow:'rgba(88,166,255,.15)',
    },
    t2: {
      bg:'#0f0b1a', panel:'#1a1428', panel2:'#241e38', panel3:'#2e2848',
      text:'#d8ccf0', muted:'#8a78b0', muted2:'#6a58a0',
      line:'rgba(188,140,255,.08)', line2:'rgba(188,140,255,.04)',
      brand:'#bc8cff', brand2:'#a855f7', brand3:'rgba(188,140,255,.1)',
      good:'#3fb950', bad:'#f85149', warn:'#e3b341',
      sidebarBg:'#0a0612', topbarBg:'rgba(15,11,26,.98)',
      cardBg:'#1a1428', inputBg:'rgba(188,140,255,.06)',
      hoverCard:'rgba(188,140,255,.04)', glow:'rgba(168,85,247,.2)',
    },
    t3: {
      bg:'#0a1210', panel:'#0f1c18', panel2:'#142620', panel3:'#1a3028',
      text:'#c8f0d8', muted:'#58a878', muted2:'#388858',
      line:'rgba(63,185,80,.08)', line2:'rgba(63,185,80,.04)',
      brand:'#3fb950', brand2:'#56d364', brand3:'rgba(63,185,80,.1)',
      good:'#3fb950', bad:'#f85149', warn:'#d29922',
      sidebarBg:'#06100c', topbarBg:'rgba(10,18,16,.98)',
      cardBg:'#0f1c18', inputBg:'rgba(63,185,80,.06)',
      hoverCard:'rgba(63,185,80,.04)', glow:'rgba(86,211,100,.15)',
    },
    t4: {
      bg:'#12100a', panel:'#1c1810', panel2:'#262018', panel3:'#302820',
      text:'#f0dca8', muted:'#b09848', muted2:'#907828',
      line:'rgba(227,179,65,.08)', line2:'rgba(227,179,65,.04)',
      brand:'#e3b341', brand2:'#d29922', brand3:'rgba(227,179,65,.1)',
      good:'#3fb950', bad:'#f85149', warn:'#d29922',
      sidebarBg:'#100e06', topbarBg:'rgba(18,16,10,.98)',
      cardBg:'#1c1810', inputBg:'rgba(227,179,65,.06)',
      hoverCard:'rgba(227,179,65,.04)', glow:'rgba(210,153,34,.2)',
    },
    t5: {
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

// ═══ OPERATIONS DESK ═══
const OPERATIONS_DESK: LayoutDef = {
  id: 'operations_desk', name: 'Operations Desk', desc: 'Table-focused · ops workflow',
  font: 'DM Sans', fontMono: 'IBM Plex Mono',
  radius: '5px', radiusSm: '3px', radiusLg: '8px',
  shadow: '0 1px 4px rgba(0,0,0,.1), 0 0 0 1px rgba(0,0,0,.04)',
  swatches: ['#0b1622','#00c9a7','#ff6b6b','#4ecdc4','#ffe66d','#a855f7','#3b82f6','#f97316'],
  themes: {
    t1: {
      bg:'#0b1622', panel:'#111f30', panel2:'#172840', panel3:'#1d3250',
      text:'#d0e4f4', muted:'#5a8aaa', muted2:'#3a6a8a',
      line:'rgba(0,201,167,.1)', line2:'rgba(0,201,167,.05)',
      brand:'#00c9a7', brand2:'#00b094', brand3:'rgba(0,201,167,.1)',
      good:'#00c9a7', bad:'#ff6b6b', warn:'#ffe66d',
      sidebarBg:'#060e18', topbarBg:'rgba(11,22,34,.98)',
      cardBg:'#111f30', inputBg:'rgba(0,201,167,.06)',
      hoverCard:'rgba(0,201,167,.04)', glow:'rgba(0,201,167,.18)',
    },
    t2: {
      bg:'#080e18', panel:'#0e1828', panel2:'#142238', panel3:'#1a2c48',
      text:'#c8d8f0', muted:'#4878a8', muted2:'#285888',
      line:'rgba(59,130,246,.1)', line2:'rgba(59,130,246,.05)',
      brand:'#3b82f6', brand2:'#60a5fa', brand3:'rgba(59,130,246,.1)',
      good:'#4ecdc4', bad:'#ff6b6b', warn:'#ffe66d',
      sidebarBg:'#04080e', topbarBg:'rgba(8,14,24,.98)',
      cardBg:'#0e1828', inputBg:'rgba(59,130,246,.06)',
      hoverCard:'rgba(59,130,246,.04)', glow:'rgba(96,165,250,.18)',
    },
    t3: {
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

// ═══ ATLAS GRID ═══
const ATLAS_GRID: LayoutDef = {
  id: 'atlas_grid', name: 'Atlas Grid', desc: 'Command-center · spatial ops',
  font: 'Manrope', fontMono: 'IBM Plex Mono',
  radius: '4px', radiusSm: '2px', radiusLg: '6px',
  shadow: '0 0 0 1px rgba(44,36,26,.08)',
  swatches: ['#E9E2D3','#8E3B2E','#355C4B','#3E6B57','#A43A32','#C17A1C','#3B3124','#B7AA8B'],
  themes: {
    t1: {
      bg:'#E9E2D3', panel:'#D6CCB8', panel2:'#B7AA8B', panel3:'#8C7A5B',
      text:'#2C241A', muted:'#5F5442', muted2:'#7B6E58',
      line:'rgba(44,36,26,.12)', line2:'rgba(44,36,26,.06)',
      brand:'#8E3B2E', brand2:'#355C4B', brand3:'rgba(142,59,46,.10)',
      good:'#3E6B57', bad:'#A43A32', warn:'#C17A1C',
      sidebarBg:'#3B3124', topbarBg:'rgba(233,226,211,.95)',
      cardBg:'#DCCFB7', inputBg:'rgba(142,59,46,.05)',
      hoverCard:'rgba(53,92,75,.06)', glow:'rgba(193,122,28,.08)',
    },
    t2: {
      bg:'#EDE5D6', panel:'#DDD2BC', panel2:'#C4B59A', panel3:'#9A8768',
      text:'#2A1F14', muted:'#6B5038', muted2:'#8A7054',
      line:'rgba(42,31,20,.12)', line2:'rgba(42,31,20,.06)',
      brand:'#A85C3A', brand2:'#7A4A2F', brand3:'rgba(168,92,58,.10)',
      good:'#4A7D5E', bad:'#B24430', warn:'#D4882A',
      sidebarBg:'#3A281C', topbarBg:'rgba(237,229,214,.95)',
      cardBg:'#E0D4BE', inputBg:'rgba(168,92,58,.05)',
      hoverCard:'rgba(122,74,47,.06)', glow:'rgba(212,136,42,.08)',
    },
    t3: {
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

// ═══ VELVET MONO ═══
const VELVET_MONO: LayoutDef = {
  id: 'velvet_mono', name: 'Velvet Mono', desc: 'Luxury dark · editorial restraint',
  font: 'Fraunces', fontMono: 'IBM Plex Mono',
  radius: '10px', radiusSm: '6px', radiusLg: '14px',
  shadow: '0 4px 16px rgba(0,0,0,.2)',
  swatches: ['#161116','#D3A15F','#8C6A9F','#7FA483','#C46A6A','#D9A441','#120D12','#3A2B37'],
  themes: {
    t1: {
      bg:'#161116', panel:'#211821', panel2:'#2B202A', panel3:'#3A2B37',
      text:'#F4E9E2', muted:'#B9A6AE', muted2:'#8E7C84',
      line:'rgba(244,233,226,.08)', line2:'rgba(244,233,226,.04)',
      brand:'#D3A15F', brand2:'#8C6A9F', brand3:'rgba(211,161,95,.10)',
      good:'#7FA483', bad:'#C46A6A', warn:'#D9A441',
      sidebarBg:'#120D12', topbarBg:'rgba(22,17,22,.95)',
      cardBg:'#241B24', inputBg:'rgba(211,161,95,.05)',
      hoverCard:'rgba(140,106,159,.06)', glow:'rgba(211,161,95,.10)',
    },
    t2: {
      bg:'#18101A', panel:'#261A28', panel2:'#342438', panel3:'#442E48',
      text:'#EDE0F0', muted:'#A890B0', muted2:'#886E98',
      line:'rgba(237,224,240,.08)', line2:'rgba(237,224,240,.04)',
      brand:'#9E6AB8', brand2:'#C89ADF', brand3:'rgba(158,106,184,.10)',
      good:'#78A880', bad:'#C46A6A', warn:'#D4A040',
      sidebarBg:'#140C16', topbarBg:'rgba(24,16,26,.95)',
      cardBg:'#2A1E2E', inputBg:'rgba(158,106,184,.05)',
      hoverCard:'rgba(200,154,223,.06)', glow:'rgba(158,106,184,.10)',
    },
    t3: {
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

// ═══ PAPERWIRE ═══
const PAPERWIRE: LayoutDef = {
  id: 'paperwire', name: 'Paperwire', desc: 'Audit-desk · document-first',
  font: 'Instrument Serif', fontMono: 'IBM Plex Mono',
  radius: '2px', radiusSm: '0px', radiusLg: '3px',
  shadow: 'none',
  swatches: ['#F3EFE6','#005F73','#9B2226','#2D6A4F','#AE2012','#BB7A00','#2A2118','#CFC1AA'],
  themes: {
    t1: {
      bg:'#F3EFE6', panel:'#FFFDF8', panel2:'#E7DECF', panel3:'#CFC1AA',
      text:'#181512', muted:'#6A6056', muted2:'#94877A',
      line:'rgba(24,21,18,.10)', line2:'rgba(24,21,18,.05)',
      brand:'#005F73', brand2:'#9B2226', brand3:'rgba(0,95,115,.08)',
      good:'#2D6A4F', bad:'#AE2012', warn:'#BB7A00',
      sidebarBg:'#2A2118', topbarBg:'rgba(243,239,230,.96)',
      cardBg:'#FFFDF8', inputBg:'rgba(0,95,115,.04)',
      hoverCard:'rgba(155,34,38,.04)', glow:'rgba(0,95,115,.06)',
    },
    t2: {
      bg:'#F5F0E8', panel:'#FFFCF6', panel2:'#EBDDD0', panel3:'#D4C0A8',
      text:'#1A1210', muted:'#6E4A3A', muted2:'#947466',
      line:'rgba(26,18,16,.10)', line2:'rgba(26,18,16,.05)',
      brand:'#9B2226', brand2:'#005F73', brand3:'rgba(155,34,38,.08)',
      good:'#2D6A4F', bad:'#7A1510', warn:'#C47A00',
      sidebarBg:'#2C1A14', topbarBg:'rgba(245,240,232,.96)',
      cardBg:'#FFFCF6', inputBg:'rgba(155,34,38,.04)',
      hoverCard:'rgba(0,95,115,.04)', glow:'rgba(155,34,38,.06)',
    },
    t3: {
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

// ═══ SIGNAL DECK ═══
const SIGNAL_DECK: LayoutDef = {
  id: 'signal_deck', name: 'Signal Deck', desc: 'Navy command · color-coded data',
  font: 'Inter', fontMono: 'JetBrains Mono',
  radius: '10px', radiusSm: '8px', radiusLg: '14px',
  shadow: '0 1px 3px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.03)',
  swatches: ['#0d1321','#10b981','#6366f1','#f59e0b','#a855f7','#ec4899','#06b6d4','#ef4444'],
  themes: {
    t1: {
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#10b981', brand2:'#34d399', brand3:'rgba(16,185,129,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(16,185,129,.04)', glow:'rgba(16,185,129,.15)',
    },
    t2: {
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#6366f1', brand2:'#818cf8', brand3:'rgba(99,102,241,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(99,102,241,.04)', glow:'rgba(129,140,248,.15)',
    },
    t3: {
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#f59e0b', brand2:'#fbbf24', brand3:'rgba(245,158,11,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(245,158,11,.04)', glow:'rgba(251,191,36,.15)',
    },
    t4: {
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#a855f7', brand2:'#c084fc', brand3:'rgba(168,85,247,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(16,185,129,.04)', glow:'rgba(192,132,252,.15)',
    },
    t5: {
      bg:'#0d1321', panel:'#131c2e', panel2:'#192438', panel3:'#1f2c42',
      text:'#e0e6f0', muted:'#6b7a90', muted2:'#4e5b6e',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#06b6d4', brand2:'#22d3ee', brand3:'rgba(6,182,212,.08)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#090f1a', topbarBg:'rgba(13,19,33,.98)',
      cardBg:'#131c2e', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(34,211,238,.15)', glow:'rgba(34,211,238,.15)',
    },
  },
};

// ═══ GLASS MOBILE ═══
const GLASS_MOBILE: LayoutDef = {
  id: 'glass_mobile', name: 'Glass Mobile', desc: 'Frosted glass · mobile-first',
  font: 'Public Sans', fontMono: 'JetBrains Mono',
  radius: '16px', radiusSm: '8px', radiusLg: '24px',
  shadow: '0 8px 32px rgba(0,0,0,.08)',
  swatches: ['#ffffff','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#64748b'],
  themes: {
    t1: {
      bg:'#f8fafc', panel:'rgba(255,255,255,.7)', panel2:'rgba(241,245,249,.6)', panel3:'rgba(226,232,240,.5)',
      text:'#0f172a', muted:'#64748b', muted2:'#94a3b8',
      line:'rgba(15,23,42,.06)', line2:'rgba(15,23,42,.03)',
      brand:'#3b82f6', brand2:'#2563eb', brand3:'rgba(59,130,246,.1)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#ffffff', topbarBg:'rgba(255,255,255,.8)',
      cardBg:'rgba(255,255,255,.7)', inputBg:'rgba(59,130,246,.05)',
      hoverCard:'rgba(59,130,246,.04)', glow:'rgba(59,130,246,.15)',
    },
    t2: {
      bg:'#020617', panel:'rgba(15,23,42,.7)', panel2:'rgba(30,41,59,.6)', panel3:'rgba(51,65,85,.5)',
      text:'#f8fafc', muted:'#94a3b8', muted2:'#64748b',
      line:'rgba(255,255,255,.06)', line2:'rgba(255,255,255,.03)',
      brand:'#3b82f6', brand2:'#60a5fa', brand3:'rgba(59,130,246,.15)',
      good:'#10b981', bad:'#ef4444', warn:'#f59e0b',
      sidebarBg:'#020617', topbarBg:'rgba(2,6,23,.8)',
      cardBg:'rgba(15,23,42,.7)', inputBg:'rgba(255,255,255,.04)',
      hoverCard:'rgba(59,130,246,.06)', glow:'rgba(59,130,246,.2)',
    },
    t3: {
      bg:'#eff6ff', panel:'rgba(255,255,255,.7)', panel2:'rgba(219,234,254,.6)', panel3:'rgba(191,219,254,.5)',
      text:'#1e3a8a', muted:'#3b82f6', muted2:'#60a5fa',
      line:'rgba(30,58,138,.08)', line2:'rgba(30,58,138,.04)',
      brand:'#2563eb', brand2:'#1d4ed8', brand3:'rgba(37,99,235,.1)',
      good:'#059669', bad:'#dc2626', warn:'#d97706',
      sidebarBg:'#ffffff', topbarBg:'rgba(239,246,255,.8)',
      cardBg:'rgba(255,255,255,.7)', inputBg:'rgba(37,99,235,.05)',
      hoverCard:'rgba(37,99,235,.04)', glow:'rgba(37,99,235,.15)',
    },
  },
};

export const LAYOUTS: LayoutDef[] = [TERMINAL_HC, QUANTUM_LEDGER, FLUX, CIPHER, DARK_LEDGER, OPERATIONS_DESK, ATLAS_GRID, VELVET_MONO, PAPERWIRE, SIGNAL_DECK, GLASS_MOBILE];