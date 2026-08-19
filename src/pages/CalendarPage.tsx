import { useMemo, useState } from 'react';
import { useTrackerState } from '@/lib/useTrackerState';
import {
  fmtQ, fmtQRaw, fmtU, fmtP, fmtPct, fmtQWithUnit,
  getMonthlyLoanPayments, type DayPayment,
} from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import '@/styles/tracker.css';

export default function CalendarPage() {
  const { settings } = useTheme();
  const t = useT();
  const { state, derived } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
  });
  const [cal, setCal] = useState(state.cal);

  const mnKeys = ['january','february','march','april','may','june','july','august','september','october','november','december'] as const;
  const dnKeys = ['sun','mon','tue','wed','thu','fri','sat'] as const;
  const mn = mnKeys.map(k => t(k));
  const dn = dnKeys.map(k => t(k));

  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth(), curD = now.getDate();
  const { year, month, selectedDay } = cal;
  const daysInM = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  /** A day's payment plus the resolved customer name for display. */
  type DayPaymentRow = DayPayment & { customer: string };

  /**
   * Loans can be held in different currencies, so payments are totalled per
   * currency and never added across them. QAR leads wherever a single figure
   * has to be shown; the rest are listed beside it.
   */
  const leadPayment = (totals: Record<string, number>) => {
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

  // Build month data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mData: Record<number, { profit: number; trades: number; volumeQAR: number; wins: number; losses: number; marginSum: number; tradeList: any[]; paymentTotals: Record<string, number>; paymentCount: number; paymentList: DayPaymentRow[] }> = {};
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const myPct = (tr as any).merchantPct ?? 100;
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
        customer: state.customers.find(c => c.id === p.customerId)?.name || p.customerId,
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

  const selData = selectedDay ? mData[selectedDay] : null;

  const prevMonth = () => {
    let y = year, m = month - 1;
    if (m < 0) { m = 11; y--; }
    setCal({ year: y, month: m, selectedDay: null });
  };
  const nextMonth = () => {
    let y = year, m = month + 1;
    if (m > 11) { m = 0; y++; }
    setCal({ year: y, month: m, selectedDay: null });
  };
  const goToday = () => setCal({ year: now.getFullYear(), month: now.getMonth(), selectedDay: null });
  const selectDay = (d: number) => setCal(prev => ({ ...prev, selectedDay: prev.selectedDay === d ? null : d }));

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>
      {/* Stats */}
      <div className="cal-stats">
        <div className="cal-stat">
          <div className="kpi-lbl">{t('monthlyProfit')}</div>
          <div className={`kpi-val ${totalP >= 0 ? 'good' : 'bad'}`}>{(totalP >= 0 ? '+' : '') + fmtQ(totalP)}</div>
        </div>
        <div className="cal-stat">
          <div className="kpi-lbl">{t('totalTrades')}</div>
          <div className="kpi-val">{totalT}</div>
        </div>
        <div className="cal-stat">
          <div className="kpi-lbl">{t('tradingDays')}</div>
          <div className="kpi-val">
            {tradeDays}
            {bestDay && <span className="cycle-badge" style={{ marginLeft: 4 }}>{t('best')}: {mn[month].slice(0, 3)} {bestDay[0]}</span>}
            {worstDay && <span className="cycle-badge" style={{ marginLeft: 4 }}>{t('worst')}: {mn[month].slice(0, 3)} {worstDay[0]}</span>}
          </div>
        </div>
        <div className="cal-stat">
          <div className="kpi-lbl">{t('monthlyVolume')}</div>
          <div className="kpi-val">{fmtQWithUnit(totalV, 'QAR', null, 'QAR', t.lang)}</div>
        </div>
        <div className="cal-stat">
          <div className="kpi-lbl">{t('winRate')}</div>
          <div className="kpi-val">{(winRate * 100).toFixed(0)}%</div>
        </div>
        <div className="cal-stat">
          <div className="kpi-lbl">{t('avgMargin')}</div>
          <div className="kpi-val">{fmtPct(avgMargin)}</div>
        </div>
        <div className="cal-stat">
          <div className="kpi-lbl">{t('calPayments')}</div>
          <div className="kpi-val" style={{ color: 'var(--t2)' }}>
            {monthPayLead ? `${fmtQRaw(monthPayLead.amount)} ${monthPayLead.currency}` : fmtQ(0)}
          </div>
          <div className="cal-stat-sub">
            {totalPayCount} {t('calPaymentsReceived')}
            {monthPayLead?.others.map(o => ` · ${fmtQRaw(o.amount)} ${o.currency}`).join('')}
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="panel">
        <div className="panel-head">
          <h2>{mn[month]} {year}</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn secondary" onClick={prevMonth}>{t('prev')}</button>
            <button className="btn secondary" onClick={goToday}>{t('today')}</button>
            <button className="btn secondary" onClick={nextMonth}>{t('next')}</button>
          </div>
        </div>
        <div className="panel-body">
          <div className="cal-grid">
            {dn.map(d => <div key={d} className="cal-hdr">{d}</div>)}
            {Array.from({ length: firstDay }, (_, i) => (
              <div key={`e-${i}`} className="cal-day empty-day" />
            ))}
            {Array.from({ length: daysInM }, (_, i) => {
              const d = i + 1;
              const data = mData[d];
              const hasP = data.profit > 0;
              const hasL = data.profit < 0;
              const hasPay = data.paymentCount > 0;
              const isTdy = d === curD && year === curY && month === curM;
              const isSel = d === selectedDay;
              // A day with payments but no trades still gets a tint, so it
              // reads as an active day rather than an empty one.
              const tone = hasP ? ' has-profit' : hasL ? ' has-loss' : hasPay ? ' has-payment' : '';

              return (
                <div
                  key={d}
                  className={`cal-day${tone}${isTdy ? ' today' : ''}${isSel ? ' selected' : ''}`}
                  onClick={() => selectDay(d)}
                >
                  <div className="cal-num">{d}</div>
                  {data.trades > 0 && (
                    <div className={`cal-amt cal-profit ${hasP ? 'good' : 'bad'}`}>
                      {(data.profit >= 0 ? '+' : '') + fmtQRaw(data.profit)}
                    </div>
                  )}
                  {hasPay && (() => {
                    const lead = leadPayment(data.paymentTotals);
                    return lead && (
                      <div className="cal-amt cal-pay">
                        {fmtQRaw(lead.amount)}{lead.others.length > 0 && '…'}
                      </div>
                    );
                  })()}
                  {(data.trades > 0 || hasPay) && (
                    <div className="cal-count">
                      {data.trades > 0 && `${data.trades}t`}
                      {data.trades > 0 && hasPay && ' · '}
                      {hasPay && `${data.paymentCount}p`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDay && selData && (selData.trades > 0 || selData.paymentCount > 0) && (
        <div className="cal-detail">
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
            📅 {mn[month]} {selectedDay}, {year}
            {selData.trades > 0 && (
              <> — {selData.trades} {t('trades')} · Vol {fmtQWithUnit(selData.volumeQAR, 'QAR', null, 'QAR', t.lang)} · {t('net')} {(selData.profit >= 0 ? '+' : '') + fmtQ(selData.profit)} · {t('winRate')} {((selData.wins / selData.trades) * 100).toFixed(0)}%</>
            )}
            {selData.paymentCount > 0 && (
              <span style={{ color: 'var(--t2)' }}>
                {selData.trades > 0 ? ' · ' : ' — '}{t('calPayments')}{' '}
                {Object.entries(selData.paymentTotals).map(([cur, amt]) => `${fmtQRaw(amt)} ${cur}`).join(' · ')}
                {' '}({selData.paymentCount})
              </span>
            )}
          </div>

          {selData.paymentCount > 0 && (
            <div className="cal-pay-list">
              {[...selData.paymentList].sort((a, b) => a.ts - b.ts).map(p => (
                <div key={p.id} className="cal-pay-row">
                  <span className="mono" style={{ color: 'var(--muted)' }}>
                    {new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="cal-pay-who">{p.customer}{p.note ? ` · ${p.note}` : ''}</span>
                  <span className="mono" style={{ color: 'var(--t2)', fontWeight: 700 }}>
                    +{fmtQRaw(p.amount)} {p.currency}
                  </span>
                </div>
              ))}
            </div>
          )}

          {selData.trades > 0 && (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{t('time')}</th>
                  <th className="r">{t('qty')}</th>
                  <th className="r">{t('avgBuy')}</th>
                  <th className="r">{t('sell')}</th>
                  <th className="r">{t('volume')}</th>
                  <th className="r">{t('net')}</th>
                  <th className="r">{t('margin')}</th>
                </tr>
              </thead>
              <tbody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {selData.tradeList.map((tr: any) => (
                  <tr key={tr.id}>
                    <td className="mono">
                      {tr.isLinked && <span title="Partner deal" style={{ marginRight: 3 }}>🤝</span>}
                      {new Date(tr.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="mono r">{fmtU(tr.amountUSDT)}</td>
                    <td className="mono r" style={{ color: 'var(--bad)' }}>{fmtP(tr.avgBuy)}</td>
                    <td className="mono r" style={{ color: 'var(--good)' }}>{fmtP(tr.sellPriceQAR)}</td>
                    <td className="mono r">{fmtQ(tr.rev)}</td>
                    <td className="mono r" style={{ color: tr.net >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                      {(tr.net >= 0 ? '+' : '') + fmtQ(tr.net)}
                    </td>
                    <td className="mono r" style={{ color: tr.margin >= 1 ? 'var(--good)' : tr.margin < 0 ? 'var(--bad)' : 'var(--warn)' }}>
                      {fmtPct(tr.margin)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
      {selectedDay && selData && selData.trades === 0 && selData.paymentCount === 0 && (
        <div className="cal-detail">
          <div className="muted" style={{ fontSize: 11, padding: '8px 0' }}>
            {t('noTradesOnDay')} {mn[month]} {selectedDay}. <button className="rowBtn">{t('logATrade')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
