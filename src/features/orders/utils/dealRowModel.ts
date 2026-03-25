import { getAgreementFamilyLabel, getDealShares } from '@/lib/deal-templates';
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
  const quantity = Number(meta.quantity) || Number(deal.amount) || 0;
  const sellPrice = Number(meta.sell_price) || 0;
  const fee = Number(meta.fee) || 0;

  const avgBuy = Math.max(0, resolveAvgBuy ? resolveAvgBuy(deal, meta) : (Number(meta.avg_buy) || 0));
  const hasAvgBuy = avgBuy > 0;

  const volume = quantity * sellPrice;
  const cost = quantity * avgBuy;
  const fullNet = hasAvgBuy && sellPrice > 0 ? volume - cost - fee : null;

  const { partnerPct, merchantPct } = getDealShares(deal);
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
