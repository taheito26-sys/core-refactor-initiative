import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { computeFIFO, fmtDate, fmtP, fmtQ, fmtU, inRange, rangeLabel, type TrackerState } from '@/lib/tracker-helpers';
import { buildDealRowModel, parseDealMeta } from '@/features/orders/utils/dealRowModel';
import { getWorkspaceDealPerspective, isDealVisibleInWorkspace } from '@/features/orders/utils/workspaceDealScope';
import '@/styles/tracker.css';

interface Props {
  userId: string;
  merchantId?: string | null;
  trackerState: TrackerState | null;
}

export function AdminOrdersMirror({ userId, merchantId, trackerState }: Props) {
  const { settings } = useTheme();
  const t = useT();
  const [activeTab, setActiveTab] = useState<'my' | 'incoming' | 'outgoing'>('my');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));

  const state = trackerState;
  const derived = useMemo(() => state ? computeFIFO(state.batches, state.trades) : null, [state]);

  const { data } = useQuery({
    queryKey: ['admin-orders-mirror', userId, merchantId],
    enabled: !!merchantId,
    queryFn: async () => {
      const relsRes = await supabase
        .from('merchant_relationships')
        .select('*')
        .eq('status', 'active')
        .or(`merchant_a_id.eq.${merchantId},merchant_b_id.eq.${merchantId}`);
      const relIds = (relsRes.data || []).map(r => r.id);
      const [dealsRes, profilesRes] = await Promise.all([
        relIds.length > 0
          ? supabase.from('merchant_deals').select('*').in('relationship_id', relIds).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null } as any),
        supabase.from('merchant_profiles').select('merchant_id, user_id, display_name, nickname, merchant_code'),
      ]);

      if (relsRes.error) throw relsRes.error;
      if (dealsRes.error) throw dealsRes.error;
      if (profilesRes.error) throw profilesRes.error;

      const profileMap = new Map((profilesRes.data || []).map(p => [p.merchant_id, p]));
      const enrichedRels = (relsRes.data || []).map(r => {
        const cpId = r.merchant_a_id === merchantId ? r.merchant_b_id : r.merchant_a_id;
        const cp = profileMap.get(cpId);
        const aProfile = profileMap.get(r.merchant_a_id);
        const bProfile = profileMap.get(r.merchant_b_id);
        return {
          ...r,
          counterparty: { display_name: cp?.display_name || cpId, nickname: cp?.nickname || '' },
          counterparty_name: cp?.display_name || cpId,
          merchant_a_user_id: aProfile?.user_id || null,
          merchant_b_user_id: bProfile?.user_id || null,
        } as any;
      });

      const workspaceRelIds = new Set((relsRes.data || []).map(r => r.id));
      const workspaceDeals = (dealsRes.data || []).filter(d => isDealVisibleInWorkspace({
        deal: d,
        workspaceMerchantId: merchantId!,
        workspaceRelationshipIds: workspaceRelIds,
      }));

      const enrichedDeals = workspaceDeals.map(d => {
        const rel = enrichedRels.find((r: any) => r.id === d.relationship_id);
        return { ...d, counterparty_name: rel?.counterparty_name || '—' } as any;
      });

      return { relationships: enrichedRels, allMerchantDeals: enrichedDeals };
    },
  });

  const relationships = data?.relationships ?? [];
  const allMerchantDeals = data?.allMerchantDeals ?? [];
  const allTrades = useMemo(() => state ? [...state.trades].sort((a, b) => b.ts - a.ts) : [], [state]);

  const cancelledDealIds = useMemo(() => new Set(
    allMerchantDeals.filter((d: any) => d.status === 'cancelled' || (d.status as string) === 'voided').map((d: any) => d.id)
  ), [allMerchantDeals]);
  const cancelledLocalTradeIds = useMemo(() => new Set(
    allMerchantDeals
      .filter((d: any) => d.status === 'cancelled' || (d.status as string) === 'voided')
      .map((d: any) => parseDealMeta(d.notes).local_trade)
      .filter(Boolean)
  ), [allMerchantDeals]);

  const visibleTrades = useMemo(() => allTrades.filter((tr) => {
    const range = state?.range || settings.range;
    if (!inRange(tr.ts, range)) return false;
    if (tr.voided || tr.approvalStatus === 'cancelled') return false;
    if (tr.linkedDealId && cancelledDealIds.has(tr.linkedDealId)) return false;
    if (cancelledLocalTradeIds.has(tr.id)) return false;
    if ((tr.approvalStatus === 'pending_approval' || tr.approvalStatus === 'approved' || tr.approvalStatus === 'rejected') && !tr.linkedDealId) {
      const matchedServerDeal = allMerchantDeals.some((d: any) => parseDealMeta(d.notes).local_trade === tr.id && d.created_by === userId && d.status !== 'cancelled' && (d.status as string) !== 'voided');
      if (!matchedServerDeal) return false;
    }
    return true;
  }), [allTrades, state?.range, settings.range, cancelledDealIds, cancelledLocalTradeIds, allMerchantDeals, userId]);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    const curMonthKey = new Date().toISOString().slice(0, 7);
    months.add(curMonthKey);
    visibleTrades.forEach(tr => {
      const d = new Date(tr.ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.add(key);
    });
    allMerchantDeals.forEach((d: any) => {
      const date = new Date(d.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      months.add(key);
    });
    return Array.from(months).sort().reverse();
  }, [visibleTrades, allMerchantDeals]);

  const subFilteredTrades = useMemo(() => {
    if (selectedMonth === 'all') return visibleTrades;
    return visibleTrades.filter(tr => {
      const d = new Date(tr.ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === selectedMonth;
    });
  }, [visibleTrades, selectedMonth]);

  const relationshipById = useMemo(() => new Map(
    relationships.map((r: any) => [r.id, { merchant_a_id: r.merchant_a_id, merchant_b_id: r.merchant_b_id }]),
  ), [relationships]);
  const merchantUserByMerchantId = useMemo(() => {
    const m = new Map<string, string>();
    for (const rel of relationships as any[]) {
      if (rel.merchant_a_id && rel.merchant_a_user_id) m.set(rel.merchant_a_id, rel.merchant_a_user_id);
      if (rel.merchant_b_id && rel.merchant_b_user_id) m.set(rel.merchant_b_id, rel.merchant_b_user_id);
    }
    return m;
  }, [relationships]);

  const workspaceScopedDeals = useMemo(() => allMerchantDeals.filter((d: any) => d.status !== 'cancelled' && (d.status as string) !== 'voided'), [allMerchantDeals]);
  const partnerMerchantDeals = useMemo(
    () => workspaceScopedDeals.filter((d: any) => getWorkspaceDealPerspective({
      deal: d,
      workspaceMerchantId: merchantId || '',
      relationshipById,
      merchantUserByMerchantId,
    }) === 'incoming'),
    [workspaceScopedDeals, merchantId, relationshipById, merchantUserByMerchantId],
  );
  const creatorMerchantDeals = useMemo(
    () => workspaceScopedDeals.filter((d: any) => getWorkspaceDealPerspective({
      deal: d,
      workspaceMerchantId: merchantId || '',
      relationshipById,
      merchantUserByMerchantId,
    }) === 'outgoing'),
    [workspaceScopedDeals, merchantId, relationshipById, merchantUserByMerchantId],
  );

  const subFilteredInDeals = useMemo(() => {
    if (selectedMonth === 'all') return partnerMerchantDeals;
    return partnerMerchantDeals.filter((d: any) => {
      const date = new Date(d.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return key === selectedMonth;
    });
  }, [partnerMerchantDeals, selectedMonth]);

  const subFilteredOutDeals = useMemo(() => {
    if (selectedMonth === 'all') return creatorMerchantDeals;
    return creatorMerchantDeals.filter((d: any) => {
      const date = new Date(d.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return key === selectedMonth;
    });
  }, [creatorMerchantDeals, selectedMonth]);

  const resolveDealAvgBuy = (deal: any, normalizedMeta?: Record<string, string>): number => {
    const meta = normalizedMeta ?? parseDealMeta(deal.notes);
    const metaAvg = Number(meta.avg_buy) || 0;
    if (metaAvg > 0) return metaAvg;
    const localTradeId = meta.local_trade;
    if (localTradeId && derived) {
      const c = derived.tradeCalc.get(localTradeId);
      if (c?.ok) return c.avgBuyQAR;
      const localTrade = state.trades.find(t => t.id === localTradeId);
      if (localTrade?.manualBuyPrice && localTrade.manualBuyPrice > 0) return localTrade.manualBuyPrice;
    }
    return 0;
  };

  const myKpi = useMemo(() => {
    let qty = 0, vol = 0, net = 0;
    for (const tr of subFilteredTrades.filter(tr => !tr.voided)) {
      const c = derived?.tradeCalc.get(tr.id);
      qty += tr.amountUSDT;
      vol += tr.amountUSDT * tr.sellPriceQAR;
      if (c?.ok) net += c.netQAR;
    }
    return { count: subFilteredTrades.length, qty, vol, net };
  }, [subFilteredTrades, derived]);

  const outKpi = useMemo(() => {
    let vol = 0, net = 0;
    for (const deal of subFilteredOutDeals) {
      const row = buildDealRowModel({ deal, perspective: 'outgoing', locale: t.isRTL ? 'ar' : 'en', resolveAvgBuy: resolveDealAvgBuy });
      vol += row.volume;
      net += row.myNet ?? 0;
    }
    return { count: subFilteredOutDeals.length, vol, net };
  }, [subFilteredOutDeals, t.isRTL]);
  const inKpi = useMemo(() => {
    let vol = 0, net = 0;
    for (const deal of subFilteredInDeals) {
      const row = buildDealRowModel({ deal, perspective: 'incoming', locale: t.isRTL ? 'ar' : 'en', resolveAvgBuy: resolveDealAvgBuy });
      vol += row.volume;
      net += row.myNet ?? 0;
    }
    return { count: subFilteredInDeals.length, vol, net };
  }, [subFilteredInDeals, t.isRTL]);

  const renderKpiBar = (kpi: { count: number; qty?: number; vol: number; net: number }) => (
    <div style={{ display: 'flex', gap: 16, padding: '8px 12px', background: 'color-mix(in srgb, var(--brand) 5%, transparent)', borderRadius: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>{t('count').toUpperCase()}</div><div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{kpi.count}</div></div>
      {kpi.qty != null && <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>USDT {t('qty').toUpperCase()}</div><div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtU(kpi.qty)}</div></div>}
      <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>{t('volume').toUpperCase()}</div><div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtQ(kpi.vol)}</div></div>
      <div><div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.5px' }}>{t('net').toUpperCase()} P&L</div><div className="mono" style={{ fontSize: 13, fontWeight: 700, color: kpi.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>{kpi.net >= 0 ? '+' : ''}{fmtQ(kpi.net)}</div></div>
    </div>
  );

  if (!state || !derived) {
    return <div className="tracker-root" style={{ padding: 12 }}><div className="empty"><div className="empty-t">No orders data.</div></div></div>;
  }

  const rLabel = rangeLabel(state.range || settings.range);

  const renderMonthSelector = () => (
    <div className="orders-tab-bar" style={{ marginBottom: 8, background: 'transparent', border: 'none', padding: 0, gap: 8, boxShadow: 'none' }}>
      <button onClick={() => setSelectedMonth('all')} className={`orders-tab-btn ${selectedMonth === 'all' ? 'active' : ''}`} style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}>
        {t('allMonths')}
      </button>
      {availableMonths.map(m => {
        const [y, mm] = m.split('-');
        const label = new Date(parseInt(y), parseInt(mm) - 1).toLocaleString(t.lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', year: '2-digit' });
        return (
          <button key={m} onClick={() => setSelectedMonth(m)} className={`orders-tab-btn ${selectedMonth === m ? 'active' : ''}`} style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}>
            {label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)', marginBottom: 2 }}>
        {(['my', 'incoming', 'outgoing'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '9px 18px', fontSize: 11, fontWeight: activeTab === tab ? 700 : 500,
              color: activeTab === tab ? 'var(--brand)' : 'var(--muted)',
              borderBottom: activeTab === tab ? '2px solid var(--brand)' : '2px solid transparent',
              background: 'transparent', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '.2px',
            }}
          >
            {tab === 'my' ? `👤 ${t('myOrders')}` : tab === 'incoming' ? `📥 ${t('incomingOrders')}` : `📤 ${t('outgoingOrders')}`}
          </button>
        ))}
      </div>

      {renderMonthSelector()}

      {activeTab === 'my' && (
        <>
          {renderKpiBar({ count: myKpi.count, qty: myKpi.qty, vol: myKpi.vol, net: myKpi.net })}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{t('trades')}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('fifoCostBasisMargin')}</div>
            </div>
            <span className="pill">{rLabel}</span>
          </div>
          {subFilteredTrades.length === 0 ? <div className="empty"><div className="empty-t">{t('noTradesYet')}</div></div> : (
            <div className="tableWrap ledgerWrap"><table><thead><tr>
              <th>{t('date')}</th><th>{t('type')}</th><th>{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r">{t('volume')}</th><th className="r">{t('net')}</th><th>{t('margin')}</th>
            </tr></thead><tbody>
              {subFilteredTrades.map((tr) => {
                const c = derived.tradeCalc.get(tr.id);
                const ok = !!c?.ok;
                const rev = tr.amountUSDT * tr.sellPriceQAR;
                const net = ok ? c!.netQAR : NaN;
                const margin = ok && rev > 0 ? c!.netQAR / rev : NaN;
                const pct = Number.isFinite(margin) ? Math.min(1, Math.abs(margin) / 0.05) : 0;
                const cn = state.customers.find(x => x.id === tr.customerId)?.name || '';
                const isMerchantLinked = !!(tr.agreementFamily || tr.linkedDealId || tr.linkedRelId);
                return (
                  <tr key={tr.id} style={isMerchantLinked ? { background: 'color-mix(in srgb, var(--brand) 4%, transparent)' } : undefined}>
                    <td><span className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(tr.ts)}</span></td>
                    <td style={{ textAlign: 'center', fontSize: 16 }}>{isMerchantLinked ? '🤝' : '👤'}</td>
                    <td>{cn ? <span className="tradeBuyerChip" title={cn} style={{ maxWidth: 130 }}>{cn}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                    <td className="mono r">{fmtU(tr.amountUSDT)}</td>
                    <td className="mono r">{ok ? fmtP(c!.avgBuyQAR) : '—'}</td>
                    <td className="mono r">{fmtP(tr.sellPriceQAR)}</td>
                    <td className="mono r">{fmtQ(rev)}</td>
                    <td className="mono r" style={{ color: Number.isFinite(net) ? (net >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)', fontWeight: 700 }}>{Number.isFinite(net) ? (net >= 0 ? '+' : '') + fmtQ(net) : '—'}</td>
                    <td><div className={`prog ${Number.isFinite(margin) && margin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(pct * 100).toFixed(0)}%` }} /></div><div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{Number.isFinite(margin) ? `${(margin * 100).toFixed(2)}% ${t('marginLabel')}` : '—'}</div></td>
                  </tr>
                );
              })}
            </tbody></table></div>
          )}
        </>
      )}

      {activeTab === 'incoming' && (
        <>
          {renderKpiBar({ count: inKpi.count, vol: inKpi.vol, net: inKpi.net })}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
            <div><div style={{ fontSize: 13, fontWeight: 800 }}>📥 {t('incomingOrders')}</div><div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('partnerTradesAwaitingApproval')}</div></div>
            <span className="pill">{subFilteredInDeals.length} {t('trades')}</span>
          </div>
          {subFilteredInDeals.length === 0 ? <div className="empty"><div className="empty-t">{t('noIncomingTrades')}</div></div> : (
            <div className="tableWrap ledgerWrap"><table><thead><tr>
              <th>{t('date')}</th><th>{t('merchant')}</th><th>{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r">{t('volume')}</th><th className="r">{t('net')}</th><th>{t('margin')}</th><th>{t('actions')}</th>
            </tr></thead><tbody>
              {subFilteredInDeals.map((deal: any) => {
                const rel = relationships.find((r: any) => r.id === deal.relationship_id) as any;
                const row = buildDealRowModel({ deal, perspective: 'incoming', locale: t.isRTL ? 'ar' : 'en', resolveAvgBuy: resolveDealAvgBuy });
                const marginPct = row.margin != null ? Math.min(1, Math.abs(row.margin) / 0.05) : 0;
                return <tr key={deal.id}>
                  <td>
                    <span className="mono" style={{ whiteSpace: 'nowrap' }}>{row.dateLabel}</span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                      <span className={`pill ${deal.status === 'approved' ? 'good' : deal.status === 'pending' ? 'warn' : ''}`} style={{ fontSize: 8 }}>{deal.status}</span>
                      <span className="pill" style={{ fontSize: 8 }}>{row.familyIcon} {row.familyLabel}</span>
                      {row.splitLabel && <span className="pill" style={{ fontSize: 8 }}>{row.splitLabel}</span>}
                    </div>
                  </td>
                  <td>{rel?.counterparty?.display_name ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{rel.counterparty.display_name}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                  <td>{row.buyer ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{row.buyer}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td>
                  <td className="mono r">{fmtU(row.quantity)}</td>
                  <td className="mono r">{row.hasAvgBuy ? fmtP(row.avgBuy) : '—'}</td>
                  <td className="mono r">{row.sellPrice > 0 ? fmtP(row.sellPrice) : '—'}</td>
                  <td className="mono r">{fmtQ(row.volume)}</td>
                  <td className="mono r">
                    {!row.hasAvgBuy ? (
                      <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>
                    ) : row.myPct != null && row.fullNet != null && row.myNet != null && row.fullNet !== row.myNet ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                        <span style={{ color: 'var(--muted)', fontSize: 9, textDecoration: 'line-through' }}>{row.fullNet >= 0 ? '+' : ''}{fmtQ(row.fullNet)}</span>
                        <span style={{ color: row.myNet >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>{row.myNet >= 0 ? '+' : ''}{fmtQ(row.myNet)} <span style={{ fontSize: 8, opacity: 0.7 }}>my cut</span></span>
                      </div>
                    ) : (
                      <span style={{ color: (row.myNet ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>{row.myNet != null && row.myNet !== 0 ? `${row.myNet >= 0 ? '+' : ''}${fmtQ(row.myNet)}` : '—'}</span>
                    )}
                  </td>
                  <td><div className={`prog ${row.margin != null && row.margin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(marginPct * 100).toFixed(0)}%` }} /></div><div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{row.margin != null && row.margin !== 0 ? `${(row.margin * 100).toFixed(2)}% ${t('marginLabel')}` : '—'}</div></td>
                  <td><span className="pill">{deal.status}</span></td>
                </tr>;
              })}
            </tbody></table></div>
          )}
        </>
      )}

      {activeTab === 'outgoing' && (
        <>
          {renderKpiBar({ count: outKpi.count, vol: outKpi.vol, net: outKpi.net })}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
            <div><div style={{ fontSize: 13, fontWeight: 800 }}>📤 {t('outgoingOrders')}</div><div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('yourMerchantLinkedTrades')}</div></div>
            <span className="pill">{subFilteredOutDeals.length} {t('trades')}</span>
          </div>
          {subFilteredOutDeals.length === 0 ? <div className="empty"><div className="empty-t">{t('noOutgoingTrades')}</div></div> : (
            <div className="tableWrap ledgerWrap"><table><thead><tr>
              <th>{t('date')}</th><th>{t('merchant')}</th><th>{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r">{t('volume')}</th><th className="r">{t('net')}</th><th>{t('margin')}</th><th>{t('actions')}</th>
            </tr></thead><tbody>
              {subFilteredOutDeals.map((deal: any) => {
                const rel = relationships.find((r: any) => r.id === deal.relationship_id) as any;
                const row = buildDealRowModel({ deal, perspective: 'outgoing', locale: t.isRTL ? 'ar' : 'en', resolveAvgBuy: resolveDealAvgBuy });
                const marginPct = row.margin != null ? Math.min(1, Math.abs(row.margin) / 0.05) : 0;
                return <tr key={deal.id}><td><span className="mono">{row.dateLabel}</span><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}><span className={`pill ${deal.status === 'approved' ? 'good' : deal.status === 'pending' ? 'warn' : ''}`} style={{ fontSize: 8 }}>{deal.status}</span><span className="pill" style={{ fontSize: 8 }}>{row.familyIcon} {row.familyLabel}</span>{row.splitLabel && <span className="pill" style={{ fontSize: 8 }}>{row.splitLabel}</span>}</div></td><td>{rel?.counterparty?.display_name ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{rel.counterparty.display_name}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td><td>{row.buyer ? <span className="tradeBuyerChip" style={{ maxWidth: 130 }}>{row.buyer}</span> : <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span>}</td><td className="mono r">{fmtU(row.quantity)}</td><td className="mono r">{row.hasAvgBuy ? fmtP(row.avgBuy) : '—'}</td><td className="mono r">{row.sellPrice > 0 ? fmtP(row.sellPrice) : '—'}</td><td className="mono r">{fmtQ(row.volume)}</td><td className="mono r">{!row.hasAvgBuy ? <span style={{ color: 'var(--muted)', fontSize: 9 }}>—</span> : row.myPct != null && row.fullNet != null && row.myNet != null && row.fullNet !== row.myNet ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}><span style={{ color: 'var(--muted)', fontSize: 9, textDecoration: 'line-through' }}>{row.fullNet >= 0 ? '+' : ''}{fmtQ(row.fullNet)}</span><span style={{ color: row.myNet >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>{row.myNet >= 0 ? '+' : ''}{fmtQ(row.myNet)} <span style={{ fontSize: 8, opacity: 0.7 }}>my cut</span></span></div> : <span style={{ color: (row.myNet ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>{row.myNet != null && row.myNet !== 0 ? `${row.myNet >= 0 ? '+' : ''}${fmtQ(row.myNet)}` : '—'}</span>}</td><td><div className={`prog ${row.margin != null && row.margin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(marginPct * 100).toFixed(0)}%` }} /></div><div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{row.margin != null && row.margin !== 0 ? `${(row.margin * 100).toFixed(2)}% ${t('marginLabel')}` : '—'}</div></td><td><span className="pill">{deal.status}</span></td></tr>;
              })}
            </tbody></table></div>
          )}
        </>
      )}
    </div>
  );
}
