import { renderHtmlReportToPdf } from '@/lib/htmlReportToPdf';
import { fmtTotal } from '@/lib/tracker-helpers';
import type { LineKey, MonthSummary, Rates } from './position';

export interface ReportLabels {
  title: string;
  opening: string;
  closing: string;
  change: string;
  line: Record<LineKey, string>;
  daily: string;
  day: string;
  net: string;
  firstDayNote: string;
  rates: string;
  footer: string;
  generatedOn: string;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const money = (n: number, signed = false) => `${signed && n > 0 ? '+' : n < 0 ? '−' : ''}${fmtTotal(Math.abs(n))}`;

/**
 * The month as a one-sheet report for renderHtmlReportToPdf: a single
 * `.sheet`, no custom properties on :root, and tables whose rows are short
 * enough never to need splitting.
 */
export function buildPositionReportHtml(input: {
  labels: ReportLabels;
  monthLabel: string;
  summary: MonthSummary;
  rates: Rates;
  dir: 'ltr' | 'rtl';
  generatedOn: string;
}): string {
  const { labels: L, summary, dir } = input;
  const opposite = dir === 'rtl' ? 'left' : 'right';
  const align = dir === 'rtl' ? 'right' : 'left';
  const lineRows = summary.perLine
    .filter(l => l.opening || l.closing)
    .map(l => `<tr><td>${escapeHtml(L.line[l.key])}</td><td class="num">${escapeHtml(money(l.opening))}</td><td class="num">${escapeHtml(money(l.closing))}</td><td class="num">${escapeHtml(money(l.change, true))}</td></tr>`)
    .join('');
  const dayRows = [...summary.days].reverse()
    .map(d => `<tr><td>${escapeHtml(d.day)}</td><td class="num">${escapeHtml(money(d.net))}</td><td class="num">${escapeHtml(d.change == null ? '—' : money(d.change, true))}</td></tr>`)
    .join('');
  const opening = summary.opening?.net ?? 0;
  const closing = summary.closing?.net ?? 0;
  const rateLines = [
    `QAR per 1 USD: ${input.rates.usdToQar.toFixed(4)}`,
    `QAR per 1 USDT: ${input.rates.usdtRateQAR ? input.rates.usdtRateQAR.toFixed(4) : '—'}`,
    `EGP per 1 USDT: ${input.rates.egpPerUsdt ? input.rates.egpPerUsdt.toFixed(2) : '—'}`,
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
  .note { margin: 8px 32px 0; font-size: 9.5px; color: #6b7280; }
  .rates { margin: 14px 32px 0; font-size: 9.5px; color: #6b7280; line-height: 1.6; }
  footer { margin-top: 18px; padding: 10px 32px 0; border-top: 1px solid #e5e9f2; font-size: 9px; color: #6b7280; display: flex; justify-content: space-between; gap: 16px; }
</style>
</head>
<body>
<div class="sheet" dir="${dir}">
  <div class="banner"><div class="title">${escapeHtml(L.title)} · ${escapeHtml(input.monthLabel)}</div></div>
  <div class="cards">
    <div class="card"><div class="k">${escapeHtml(L.opening)}</div><div class="v">${escapeHtml(money(opening))}</div></div>
    <div class="card"><div class="k">${escapeHtml(L.closing)}</div><div class="v">${escapeHtml(money(closing))}</div></div>
    <div class="card"><div class="k">${escapeHtml(L.change)}</div><div class="v">${escapeHtml(money(summary.change, true))}</div></div>
  </div>
  ${summary.openingIsFirstDay ? `<div class="note">${escapeHtml(L.firstDayNote)}</div>` : ''}
  <h2>${escapeHtml(L.net)}</h2>
  <table>
    <thead><tr><th>&nbsp;</th><th class="num">${escapeHtml(L.opening)}</th><th class="num">${escapeHtml(L.closing)}</th><th class="num">${escapeHtml(L.change)}</th></tr></thead>
    <tbody>${lineRows}</tbody>
  </table>
  <h2>${escapeHtml(L.daily)}</h2>
  <table>
    <thead><tr><th>${escapeHtml(L.day)}</th><th class="num">${escapeHtml(L.net)}</th><th class="num">${escapeHtml(L.change)}</th></tr></thead>
    <tbody>${dayRows}</tbody>
  </table>
  <div class="rates"><b>${escapeHtml(L.rates)}</b><br/>${rateLines.map(escapeHtml).join('<br/>')}</div>
  <footer><span>${escapeHtml(L.footer)}</span><span>${escapeHtml(L.generatedOn)} ${escapeHtml(input.generatedOn)}</span></footer>
</div>
</body>
</html>`;
}

export async function exportPositionPdf(html: string, filename: string): Promise<void> {
  await renderHtmlReportToPdf(html, filename, { orientation: 'portrait' });
}
