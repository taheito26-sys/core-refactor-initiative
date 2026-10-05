import { renderHtmlReportToPdf } from '@/lib/htmlReportToPdf';
import { fmtTotal } from '@/lib/tracker-helpers';
import type { MonthBridge, MonthPosition, NetPositionLineKey } from '@/lib/trading/net-position';

export interface NetPositionReportLabels {
  title: string;
  statusFrozen: string;
  statusLive: string;
  opening: string;
  closing: string;
  change: string;
  revenue: string;
  bridge: string;
  business: string;
  personal: string;
  uncategorised: string;
  deposits: string;
  adjustments: string;
  other: string;
  priorCorrections: string;
  breakdown: string;
  assets: string;
  liabilities: string;
  rates: string;
  usdRate: string;
  usdtRate: string;
  egpRate: string;
  footer: string;
  generatedOn: string;
  lines: Record<NetPositionLineKey, string>;
  categories: Record<string, string>;
}

export interface NetPositionReportInput {
  labels: NetPositionReportLabels;
  monthLabel: string;
  month: MonthPosition;
  bridge: MonthBridge;
  /** When the month was frozen, or null for live figures. */
  frozenAt: string | null;
  dir: 'ltr' | 'rtl';
  businessName?: string;
  generatedOn: string;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const money = (n: number, signed = false) => `${signed && n > 0 ? '+' : n < 0 ? '−' : ''}${fmtTotal(Math.abs(n))}`;

/**
 * The month's net position as a one-sheet report, built for renderHtmlReportToPdf:
 * a single `.sheet`, tables whose rows may not be split across pages, and no
 * custom properties on :root.
 */
export function buildNetPositionReportHtml(input: NetPositionReportInput): string {
  const { labels: L, month, bridge, dir } = input;
  const align = dir === 'rtl' ? 'right' : 'left';
  const opposite = dir === 'rtl' ? 'left' : 'right';
  const change = Math.round((month.closing.netQAR - bridge.openingQAR) * 100) / 100;

  const bridgeRows: Array<{ label: string; amount: number; kind?: 'plus' | 'minus' | 'sub' | 'total' | 'muted' }> = [
    { label: L.opening, amount: bridge.openingQAR, kind: 'total' },
    ...(bridge.priorCorrectionsQAR ? [{ label: L.priorCorrections, amount: bridge.priorCorrectionsQAR, kind: 'muted' as const }] : []),
    { label: L.revenue, amount: bridge.netRevenueQAR, kind: 'plus' },
    ...(bridge.depositsQAR > 0 ? [{ label: L.deposits, amount: bridge.depositsQAR, kind: 'plus' as const }] : []),
    ...(bridge.adjustmentsInQAR > 0 ? [{ label: L.adjustments, amount: bridge.adjustmentsInQAR, kind: 'plus' as const }] : []),
    { label: L.business, amount: bridge.businessTotalQAR, kind: 'minus' },
    ...bridge.business.map(c => ({ label: L.categories[c.key] ?? c.key, amount: c.amountQAR, kind: 'sub' as const })),
    { label: L.personal, amount: bridge.personalTotalQAR, kind: 'minus' },
    ...bridge.personal.map(c => ({ label: L.categories[c.key] ?? c.key, amount: c.amountQAR, kind: 'sub' as const })),
    ...(bridge.uncategorisedQAR > 0 ? [{ label: `${L.uncategorised} (${bridge.uncategorisedCount})`, amount: bridge.uncategorisedQAR, kind: 'minus' as const }] : []),
    { label: L.other, amount: bridge.otherQAR, kind: 'muted' },
    { label: L.closing, amount: bridge.closingQAR, kind: 'total' },
  ];
  const bridgeHtml = bridgeRows.map(r => {
    const shown = r.kind === 'minus' || r.kind === 'sub' ? (r.amount ? `−${fmtTotal(r.amount)}` : '0') : money(r.amount, r.kind === 'plus');
    return `<tr class="${r.kind ?? ''}"><td>${escapeHtml(r.label)}</td><td class="num">${escapeHtml(shown)}</td></tr>`;
  }).join('');

  const keys = (Object.keys(L.lines) as NetPositionLineKey[]).filter(k =>
    month.opening.lines.some(l => l.key === k) || month.closing.lines.some(l => l.key === k));
  const lineAmount = (pos: MonthPosition['opening'], k: NetPositionLineKey) => {
    const line = pos.lines.find(l => l.key === k);
    return line ? (line.side === 'liability' ? -line.amountQAR : line.amountQAR) : 0;
  };
  const breakdownHtml = keys.map(k =>
    `<tr><td>${escapeHtml(L.lines[k])}</td><td class="num">${escapeHtml(money(lineAmount(month.opening, k)))}</td><td class="num">${escapeHtml(money(lineAmount(month.closing, k)))}</td></tr>`,
  ).join('');

  const c = month.closing;
  const status = input.frozenAt ? L.statusFrozen.split('{date}').join(input.frozenAt) : L.statusLive;
  const rateLines = [
    `${L.usdRate}: ${c.usdToQar ? c.usdToQar.toFixed(4) : '—'}`,
    `${L.usdtRate}: ${c.usdtRateQAR ? c.usdtRateQAR.toFixed(4) : '—'}`,
    `${L.egpRate}: ${c.egpPerUsdt ? c.egpPerUsdt.toFixed(2) : '—'}`,
  ];

  return `<!DOCTYPE html>
<html lang="${dir === 'rtl' ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(L.title)} — ${escapeHtml(input.monthLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f3f5fa; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1b2433; }
  .sheet { max-width: 800px; margin: 0 auto; background: #fff; padding: 0 0 20px; font-size: 11px; }
  .banner { background: #0F2A44; color: #fff; padding: 22px 32px; }
  .banner .title { font-size: 20px; font-weight: 800; }
  .banner .sub { margin-top: 6px; font-size: 11px; opacity: .85; }
  .cards { display: flex; gap: 10px; padding: 18px 32px 6px; }
  .card { flex: 1; border: 1px solid #e5e9f2; border-radius: 10px; padding: 10px 12px; background: #F4F7FD; }
  .card .k { font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: #6b7280; font-weight: 700; }
  .card .v { margin-top: 4px; font-size: 16px; font-weight: 800; color: #0F2A44; }
  h2 { font-size: 12.5px; font-weight: 800; color: #0F2A44; margin: 18px 32px 8px; padding-inline-start: 9px; border-inline-start: 4px solid #2563EB; }
  table { width: calc(100% - 64px); margin: 0 32px; border-collapse: collapse; }
  th { font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: #fff; background: #1E5F91; padding: 8px; text-align: ${align}; }
  th.num, td.num { text-align: ${opposite}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td { padding: 6px 8px; border-bottom: 1px solid #eef0f4; }
  tr.total td { font-weight: 800; background: #EAF0FB; border-top: 1px solid #0F2A44; color: #0F2A44; }
  tr.sub td { color: #6b7280; padding-inline-start: 22px; }
  tr.muted td { color: #6b7280; }
  .rates { margin: 14px 32px 0; font-size: 9.5px; color: #6b7280; line-height: 1.6; }
  footer { margin-top: 18px; padding: 10px 32px 0; border-top: 1px solid #e5e9f2; font-size: 9px; color: #6b7280; display: flex; justify-content: space-between; gap: 16px; }
</style>
</head>
<body>
<div class="sheet" dir="${dir}">
  <div class="banner">
    <div class="title">${escapeHtml(L.title)} · ${escapeHtml(input.monthLabel)}</div>
    <div class="sub">${input.businessName ? `<b>${escapeHtml(input.businessName)}</b> · ` : ''}${escapeHtml(status)}</div>
  </div>
  <div class="cards">
    <div class="card"><div class="k">${escapeHtml(L.opening)}</div><div class="v">${escapeHtml(money(bridge.openingQAR))}</div></div>
    <div class="card"><div class="k">${escapeHtml(L.closing)}</div><div class="v">${escapeHtml(money(month.closing.netQAR))}</div></div>
    <div class="card"><div class="k">${escapeHtml(L.change)}</div><div class="v">${escapeHtml(money(change, true))}</div></div>
    <div class="card"><div class="k">${escapeHtml(L.revenue)}</div><div class="v">${escapeHtml(money(bridge.netRevenueQAR, true))}</div></div>
  </div>
  <h2>${escapeHtml(L.bridge)}</h2>
  <table><tbody>${bridgeHtml}</tbody></table>
  <h2>${escapeHtml(L.breakdown)}</h2>
  <table>
    <thead><tr><th>&nbsp;</th><th class="num">${escapeHtml(L.opening)}</th><th class="num">${escapeHtml(L.closing)}</th></tr></thead>
    <tbody>
      ${breakdownHtml}
      <tr class="total"><td>${escapeHtml(L.assets)}</td><td class="num">${escapeHtml(money(month.opening.assetsQAR))}</td><td class="num">${escapeHtml(money(month.closing.assetsQAR))}</td></tr>
      <tr class="total"><td>${escapeHtml(L.liabilities)}</td><td class="num">${escapeHtml(money(-month.opening.liabilitiesQAR))}</td><td class="num">${escapeHtml(money(-month.closing.liabilitiesQAR))}</td></tr>
    </tbody>
  </table>
  <div class="rates"><b>${escapeHtml(L.rates)}</b><br/>${rateLines.map(escapeHtml).join('<br/>')}</div>
  <footer><span>${escapeHtml(L.footer)}</span><span>${escapeHtml(L.generatedOn)} ${escapeHtml(input.generatedOn)}</span></footer>
</div>
</body>
</html>`;
}

export async function exportNetPositionPdf(html: string, filename: string): Promise<void> {
  await renderHtmlReportToPdf(html, filename, { orientation: 'portrait' });
}
