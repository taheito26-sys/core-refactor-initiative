import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { computeFIFO, fmtDate, fmtP, fmtQ, fmtU, inRange, rangeLabel, type TrackerState } from '@/lib/tracker-helpers';
import '@/styles/tracker.css';

interface Props {
  userId: string;
  merchantId?: string | null;
  trackerState: TrackerState | null;
}

function parseDealMeta(notes: string | null | undefined): Record<string, string> {
  if (!notes) return {};
  const meta: Record<string, string> = {};
  notes.split('|').forEach(seg => {
    const idx = seg.indexOf(':');
    if (idx > 0) meta[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim();
  });
  // Normalise legacy aliases
  if (!meta.quantity && meta.qty) meta.quantity = meta.qty;
  if (!meta.sell_price && meta.sell) meta.sell_price = meta.sell;
  return meta;
}

export function AdminOrdersMirror({ userId, merchantId, trackerState }: Props) {
  const { settings } = useTheme();
  const t = useT();
  const [activeTab, setActiveTab] = useState<'my' | 'incoming' | 'outgoing'>('my');

  const state = trackerState;
  const derived = useMemo(() => state ? computeFIFO(state.batches, state.trades) : null, [state]);

  const { data } = useQuery({
    queryKey: ['admin-orders-mirror', userId, merchantId],
    enabled: !!merchantId,
    queryFn: async () => {
      const [relsRes, dealsRes, profilesRes] = await Promise.all([
        supabase
          .from('merchant_relationships')
          .select('*')
          .eq('status', 'active')
          .or(`merchant_a_id.eq.${merchantId},merchant_b_id.eq.${merchantId}`),
        supabase.from('merchant_deals').select('*').order('created_at', { ascending: false }),
        supabase.from('merchant_profiles').select('merchant_id, display_name, nickname, merchant_code'),
      ]);

      if (relsRes.error) throw relsRes.error;
      if (dealsRes.error) throw dealsRes.error;
      if (profilesRes.error) throw profilesRes.error;

      const profileMap = new Map((profilesRes.data || []).map(p => [p.merchant_id, p]));
      const enrichedRels = (relsRes.data || []).map(r => {
        const cpId = r.merchant_a_id === merchantId ? r.merchant_b_id : r.merchant_a_id;
        const cp = profileMap.get(cpId);
        return {
          ...r,
          counterparty: { display_name: cp?.display_name || cpId, nickname: cp?.nickname || '' },
          counterparty_name: cp?.display_name || cpId,
        } as any;
      });

      const enrichedDeals = (dealsRes.data || []).map(d => {
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

  const partnerMerchantDeals = useMemo(
    () => allMerchantDeals.filter((d: any) => d.created_by !== userId && d.status !== 'cancelled' && (d.status as string) !== 'voided'),
    [allMerchantDeals, userId],
  );
  const creatorMerchantDeals = useMemo(
    () => allMerchantDeals.filter((d: any) => d.created_by === userId && d.status !== 'cancelled' && (d.status as string) !== 'voided'),
    [allMerchantDeals, userId],
  );

  const myKpi = useMemo(() => {
    let qty = 0, vol = 0, net = 0;
    for (const tr of visibleTrades.filter(tr => !tr.voided)) {
      const c = derived?.tradeCalc.get(tr.id);
      qty += tr.amountUSDT;
      vol += tr.amountUSDT * tr.sellPriceQAR;
      if (c?.ok) net += c.netQAR;
    }
    return { count: visibleTrades.length, qty, vol, net };
  }, [visibleTrades, derived]);

  const outKpi = useMemo(() => ({ count: creatorMerchantDeals.length, vol: creatorMerchantDeals.reduce((s: number, d: any) => s + Number(d.amount || 0), 0), net: 0 }), [creatorMerchantDeals]);
  const inKpi = useMemo(() => ({ count: partnerMerchantDeals.length, vol: partnerMerchantDeals.reduce((s: number, d: any) => s + Number(d.amount || 0), 0), net: 0 }), [partnerMerchantDeals]);

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
          {visibleTrades.length === 0 ? <div className="empty"><div className="empty-t">{t('noTradesYet')}</div></div> : (
            <div className="tableWrap ledgerWrap"><table><thead><tr>
              <th>{t('date')}</th><th>{t('type')}</th><th>{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r">{t('volume')}</th><th className="r">{t('net')}</th><th>{t('margin')}</th>
            </tr></thead><tbody>
              {visibleTrades.map((tr) => {
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
            <span className="pill">{partnerMerchantDeals.length} {t('trades')}</span>
          </div>
          {partnerMerchantDeals.length === 0 ? <div className="empty"><div className="empty-t">{t('noIncomingTrades')}</div></div> : (
            <div className="tableWrap ledgerWrap"><table><thead><tr>
              <th>{t('date')}</th><th>{t('merchant')}</th><th>{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r">{t('volume')}</th><th className="r">{t('net')}</th><th>{t('margin')}</th><th>{t('actions')}</th>
            </tr></thead><tbody>
              {partnerMerchantDeals.map((deal: any) => {
                const rel = relationships.find((r: any) => r.id === deal.relationship_id) as any;
                const meta = parseDealMeta(deal.notes);
                const dealQty = Number(meta.quantity) || deal.amount || 0;
                const dealSell = Number(meta.sell_price) || 0;
                const dealAvgBuy = Number(meta.avg_buy) || 0;
                const dealVol = dealQty * (dealSell || 1);
                const dealFee = Number(meta.fee) || 0;
                const dealCost = dealAvgBuy > 0 ? dealQty * dealAvgBuy : 0;
                const hasAvgBuy = dealAvgBuy > 0;
                const fullNet = hasAvgBuy && dealSell > 0 ? dealVol - dealCost - dealFee : 0;
                const dealMargin = hasAvgBuy && dealVol > 0 ? fullNet / dealVol : 0;
                const marginPct = hasAvgBuy && Number.isFinite(dealMargin) ? Math.min(1, Math.abs(dealMargin) / 0.05) : 0;
                const customerName = meta.customer || '';
                const familyLabel = deal.deal_type === 'arbitrage' ? '📊 Sales Deal' : deal.deal_type === 'partnership' ? '🤝 Partnership' : deal.deal_type === 'capital_transfer' ? '💰 Capital' : deal.deal_type || '';
                const partnerRatio = meta.partner_ratio || meta.counterparty_share || '';
                const merchantRatio = meta.merchant_ratio || meta.merchant_share || '';
                const splitLabel = partnerRatio && merchantRatio ? `${partnerRatio}%/${merchantRatio}%` : '';
                return <tr key={deal.id}>
                  <td>
                    <span className="mono" style={{ whiteSpace: 'nowrap' }}>{deal.created_at ? new Date(deal.created_at).toLocaleDateString() : '—'}</span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                      <span className={`pill ${deal.status === 'approved' ? 'good' : deal.status === 'pending' ? 'warn' : ''}`} style={{ fontSize: 8 }}>{deal.status}</span>
                      {familyLabel && <span className="pill" style={{ fontSize: 8 }}>{familyLabel}</span>}
                      {splitLabel && <span className="pill" style={{ fontSize: 8 }}>{splitLabel}</span>}
                    </div>
                  </td>
                  <td>{rel?.counterparty?.display_name || '—'}</td>
                  <td>{customerName || '—'}</td>
                  <td className="mono r">{fmtU(dealQty)}</td>
                  <td className="mono r">{hasAvgBuy ? fmtP(dealAvgBuy) : '—'}</td>
                  <td className="mono r">{dealSell > 0 ? fmtP(dealSell) : '—'}</td>
                  <td className="mono r">{fmtQ(dealVol)}</td>
                  <td className="mono r" style={{ color: hasAvgBuy ? (fullNet >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)', fontWeight: 700 }}>{hasAvgBuy ? `${fullNet >= 0 ? '+' : ''}${fmtQ(fullNet)}` : '—'}</td>
                  <td>{hasAvgBuy ? <><div className={`prog ${dealMargin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(marginPct * 100).toFixed(0)}%` }} /></div><div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{(dealMargin * 100).toFixed(2)}%</div></> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
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
            <span className="pill">{creatorMerchantDeals.length} {t('trades')}</span>
          </div>
          {creatorMerchantDeals.length === 0 ? <div className="empty"><div className="empty-t">{t('noOutgoingTrades')}</div></div> : (
            <div className="tableWrap ledgerWrap"><table><thead><tr>
              <th>{t('date')}</th><th>{t('merchant')}</th><th>{t('buyer')}</th><th className="r">{t('qty')}</th><th className="r">{t('avgBuy')}</th><th className="r">{t('sell')}</th><th className="r">{t('volume')}</th><th className="r">{t('net')}</th><th>{t('margin')}</th><th>{t('actions')}</th>
            </tr></thead><tbody>
              {creatorMerchantDeals.map((deal: any) => {
                const rel = relationships.find((r: any) => r.id === deal.relationship_id) as any;
                const meta = parseDealMeta(deal.notes);
                const dealQty = Number(meta.quantity) || deal.amount || 0;
                const dealSell = Number(meta.sell_price) || 0;
                const dealAvgBuy = Number(meta.avg_buy) || 0;
                const dealVol = dealQty * (dealSell || 1);
                const dealFee = Number(meta.fee) || 0;
                const dealCost = dealAvgBuy > 0 ? dealQty * dealAvgBuy : 0;
                const hasAvgBuy = dealAvgBuy > 0;
                const fullNet = hasAvgBuy && dealSell > 0 ? dealVol - dealCost - dealFee : 0;
                const dealMargin = hasAvgBuy && dealVol > 0 ? fullNet / dealVol : 0;
                const marginPct = hasAvgBuy && Number.isFinite(dealMargin) ? Math.min(1, Math.abs(dealMargin) / 0.05) : 0;
                const customerName = meta.customer || '';
                return <tr key={deal.id}><td><span className="mono">{deal.created_at ? new Date(deal.created_at).toLocaleDateString() : '—'}</span></td><td>{rel?.counterparty?.display_name || '—'}</td><td>{customerName || '—'}</td><td className="mono r">{fmtU(dealQty)}</td><td className="mono r">{hasAvgBuy ? fmtP(dealAvgBuy) : '—'}</td><td className="mono r">{dealSell > 0 ? fmtP(dealSell) : '—'}</td><td className="mono r">{fmtQ(dealVol)}</td><td className="mono r" style={{ color: hasAvgBuy ? (fullNet >= 0 ? 'var(--good)' : 'var(--bad)') : 'var(--muted)', fontWeight: 700 }}>{hasAvgBuy ? `${fullNet >= 0 ? '+' : ''}${fmtQ(fullNet)}` : '—'}</td><td>{hasAvgBuy ? <><div className={`prog ${dealMargin < 0 ? 'neg' : ''}`} style={{ maxWidth: 90 }}><span style={{ width: `${(marginPct * 100).toFixed(0)}%` }} /></div><div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{(dealMargin * 100).toFixed(2)}%</div></> : <span style={{ color: 'var(--muted)' }}>—</span>}</td><td><span className="pill">{deal.status}</span></td></tr>;
              })}
            </tbody></table></div>
          )}
        </>
      )}
    </div>
  );
}
