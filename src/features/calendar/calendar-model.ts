import { getMonthlyLoanPayments, resolveCustomerName, type DayPayment, type Trade, type TrackerState, type DerivedState } from '@/lib/tracker-helpers';

export interface CalendarDay {
  profit: number; trades: number; volumeQAR: number; wins: number; losses: number; marginSum: number;
  tradeList: (Trade & { net: number; margin: number; avgBuy: number; rev: number; isLinked: boolean })[];
  paymentTotals: Record<string, number>; paymentCount: number; paymentList: (DayPayment & { customer: string })[];
}

export const leadPayment = (totals: Record<string, number>) => {
    const currencies = Object.keys(totals);
    if (!currencies.length) return null;
    const lead = currencies.includes('QAR')
      ? 'QAR'
      : [...currencies].sort((a, b) => totals[b] - totals[a])[0];
    return {
      currency: lead,
      amount: totals[lead],
      others: currencies.filter(c => c !== lead).map(c => ({ currency: c, amount: totals[c] })),
    };
  };


export function buildCalendarMonth(state: TrackerState, derived: DerivedState, year: number, month: number, lang: 'en' | 'ar') {
  const normalized = new Date(year, month, 1);
  year = normalized.getFullYear();
  month = normalized.getMonth();
  const daysInM = new Date(year, month + 1, 0).getDate();
  /** A day's payment plus the resolved customer name for display. */


  /**
   * Loans can be held in different currencies, so payments are totalled per
   * currency and never added across them. QAR leads wherever a single figure
   * has to be shown; the rest are listed beside it.
   */
  // Build month data
  const mData: Record<number, CalendarDay> = {};
  for (let d = 1; d <= daysInM; d++) mData[d] = { profit: 0, trades: 0, volumeQAR: 0, wins: 0, losses: 0, marginSum: 0, tradeList: [], paymentTotals: {}, paymentCount: 0, paymentList: [] };

  const seenTradeIds = new Set<string>();
  for (const tr of state.trades.filter(tr => !tr.voided)) {
    if (seenTradeIds.has(tr.id)) continue;
    seenTradeIds.add(tr.id);
    const dt = new Date(tr.ts);
    if (dt.getFullYear() === year && dt.getMonth() === month) {
      const c = derived.tradeCalc.get(tr.id);
      const d2 = dt.getDate();
      const rev = tr.amountUSDT * tr.sellPriceQAR;
      // Use FIFO result if available, otherwise compute from manual buy price
      let netQAR = 0;
      let margin = 0;
      let avgBuy = 0;
      if (c?.ok) {
        netQAR = c.netQAR;
        margin = c.margin;
        avgBuy = c.avgBuyQAR;
      } else if (tr.manualBuyPrice) {
        const cost = tr.amountUSDT * tr.manualBuyPrice;
        netQAR = rev - cost - tr.feeQAR;
        margin = rev > 0 ? (netQAR / rev) * 100 : 0;
        avgBuy = tr.manualBuyPrice;
      }
      // For linked/partner trades, show only my share of the profit
      if (tr.linkedDealId || tr.linkedRelId) {
          const myPct = tr.merchantPct ?? 100;
        netQAR = netQAR * myPct / 100;
        margin = rev > 0 ? (netQAR / rev) * 100 : 0;
      }
      if (rev > 0 || netQAR !== 0) {
        mData[d2].profit += netQAR;
        mData[d2].volumeQAR += rev;
        mData[d2].trades++;
        mData[d2].marginSum += Number.isFinite(margin) ? margin : 0;
        void (netQAR >= 0 ? mData[d2].wins++ : mData[d2].losses++);
        mData[d2].tradeList.push({
          ...tr, net: netQAR, margin, avgBuy, rev,
          isLinked: !!tr.linkedDealId || !!tr.linkedRelId,
        });
      }
    }
  }

  // Customer payments — loan repayments bucketed by the day the money came in.
  const paymentsByDay = getMonthlyLoanPayments(state.customerLoans, state.deletedLoanIds, year, month);
  for (const [day, payments] of Object.entries(paymentsByDay)) {
    const d2 = Number(day);
    if (!mData[d2]) continue;
    for (const p of payments) {
      mData[d2].paymentTotals[p.currency] = (mData[d2].paymentTotals[p.currency] || 0) + p.amount;
      mData[d2].paymentCount++;
      mData[d2].paymentList.push({
        ...p,
        customer: (() => { const cu = state.customers.find(c => c.id === p.customerId); return cu ? resolveCustomerName(cu, lang) : p.customerId; })(),
      });
    }
  }

  const totalP = Object.values(mData).reduce((s, d) => s + d.profit, 0);
  const totalT = Object.values(mData).reduce((s, d) => s + d.trades, 0);
  const totalV = Object.values(mData).reduce((s, d) => s + d.volumeQAR, 0);
  const monthPaymentTotals: Record<string, number> = {};
  for (const d of Object.values(mData)) {
    for (const [cur, amt] of Object.entries(d.paymentTotals)) {
      monthPaymentTotals[cur] = (monthPaymentTotals[cur] || 0) + amt;
    }
  }
  const monthPayLead = leadPayment(monthPaymentTotals);
  const totalPayCount = Object.values(mData).reduce((s, d) => s + d.paymentCount, 0);
  const wins = Object.values(mData).reduce((s, d) => s + d.wins, 0);
  const tradeDays = Object.values(mData).filter(d => d.trades > 0).length;
  const bestDay = Object.entries(mData).filter(([, d]) => d.trades > 0).sort((a, b) => b[1].profit - a[1].profit)[0];
  const worstDay = Object.entries(mData).filter(([, d]) => d.trades > 0).sort((a, b) => a[1].profit - b[1].profit)[0];
  const avgMargin = totalT ? Object.values(mData).reduce((s, d) => s + d.marginSum, 0) / totalT : 0;
  const winRate = totalT ? (wins / totalT) : 0;

  return { mData, totalP, totalT, totalV, monthPayLead, totalPayCount, wins, tradeDays, bestDay, worstDay, avgMargin, winRate };
}
