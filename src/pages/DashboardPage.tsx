import { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrackerState } from '@/lib/useTrackerState';
import {
  fmtQWithUnit, fmtU, fmtQ, fmtPct, fmtP,
  fmtTotal, fmtPrice,
  kpiFor, totalStock, stockCostQAR, getWACOP,
  rangeLabel, num, startOfDay,
} from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useQuery } from '@tanstack/react-query';
import { CashBoxManager } from '@/features/dashboard/components/CashBoxManager';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import '@/styles/tracker.css';

export default function DashboardPage() {
  const { settings } = useTheme();
  const t = useT();
  const navigate = useNavigate();
  const { state, derived, applyState } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
  });

  const d1 = kpiFor(state, derived, 'today');
  const d7 = kpiFor(state, derived, '7d');
  const dR = kpiFor(state, derived, settings.range);
  const stk = totalStock(derived);
  const stCost = stockCostQAR(derived);
  const wacop = getWACOP(derived);
  const rLabel = rangeLabel(settings.range);

  const allTrades = state.trades.filter(t => !t.voided);
  const allMargins = allTrades.map(t => {
    const c = derived.tradeCalc.get(t.id);
    return c?.ok ? c.margin : null;
  }).filter((x): x is number => x !== null);
  const avgM = allMargins.length ? allMargins.reduce((s, v) => s + v, 0) / allMargins.length : 0;

  const LOW = num(state.settings?.lowStockThreshold, 5000);
  const isLow = stk <= 0 || (LOW > 0 && stk < LOW);

  const [showCashBox, setShowCashBox] = useState(false);
  const { user, merchantProfile } = useAuth();
  const userId = user?.id;

  // Merchant deals KPIs
  const { data: merchantDealKpis } = useQuery({
    queryKey: ['dashboard-merchant-deals', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data: deals } = await supabase
        .from('merchant_deals')
        .select('id, amount, status, created_by, notes, deal_type')
        .order('created_at', { ascending: false });
      if (!deals || deals.length === 0) return null;

      // Filter out cancelled and voided deals
      const activeDeals = deals.filter(d => d.status !== 'cancelled' && d.status !== 'voided');
      const dealIds = activeDeals.map(d => d.id);

      // Fetch authoritative allocation data
      const { data: allocations } = dealIds.length > 0
        ? await supabase
            .from('order_allocations')
            .select('order_id, allocation_net, partner_amount, merchant_amount, allocation_revenue, partner_share_pct, merchant_share_pct')
            .in('order_id', dealIds)
        : { data: [] as any[] };

      // Build allocation lookup by deal id
      const allocMap = new Map<string, { partnerAmt: number; merchantAmt: number; net: number; rev: number }>();
      for (const a of (allocations || [])) {
        const existing = allocMap.get(a.order_id) || { partnerAmt: 0, merchantAmt: 0, net: 0, rev: 0 };
        existing.partnerAmt += Number(a.partner_amount) || 0;
        existing.merchantAmt += Number(a.merchant_amount) || 0;
        existing.net += Number(a.allocation_net) || 0;
        existing.rev += Number(a.allocation_revenue) || 0;
        allocMap.set(a.order_id, existing);
      }

      const parseMeta = (notes: string | null) => {
        if (!notes) return {} as Record<string, string>;
        const map: Record<string, string> = {};
        notes.split('|').forEach(seg => {
          const idx = seg.indexOf(':');
          if (idx > 0) map[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim();
        });
        return map;
      };

      let outCount = 0, outVol = 0, outNet = 0;
      let inCount = 0, inVol = 0, inNet = 0;
      let pendingCount = 0, approvedCount = 0;

      for (const d of activeDeals) {
        const alloc = allocMap.get(d.id);
        const meta = parseMeta(d.notes);
        const vol = alloc ? alloc.rev : Number(d.amount) || 0;

        // Use full deal net as source of truth for the dashboard KPI; fall back to notes-based calc
        let dealNet = 0;
        if (alloc) {
          dealNet = alloc.net;
        } else {
          const qty = Number(meta.quantity) || 0;
          const sell = Number(meta.sell_price) || 0;
          const avgBuy = Number(meta.avg_buy) || Number(meta.merchant_cost) || 0;
          const fee = Number(meta.fee) || 0;
          dealNet = sell > 0 && avgBuy > 0 ? (qty * sell) - (qty * avgBuy) - fee : 0;
        }

        if (d.status === 'pending') pendingCount++;
        if (d.status === 'approved') approvedCount++;

        if (d.created_by === userId) {
          outCount++;
          outVol += vol;
          outNet += dealNet;
        } else {
          inCount++;
          inVol += vol;
          inNet += dealNet;
        }
      }

      return {
        totalDeals: activeDeals.length,
        outCount, outVol, outNet,
        inCount, inVol, inNet,
        pendingCount, approvedCount,
        totalVol: outVol + inVol,
        totalNet: outNet + inNet,
      };
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const handleCashSave = useCallback((newCash: number, owner: string, history?: import('@/lib/tracker-helpers').CashTransaction[]) => {
    applyState({ ...state, cashQAR: newCash, cashOwner: owner, cashHistory: history ?? state.cashHistory ?? [] });
  }, [state, applyState]);


  // ── P2P Averages from real trade data ──
  const p2pAvgs = useMemo(() => {
    const sellTrades = allTrades.filter(t => t.usesStock && t.sellPriceQAR > 0);
    const avgSell = sellTrades.length ? sellTrades.reduce((s, t) => s + t.sellPriceQAR, 0) / sellTrades.length : null;
    // Avg buy from batches
    const batches = state.batches.filter(b => b.buyPriceQAR > 0);
    const avgBuy = batches.length ? batches.reduce((s, b) => s + b.buyPriceQAR, 0) / batches.length : null;
    return { avgSell, avgBuy };
  }, [allTrades, state.batches]);

  // Helper: get net P&L for a trade (FIFO or manual fallback)
  const tradeNet = (tr: typeof allTrades[0]) => {
    const c = derived.tradeCalc.get(tr.id);
    if (c?.ok) return c.netQAR;
    if (tr.manualBuyPrice) return tr.amountUSDT * tr.sellPriceQAR - tr.amountUSDT * tr.manualBuyPrice - tr.feeQAR;
    return 0;
  };

  // ── Chart 1: Profit & Revenue Trend (last 14 trades) ──
  const trendData = useMemo(() => {
    const sorted = [...allTrades].sort((a, b) => a.ts - b.ts).slice(-14);
    return sorted.map((tr, i) => {
      const rev = tr.amountUSDT * tr.sellPriceQAR;
      return {
        idx: i + 1,
        date: new Date(tr.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        revenue: Math.round(rev),
        profit: Math.round(tradeNet(tr)),
      };
    });
  }, [allTrades, derived]);

  // ── Chart 2: Net Profit Per Trade (all time, bar chart) ──
  const profitPerTradeData = useMemo(() => {
    const sorted = [...allTrades].sort((a, b) => a.ts - b.ts);
    return sorted.map((tr, i) => {
      const net = tradeNet(tr);
      return {
        idx: i + 1,
        profit: Math.round(net),
        positive: net >= 0,
      };
    });
  }, [allTrades, derived]);

  // ── Chart 3: Daily Volume & Profit (aggregated by day) ──
  const dailyData = useMemo(() => {
    const dayMap = new Map<number, { vol: number; profit: number; count: number }>();
    for (const tr of allTrades) {
      const dayTs = startOfDay(tr.ts);
      const rev = tr.amountUSDT * tr.sellPriceQAR;
      const net = tradeNet(tr);
      const existing = dayMap.get(dayTs) || { vol: 0, profit: 0, count: 0 };
      existing.vol += rev;
      existing.profit += net;
      existing.count += 1;
      dayMap.set(dayTs, existing);
    }
    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a - b)
      .slice(-14)
      .map(([ts, d]) => ({
        date: new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        volume: Math.round(d.vol),
        profit: Math.round(d.profit),
        trades: d.count,
      }));
  }, [allTrades, derived]);

  // ── Recharts custom tooltip ──
  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: 'var(--panel2)', border: '1px solid var(--line)',
        borderRadius: 6, padding: '6px 10px', fontSize: 10,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>{label}</div>
        {payload.map((p: any, i: number) => (
          <div key={i} style={{ color: p.color, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <span>{p.name}</span>
            <span className="mono" style={{ fontWeight: 700 }}>{fmtTotal(Number(p.value))} QAR</span>
          </div>
        ))}
      </div>
    );
  };

  const badgeStyle = (condition: string) => {
    const color = condition === 'good' ? 'var(--good)' : condition === 'bad' ? 'var(--bad)' : 'var(--warn)';
    return {
      color,
      borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
      background: `color-mix(in srgb, ${color} 10%, transparent)`,
    };
  };

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>
      {/* KPI Bands */}
      <div className="kpi-band-grid">
        <div className="kpi-band">
          <div className="kpi-band-title">{t('tradingVolume')}</div>
          <div className="kpi-band-cols">
            <div>
              <div className="kpi-period">{t('oneDay')}</div>
              <div className="kpi-cell-val t1v">{fmtQWithUnit(d1.rev)}</div>
              <div className="kpi-cell-sub">{d1.count} {t('trades')} · {fmtU(d1.qty, 0)} USDT</div>
            </div>
            <div>
              <div className="kpi-period">{t('sevenDays')}</div>
              <div className="kpi-cell-val t1v">{fmtQWithUnit(d7.rev)}</div>
              <div className="kpi-cell-sub">{d7.count} {t('trades')} · {fmtU(d7.qty, 0)} USDT</div>
            </div>
          </div>
        </div>
        <div className="kpi-band">
          <div className="kpi-band-title">{t('netProfit')}</div>
          <div className="kpi-band-cols">
            <div>
              <div className="kpi-period">{t('oneDay')}</div>
              <div className={`kpi-cell-val ${d1.net >= 0 ? 'good' : 'bad'}`}>{fmtQWithUnit(d1.net)}</div>
              <div className="kpi-cell-sub">{t('fees')} {fmtQWithUnit(d1.fee)}</div>
            </div>
            <div>
              <div className="kpi-period">{t('sevenDays')}</div>
              <div className={`kpi-cell-val ${d7.net >= 0 ? 'good' : 'bad'}`}>{fmtQWithUnit(d7.net)}</div>
              <div className="kpi-cell-sub">{t('fees')} {fmtQWithUnit(d7.fee)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards Row 1 */}
      <div className="kpis">
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={badgeStyle(dR.net >= 0 ? 'good' : 'bad')}>{rLabel}</span>
          </div>
          <div className="kpi-lbl">{t('netProfitLabel')}</div>
          <div className={`kpi-val ${dR.net >= 0 ? 'good' : 'bad'}`}>{fmtQWithUnit(dR.net)}</div>
          <div className="kpi-sub">{dR.count} {t('trades')} · {fmtQ(dR.rev)} {t('revSuffix')}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={badgeStyle(avgM >= 1 ? 'good' : avgM >= 0 ? 'warn' : 'bad')}>{allTrades.length} {t('trades')}</span>
          </div>
          <div className="kpi-lbl">{t('avgMargin')}</div>
          <div className={`kpi-val ${avgM >= 1 ? 'good' : avgM >= 0 ? 'warn' : 'bad'}`}>{fmtPct(avgM)}</div>
          <div className="kpi-sub">{dR.count} in range · avg {fmtPct(dR.avgMgn)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={badgeStyle(isLow ? 'bad' : 'good')}>{isLow ? t('low') : t('ok')}</span>
          </div>
          <div className="kpi-lbl">{t('availableUsdt')}</div>
          <div className={`kpi-val ${isLow ? 'bad' : 'good'}`} style={isLow ? { animation: 'tracker-blink 1.5s infinite' } : undefined}>{fmtU(stk, 0)}</div>
          <div className="kpi-sub">{t('liquidUsdt')}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--brand)', borderColor: 'color-mix(in srgb,var(--brand) 30%,transparent)', background: 'var(--brand3)' }}>{t('avPrice')}</span>
          </div>
          <div className="kpi-lbl">{t('avPriceSpread')}</div>
          <div className="kpi-val" style={{ fontSize: 16, color: 'var(--t2)' }}>{wacop ? fmtP(wacop) + ' QAR' : t('noStock')}</div>
          <div className="kpi-sub">
            {(() => {
              const sp = wacop && p2pAvgs.avgSell ? fmtPrice((p2pAvgs.avgSell - wacop) / wacop * 100) : null;
              return sp !== null
                ? <span className={Number(sp) >= 0 ? 'good' : 'bad'} style={{ fontWeight: 700 }}>{Number(sp) >= 0 ? '+' : ''}{sp}% vs P2P</span>
                : t('sellAboveAvPrice');
            })()}
          </div>
        </div>
      </div>

      {/* Cash · Buying Power · Net Position · Stock Cost Est */}
      <div className="kpis" style={{ marginTop: 0 }}>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--warn)', borderColor: 'color-mix(in srgb,var(--warn) 30%,transparent)', background: 'color-mix(in srgb,var(--warn) 10%,transparent)' }}>{t('cash')}</span>
          </div>
          <div className="kpi-lbl">{t('cashAvailable')}</div>
          <div className="kpi-val" style={{ color: 'var(--warn)' }}>{fmtQWithUnit(num(state.cashQAR, 0))}</div>
          <div className="kpi-sub" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="rowBtn" style={{ fontSize: 9, padding: '3px 8px' }} onClick={() => setShowCashBox(true)}>{t('manageCash')}</button>
            <span className="muted" style={{ fontSize: 10 }}>{state.cashOwner ? `${t('owner')}: ${state.cashOwner}` : `${t('owner')}: —`}</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--t5)', borderColor: 'color-mix(in srgb,var(--t5) 30%,transparent)', background: 'color-mix(in srgb,var(--t5) 10%,transparent)' }}>@{t('avPrice')}</span>
          </div>
          <div className="kpi-lbl">{t('buyingPower')}</div>
          {(() => {
            const cash = num(state.cashQAR, 0);
            const refPrice = wacop || p2pAvgs.avgBuy;
            const isFallback = !wacop && !!p2pAvgs.avgBuy;
            return (
              <>
                <div className="kpi-val" style={{ color: 'var(--t5)' }}>
                  {refPrice && cash > 0
                    ? fmtU(cash / refPrice, 0) + ' USDT'
                    : cash > 0
                      ? fmtQ(cash) + ' QAR'
                      : t('setCash')}
                </div>
                <div className="kpi-sub">
                  {refPrice
                    ? `@ ${fmtP(refPrice)} QAR${isFallback ? ` ${t('mktAvg')}` : ''}`
                    : cash > 0
                      ? t('addBatchesFirst')
                      : t('addBatchesFirst')}
                </div>
              </>
            );
          })()}
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--good)', borderColor: 'color-mix(in srgb,var(--good) 30%,transparent)', background: 'color-mix(in srgb,var(--good) 10%,transparent)' }}>{t('net')}</span>
          </div>
          <div className="kpi-lbl">{t('netPosition')}</div>
          <div className="kpi-val good">{fmtQWithUnit(stCost + num(state.cashQAR, 0))}</div>
          <div className="kpi-sub">{t('stock')} {fmtQWithUnit(stCost)} + {t('cash')} {fmtQWithUnit(num(state.cashQAR, 0))}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--muted)', borderColor: 'color-mix(in srgb,var(--muted) 30%,transparent)', background: 'color-mix(in srgb,var(--muted) 10%,transparent)' }}>{state.batches.length} {t('batchSuffix')}</span>
          </div>
          <div className="kpi-lbl">{t('stockCostEst')}</div>
          <div className="kpi-val" style={{ color: 'var(--text)' }}>{fmtQWithUnit(stCost)}</div>
          <div className="kpi-sub">{t('avPrice')} {wacop ? fmtP(wacop) + ' QAR' : '—'}</div>
        </div>
      </div>

      {/* Merchant Deals KPIs */}
      {merchantDealKpis && merchantDealKpis.totalDeals > 0 && (
        <div className="kpi-band-grid" style={{ marginTop: 0 }}>
          <div className="kpi-band" style={{ borderLeft: '3px solid var(--brand)' }}>
            <div className="kpi-band-title">🤝 {t('merchantDealsOverview')}</div>
            <div className="kpi-band-cols">
              <div>
                <div className="kpi-period">{t('outgoingDeals')}</div>
                <div className="kpi-cell-val t1v">{merchantDealKpis.outCount}</div>
                <div className="kpi-cell-sub">{fmtQWithUnit(merchantDealKpis.outVol)} {t('volume')}</div>
              </div>
              <div>
                <div className="kpi-period">{t('incomingDeals')}</div>
                <div className="kpi-cell-val t1v">{merchantDealKpis.inCount}</div>
                <div className="kpi-cell-sub">{fmtQWithUnit(merchantDealKpis.inVol)} {t('volume')}</div>
              </div>
            </div>
          </div>
          <div className="kpi-band" style={{ borderLeft: '3px solid var(--good)' }}>
            <div className="kpi-band-title">{t('dealNetPnl')}</div>
            <div className="kpi-band-cols">
              <div>
                <div className="kpi-period">{t('totalDealVolume')}</div>
                <div className="kpi-cell-val t1v">{fmtQWithUnit(merchantDealKpis.totalVol)}</div>
                <div className="kpi-cell-sub">{merchantDealKpis.totalDeals} {t('totalDealsLabel')}</div>
              </div>
              <div>
                <div className="kpi-period">Merchants Net P&L</div>
                <div className={`kpi-cell-val ${merchantDealKpis.totalNet >= 0 ? 'good' : 'bad'}`}>{merchantDealKpis.totalNet >= 0 ? '+' : ''}{fmtQWithUnit(merchantDealKpis.totalNet)}</div>
                <div className="kpi-cell-sub">
                  {merchantDealKpis.pendingCount > 0 && <span style={{ color: 'var(--warn)' }}>{merchantDealKpis.pendingCount} {t('pendingDeals')}</span>}
                  {merchantDealKpis.pendingCount > 0 && merchantDealKpis.approvedCount > 0 && ' · '}
                  {merchantDealKpis.approvedCount > 0 && <span style={{ color: 'var(--good)' }}>{merchantDealKpis.approvedCount} {t('approvedStatus')}</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom panels */}
      <div className="dash-bottom">
        <div className="panel">
          <div className="panel-head"><h2>{t('profitRevenueTrend')}</h2><span className="pill">{t('last14Trades')}</span></div>
          <div className="panel-body" style={{ height: 190, position: 'relative' }}>
            {trendData.length < 2 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <span className="muted" style={{ fontSize: 11 }}>{t('needAtLeast2Trades')}</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" strokeOpacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="revenue" name={t('volume') || 'Revenue'} stroke="#6366f1" fill="url(#gRevenue)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="profit" name={t('netProfitLabel') || 'Profit'} stroke="#22c55e" fill="url(#gProfit)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>{t('periodStats')}</h2><span className="pill">{rLabel}</span></div>
          <div className="panel-body">
            <div className="prev-row"><span className="muted">{t('volume')}</span><strong className="mono t1v">{fmtQWithUnit(dR.rev)}</strong></div>
            <div className="prev-row"><span className="muted">{t('cost')}</span><strong className="mono">{fmtQWithUnit(dR.rev - dR.net - dR.fee)}</strong></div>
            <div className="prev-row"><span className="muted">{t('fees')}</span><strong className="mono">{fmtQWithUnit(dR.fee)}</strong></div>
            <div className="prev-row"><span className="muted">{t('netProfitLabel')}</span><strong className={`mono ${dR.net >= 0 ? 'good' : 'bad'}`}>{fmtQWithUnit(dR.net)}</strong></div>
            <div className="prev-row"><span className="muted">{t('avgMargin')}</span><strong className="mono" style={{ color: 'var(--t3)' }}>{fmtPct(dR.avgMgn)}</strong></div>
            <div className="prev-row"><span className="muted">{t('trades')}</span><strong className="mono">{dR.count}</strong></div>
          </div>
        </div>
      </div>

      {/* Chart panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="panel">
          <div className="panel-head"><h2>{t('netProfitPerTrade')}</h2><span className="pill muted">{t('allTime')}</span></div>
          <div className="panel-body" style={{ height: 170, position: 'relative' }}>
            {profitPerTradeData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <span className="muted" style={{ fontSize: 11 }}>{t('noTradesYet')}</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={profitPerTradeData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" strokeOpacity={0.3} vertical={false} />
                  <XAxis dataKey="idx" tick={{ fontSize: 8, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="var(--muted)" strokeOpacity={0.4} strokeDasharray="3 3" />
                  <Bar dataKey="profit" name={t('netProfitLabel') || 'Profit'} radius={[2, 2, 0, 0]} maxBarSize={12}>
                    {profitPerTradeData.map((entry, i) => (
                      <Cell key={i} fill={entry.positive ? '#22c55e' : '#ef4444'} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>{t('dailyVolumeProfit')}</h2><span className="pill muted">{t('byDay')}</span></div>
          <div className="panel-body" style={{ height: 170, position: 'relative' }}>
            {dailyData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <span className="muted" style={{ fontSize: 11 }}>{t('noTradesYet')}</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" strokeOpacity={0.3} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 8, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="volume" name={t('volume') || 'Volume'} fill="#6366f1" fillOpacity={0.5} radius={[2, 2, 0, 0]} maxBarSize={16} />
                  <Bar dataKey="profit" name={t('netProfitLabel') || 'Profit'} fill="#22c55e" fillOpacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {showCashBox && (
        <CashBoxManager
          currentCash={num(state.cashQAR, 0)}
          currentOwner={state.cashOwner || ''}
          cashHistory={state.cashHistory || []}
          onSave={handleCashSave}
          onClose={() => setShowCashBox(false)}
        />
      )}
    </div>
  );
}
