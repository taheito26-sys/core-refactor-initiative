import { getAgreementFamilyLabel } from '@/lib/deal-templates';
import type { MerchantDeal } from '@/types/domain';

export type DealRowPerspective = 'incoming' | 'outgoing';

export interface DealRowModel {
  meta: Record<string, string>;
  quantity: number;
  avgBuy: number;
  sellPrice: number;
  volume: number;
  fee: number;
  cost: number;
  hasAvgBuy: boolean;
  fullNet: number | null;
  myNet: number | null;
  margin: number | null;
  buyer: string;
  familyLabel: string;
  familyIcon: string;
  splitLabel: string | null;
  myPct: number | null;
  partnerPct: number | null;
  merchantPct: number | null;
  status: string;
  dateLabel: string;
}

/** Parse pipe-separated key:value metadata from deal.notes */
export function parseDealMeta(notes: string | null | undefined): Record<string, string> {
  if (!notes) return {};
  const meta: Record<string, string> = {};
  notes.split('|').forEach((seg) => {
    const idx = seg.indexOf(':');
    if (idx > 0) {
      const key = seg.slice(0, idx).trim();
      const val = seg.slice(idx + 1).trim();
      meta[key] = val;
    }
  });

  if (!meta.quantity && meta.qty) meta.quantity = meta.qty;
  if (!meta.sell_price && meta.sell) meta.sell_price = meta.sell;
  if (!meta.avg_buy && (meta as Record<string, string>).avgBuy) meta.avg_buy = (meta as Record<string, string>).avgBuy;
  if (!meta.merchant_cost && (meta as Record<string, string>).merchantCost) meta.merchant_cost = (meta as Record<string, string>).merchantCost;

  return meta;
}

export function buildDealRowModel({
  deal,
  perspective,
  locale,
  resolveAvgBuy,
}: {
  deal: MerchantDeal | any;
  perspective: DealRowPerspective;
  locale: 'en' | 'ar';
  resolveAvgBuy?: (deal: MerchantDeal | any, normalizedMeta: Record<string, string>) => number;
}): DealRowModel {
  const meta = parseDealMeta(deal.notes);
  const mergedMeta: Record<string, unknown> = {
    ...meta,
    ...((deal.metadata && typeof deal.metadata === 'object') ? deal.metadata : {}),
  };
  const quantity = Number(meta.quantity) || Number(deal.amount) || 0;
  const sellPrice = Number(meta.sell_price) || 0;
  const fee = Number(meta.fee) || 0;

  const resolvedAvg = resolveAvgBuy ? resolveAvgBuy(deal, meta) : 0;
  const mergedAvg =
    Number(mergedMeta.avg_buy) ||
    Number(mergedMeta.avgBuy) ||
    Number(mergedMeta.merchant_cost) ||
    Number(mergedMeta.merchantCost) ||
    ((Number(mergedMeta.fifo_cost) > 0 && quantity > 0) ? Number(mergedMeta.fifo_cost) / quantity : 0) ||
    0;
  const avgBuy = Math.max(0, resolvedAvg > 0 ? resolvedAvg : mergedAvg);
  const hasAvgBuy = avgBuy > 0;

  const volume = quantity * sellPrice;
  const cost = quantity * avgBuy;
  const fullNet = hasAvgBuy && sellPrice > 0 ? volume - cost - fee : null;

  const toPct = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(String(v).replace('%', '').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const firstPct = (...keys: string[]): number | null => {
    for (const key of keys) {
      const pct = toPct(mergedMeta[key]);
      if (pct != null) return pct;
    }
    return null;
  };
  let partnerPct: number | null = null;
  if (deal.deal_type === 'partnership') {
    partnerPct = firstPct('partner_ratio', 'counterparty_share_pct', 'counterparty_share');
  } else {
    partnerPct = firstPct('counterparty_share_pct', 'counterparty_share', 'partner_ratio');
    if (partnerPct == null) {
      const merchantMetaPct = firstPct('merchant_share_pct', 'merchant_share', 'merchant_ratio');
      if (merchantMetaPct != null) partnerPct = 100 - merchantMetaPct;
    }
  }
  const merchantPct = partnerPct != null ? 100 - partnerPct : null;
  const myPct = perspective === 'incoming' ? partnerPct : merchantPct;
  const myNet = fullNet == null ? null : (myPct != null ? fullNet * (myPct / 100) : fullNet);
  const margin = myNet != null && volume > 0 ? myNet / volume : null;

  const family = getAgreementFamilyLabel(deal.deal_type, locale);
  const splitLabel = partnerPct != null ? `${partnerPct}%/${100 - partnerPct}%` : null;

  const dateLabel = meta.trade_date
    ? new Date(meta.trade_date).toLocaleDateString()
    : (deal.created_at ? new Date(deal.created_at).toLocaleDateString() : '—');

  return {
    meta,
    quantity,
    avgBuy,
    sellPrice,
    volume,
    fee,
    cost,
    hasAvgBuy,
    fullNet,
    myNet,
    margin,
    buyer: meta.customer || meta.buyer || '',
    familyLabel: family.label,
    familyIcon: family.icon,
    splitLabel,
    myPct,
    partnerPct,
    merchantPct,
    status: String(deal.status || 'pending'),
    dateLabel,
  };
}
