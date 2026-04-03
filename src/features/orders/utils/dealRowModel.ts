import { getAgreementFamilyLabel } from '@/lib/deal-templates';
import { calculateOperatorPriorityProfit, resolveOperatorPriorityPerspective } from '@/lib/trading/operator-priority';
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
  creatorNet: number | null;
  partnerNet: number | null;
  myNet: number | null;
  margin: number | null;
  buyer: string;
  familyLabel: string;
  familyIcon: string;
  splitLabel: string | null;
  myPct: number | null;
  partnerPct: number | null;
  merchantPct: number | null; // creator side
  fallbackSplitApplied: boolean;
  status: string;
  dateLabel: string;
  /** true when operator priority agreement — split is by capital weight not fixed pct */
  isOperatorPriority: boolean;
  operatorFee: number | null;
  operatorTotal: number | null;
  lenderTotal: number | null;
  /** true when the current user is the operator in an operator_priority deal */
  iAmOperator: boolean;
  /** operator_merchant_id from agreement/metadata */
  operatorMerchantId: string;
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
  agreements,
  myMerchantId,
}: {
  deal: MerchantDeal | any;
  perspective: DealRowPerspective;
  locale: 'en' | 'ar';
  resolveAvgBuy?: (deal: MerchantDeal | any, normalizedMeta: Record<string, string>) => number;
  agreements?: { id: string; relationship_id: string; agreement_type: string; operator_ratio?: number | null; operator_contribution?: number | null; lender_contribution?: number | null; operator_merchant_id?: string | null }[];
  myMerchantId?: string;
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
  const parseRatioString = (v: unknown): { left: number; right: number } | null => {
    if (typeof v !== 'string') return null;
    const m = v.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const left = Number(m[1]);
    const right = Number(m[2]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    const total = left + right;
    if (total <= 0) return null;
    return { left, right };
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
  if (partnerPct == null) {
    // Fallback 1: ratio-like values in notes/meta/title ("50/50")
    const ratio =
      parseRatioString(String(mergedMeta.split_ratio ?? '')) ||
      parseRatioString(String(mergedMeta.ratio ?? '')) ||
      parseRatioString(String(mergedMeta.split ?? '')) ||
      parseRatioString(String(mergedMeta.title ?? deal.title ?? ''));
    if (ratio) {
      partnerPct = (ratio.left / (ratio.left + ratio.right)) * 100;
    }
  }

  // Explicit normalized fallback rule when split is truly unavailable: 50/50.
  const fallbackSplitApplied = partnerPct == null;
  const normalizedPartnerPct = partnerPct ?? 50;
  const merchantPct = 100 - normalizedPartnerPct;

  // Detect operator priority agreement — check metadata, then fallback to agreements array
  let isOperatorPriority = String(mergedMeta.agreement_type || mergedMeta.template || deal.deal_type || '').includes('operator_priority');
  let operatorRatio = Number(mergedMeta.operator_ratio) || 0;
  let operatorContribution = Number(mergedMeta.operator_contribution) || 0;
  let lenderContribution = Number(mergedMeta.lender_contribution) || 0;

  // Fallback: look up operator priority from agreements array when metadata doesn't have it
  if (!isOperatorPriority && agreements?.length) {
    const matchedAgr = agreements.find(a =>
      a.relationship_id === deal.relationship_id && a.agreement_type === 'operator_priority'
    );
    if (matchedAgr) {
      isOperatorPriority = true;
      operatorRatio = Number(matchedAgr.operator_ratio) || operatorRatio;
      operatorContribution = Number(matchedAgr.operator_contribution) || operatorContribution;
      lenderContribution = Number(matchedAgr.lender_contribution) || lenderContribution;
      if (!mergedMeta.operator_merchant_id && matchedAgr.operator_merchant_id) {
        mergedMeta.operator_merchant_id = matchedAgr.operator_merchant_id;
      }
    }
  }

  const resolvedOperatorMerchantId = String(mergedMeta.operator_merchant_id || '');
  const iAmOperatorResolved = resolvedOperatorMerchantId && myMerchantId
    ? myMerchantId === resolvedOperatorMerchantId
    : false;

  let creatorNet: number | null;
  let partnerNet: number | null;
  let myNet: number | null;
  let myPct: number | null;
  let splitLabel: string | null;
  let operatorFee: number | null = null;
  let operatorTotal: number | null = null;
  let lenderTotal: number | null = null;

  if (isOperatorPriority && fullNet != null && fullNet > 0) {
    const opResult = calculateOperatorPriorityProfit({
      grossProfit: fullNet,
      operatorRatio,
      operatorContribution,
      lenderContribution,
    });
    operatorFee = opResult.operatorFee;
    operatorTotal = opResult.operatorTotal;
    lenderTotal = opResult.lenderTotal;

    creatorNet = null; // not meaningful for operator priority
    partnerNet = null;
    myNet = iAmOperatorResolved ? opResult.operatorTotal : opResult.lenderTotal;
    myPct = fullNet > 0 ? ((myNet ?? 0) / fullNet) * 100 : 0;
    splitLabel = `⚙️ ${operatorRatio}% fee · capital weight`;
  } else {
    myPct = perspective === 'incoming' ? normalizedPartnerPct : merchantPct;
    const creatorPct = merchantPct;
    creatorNet = fullNet == null ? null : fullNet * (creatorPct / 100);
    partnerNet = fullNet == null || creatorNet == null ? null : fullNet - creatorNet;
    myNet = fullNet == null ? null : (perspective === 'incoming' ? partnerNet : creatorNet);
    splitLabel = `${normalizedPartnerPct}%/${100 - normalizedPartnerPct}%`;
  }

  const margin = myNet != null && volume > 0 ? myNet / volume : null;

  const family = getAgreementFamilyLabel(deal.deal_type, locale);

  const rawDate = meta.trade_date ? new Date(meta.trade_date) : (deal.created_at ? new Date(deal.created_at) : null);
  const dateLabel = rawDate
    ? `${rawDate.getDate()}/${rawDate.getMonth() + 1}/${rawDate.getFullYear()}`
    : '—';

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
    creatorNet,
    partnerNet,
    myNet,
    margin,
    buyer: meta.customer || meta.buyer || '',
    familyLabel: family.label,
    familyIcon: family.icon,
    splitLabel,
    myPct,
    partnerPct: normalizedPartnerPct,
    merchantPct,
    fallbackSplitApplied,
    status: String(deal.status || 'pending'),
    dateLabel,
    isOperatorPriority,
    operatorFee,
    operatorTotal,
    lenderTotal,
    iAmOperator: iAmOperatorResolved,
    operatorMerchantId: resolvedOperatorMerchantId,
  };
}
