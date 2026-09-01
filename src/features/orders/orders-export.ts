import type { Trade, Customer, DerivedState } from '@/lib/tracker-helpers';
import { fmtDate } from '@/lib/tracker-helpers';
import { localCur } from '@/lib/currency-locale';

interface OrderExportRow {
  date: string;
  buyer: string;
  qtyUsdt: number;
  sellPrice: number;
  revenue: number;
  cost: number | null;
  net: number | null;
}

function buildRows(trades: Trade[], customers: Customer[], derived: DerivedState): OrderExportRow[] {
  const customerById = new Map(customers.map(c => [c.id, c.name]));
  return trades.map(tr => {
    const c = derived.tradeCalc.get(tr.id);
    const revenue = tr.amountUSDT * tr.sellPriceQAR;
    const cost = c?.slices.reduce((s, x) => s + x.cost, 0) ?? null;
    let net = c?.ok && cost != null ? revenue - cost - tr.feeQAR : null;
    const linked = !!(tr.agreementFamily || tr.linkedDealId || tr.linkedRelId);
    if (linked && tr.merchantPct && net != null) net = net * (tr.merchantPct / 100);
    return {
      date: fmtDate(tr.ts),
      buyer: customerById.get(tr.customerId) || '—',
      qtyUsdt: tr.amountUSDT,
      sellPrice: tr.sellPriceQAR,
      revenue,
      cost,
      net,
    };
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export async function exportOrdersToXlsx(
  trades: Trade[],
  customers: Customer[],
  derived: DerivedState,
  baseFiat: string,
  lang: 'en' | 'ar',
): Promise<void> {
  const lc = (c: string) => localCur(c, lang);
  const rows = buildRows(trades, customers, derived);

  // Dynamically imported so exceljs (large) only loads into a device's
  // bundle when an export is actually triggered, instead of bloating the
  // main precached PWA bundle for every user.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Orders');
  sheet.views = [{ rightToLeft: lang === 'ar' }];
  sheet.columns = [
    { header: 'Date', key: 'date', width: 22 },
    { header: 'Buyer', key: 'buyer', width: 24 },
    { header: `Qty ${lc('USDT')}`, key: 'qtyUsdt', width: 14 },
    { header: `Sell ${lc(baseFiat)}`, key: 'sellPrice', width: 14 },
    { header: `Revenue ${lc(baseFiat)}`, key: 'revenue', width: 16 },
    { header: `Cost ${lc(baseFiat)}`, key: 'cost', width: 16 },
    { header: `Net ${lc(baseFiat)}`, key: 'net', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      date: row.date,
      buyer: row.buyer,
      qtyUsdt: row.qtyUsdt,
      sellPrice: row.sellPrice,
      revenue: row.revenue,
      cost: row.cost ?? '',
      net: row.net ?? '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `orders-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

export async function exportOrdersToPdf(
  trades: Trade[],
  customers: Customer[],
  derived: DerivedState,
  baseFiat: string,
  lang: 'en' | 'ar',
): Promise<void> {
  const lc = (c: string) => localCur(c, lang);
  const rows = buildRows(trades, customers, derived);

  // Dynamically imported so jspdf/jspdf-autotable (large) only load into a
  // device's bundle when an export is actually triggered, instead of
  // bloating the main precached PWA bundle for every user.
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text('Orders', 14, 14);

  autoTable(doc, {
    startY: 20,
    head: [['Date', 'Buyer', `Qty ${lc('USDT')}`, `Sell ${lc(baseFiat)}`, `Revenue ${lc(baseFiat)}`, `Cost ${lc(baseFiat)}`, `Net ${lc(baseFiat)}`]],
    body: rows.map(row => [
      row.date,
      row.buyer,
      row.qtyUsdt.toLocaleString(),
      row.sellPrice.toLocaleString(),
      row.revenue.toLocaleString(),
      row.cost != null ? row.cost.toLocaleString() : '—',
      row.net != null ? row.net.toLocaleString() : '—',
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
  });

  doc.save(`orders-${new Date().toISOString().slice(0, 10)}.pdf`);
}
