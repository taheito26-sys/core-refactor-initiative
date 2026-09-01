import type { TranslationKey } from '@/lib/i18n';
import type { OrdersReportLabels } from './orders-export';

type Translate = (key: TranslationKey) => string;

/** The label set the orders-report builders need, resolved once per language. */
export function ordersReportLabels(t: Translate): OrdersReportLabels {
  return {
    documentTitle: t('ordersReportTitle'),
    issuedBy: t('stmtIssuedBy'),
    reportDate: t('stmtDate'),
    period: t('stmtPeriod'),
    allPeriod: t('ordersReportAllPeriod'),
    totalOrders: t('ordersReportTotalOrders'),
    totalSoldUsdt: t('ordersReportTotalSoldUsdt'),
    totalQar: t('ordersReportTotalQar'),
    totalCost: t('ordersReportTotalCost'),
    totalNetProfit: t('ordersReportTotalNetProfit'),
    orderDetail: t('ordersReportOrderDetail'),
    colDate: t('date'),
    colBuyer: t('buyer'),
    colQty: t('ordersReportColQty'),
    colSell: t('ordersReportColSell'),
    colTotalQar: t('ordersReportTotalQar'),
    colCost: t('ordersReportColCost'),
    colNet: t('ordersReportColNet'),
    footer: t('ordersReportFooter'),
    generatedOn: t('stmtGeneratedOn'),
  };
}
