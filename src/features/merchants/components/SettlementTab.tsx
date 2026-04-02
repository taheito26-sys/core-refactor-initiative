import { useState, useEffect, useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { useSettlementPeriods, useSyncSettlementPeriods, type SettlementPeriod } from '@/hooks/useSettlementPeriods';
import { useDealCapital, useReinvestProfit, usePayoutProfit } from '@/hooks/useDealCapital';
import { fmtU, fmtQWithUnit, getWACOP } from '@/lib/tracker-helpers';
import { toast } from 'sonner';
import type { Cadence } from '@/lib/settlement-periods';
import { DecisionCard } from './DecisionCard';
import { useTheme } from '@/lib/theme-context';
import { useTrackerState } from '@/lib/useTrackerState';
import '@/styles/tracker.css';

interface DealInfo {
  id: string;
  title: string;
  deal_type: string;
  settlement_cadence: string;
  amount: number;
  created_at: string;
}

interface Props {
  relationshipId: string;
  deals: DealInfo[];
  isPartner: boolean;
  trades: Array<{
    id: string;
    ts: number;
    linkedDealId?: string;
    amountUSDT: number;
    sellPriceQAR: number;
    feeQAR: number;
    voided: boolean;
  }>;
  tradeCalc: Map<string, any>;
}

function PeriodCard({ period, dealAmount, relationshipId, isPartner, dealType, wacop }: {
  period: SettlementPeriod;
  dealAmount: number;
  relationshipId: string;
  isPartner: boolean;
  dealType: string;
  wacop: number | null;
}) {
  const t = useT();
  const { settings } = useTheme();
  const { data: capital } = useDealCapital(period.deal_id, dealAmount);
  const reinvest = useReinvestProfit();
  const payout = usePayoutProfit();

  const statusCls = period.status === 'settled' ? 'good'
    : period.status === 'overdue' ? 'bad'
    : period.status === 'due' ? 'warn'
    : '';

  const poolBalance = capital?.reinvestedPool || 0;

  const handlePayout = async () => {
    if (period.partner_amount <= 0) return;
    try {
      await payout.mutateAsync({
        deal_id: period.deal_id,
        relationship_id: relationshipId,
        period_id: period.id,
        amount: period.partner_amount,
        currency: 'USDT',
        current_pool_balance: poolBalance,
      });
      toast.success(t('paidOutToPartner'));
    } catch (err: any) { toast.error(err.message); }
  };

  const handleReinvest = async () => {
    if (period.partner_amount <= 0) return;
    try {
      await reinvest.mutateAsync({
        deal_id: period.deal_id,
        relationship_id: relationshipId,
        period_id: period.id,
        amount: period.partner_amount,
        currency: 'USDT',
        current_pool_balance: poolBalance,
      });
      toast.success(t('reinvestedToPool'));
    } catch (err: any) { toast.error(err.message); }
  };

  const showActions = (period.status === 'due' || period.status === 'overdue') && period.partner_amount > 0;

  const renderActions = () => {
    if (!showActions) return null;

    if (dealType === 'arbitrage') {
      if (!isPartner) {
        return (
          <button className="btn" onClick={handlePayout} disabled={payout.isPending} style={{ fontSize: 10 }}>
            💰 {t('settleAmount')} {fmtQWithUnit(period.partner_amount, settings.currency, wacop)}
          </button>
        );
      }
      return (
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
          {t('waitingForMerchantToSettle')}
        </div>
      );
    }

    if (dealType === 'partnership') {
      if (isPartner) {
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={handlePayout} disabled={payout.isPending} style={{ fontSize: 10 }}>
              💰 {t('takeProfit')} {fmtQWithUnit(period.partner_amount, settings.currency, wacop)}
            </button>
            <button className="btn" onClick={handleReinvest} disabled={reinvest.isPending} style={{ fontSize: 10 }}>
              🔄 {t('addToCapital')} {fmtQWithUnit(period.partner_amount, settings.currency, wacop)}
            </button>
          </div>
        );
      }
      return (
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
          {t('waitingForLenderDecision')}
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn" onClick={handlePayout} disabled={payout.isPending} style={{ fontSize: 10 }}>
          💰 {t('payOut')} {fmtQWithUnit(period.partner_amount, settings.currency, wacop)}
        </button>
        <button className="btn" onClick={handleReinvest} disabled={reinvest.isPending} style={{ fontSize: 10 }}>
          🔄 {t('reinvest')} {fmtQWithUnit(period.partner_amount, settings.currency, wacop)}
        </button>
      </div>
    );
  };

  return (
    <div className="panel" style={{ padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700 }}>{period.deal_title || '—'}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            {period.period_key} · {period.cadence === 'per_order' ? t('perTrade') : period.cadence === 'weekly' ? t('weekly') : t('monthly')}
          </div>
        </div>
        <span className={`pill ${statusCls}`}>
          {period.status === 'overdue' && '⚠️ '}{period.status}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 10, marginBottom: 8 }}>
        <div><span className="muted">{t('periodTrades')}:</span> <span className="mono">{period.trade_count}</span></div>
        <div><span className="muted">{t('periodVolume')}:</span> <span className="mono">{fmtQWithUnit(period.gross_volume, settings.currency, wacop)}</span></div>
        <div><span className="muted">{t('periodProfit')}:</span> <span className="mono" style={{ color: period.net_profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>{fmtQWithUnit(period.net_profit, settings.currency, wacop)}</span></div>
      </div>

      {capital && (
        <div style={{ display: 'flex', gap: 16, fontSize: 10, marginBottom: 8, color: 'var(--muted)' }}>
          <div>{t('originalPrincipal')}: <span className="mono">{fmtQWithUnit(capital.originalPrincipal, settings.currency, wacop)}</span></div>
          <div>{t('reinvestedPool')}: <span className="mono">{fmtQWithUnit(capital.reinvestedPool, settings.currency, wacop)}</span></div>
          <div>{t('workingCapital')}: <span className="mono" style={{ fontWeight: 700, color: 'var(--fg)' }}>{fmtQWithUnit(capital.workingCapital, settings.currency, wacop)}</span></div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, fontSize: 10, marginBottom: 8 }}>
        <div>{t('partnerShare')}: <span className="mono" style={{ fontWeight: 700 }}>{fmtQWithUnit(period.partner_amount, settings.currency, wacop)}</span></div>
        <div>{t('merchantShareDist')}: <span className="mono">{fmtQWithUnit(period.merchant_amount, settings.currency, wacop)}</span></div>
      </div>

      {period.status === 'settled' ? (
        <div style={{ fontSize: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pill good">
            {period.resolution === 'payout' ? '💰 ' + t('paidOutToPartner') : '🔄 ' + t('reinvestedToPool')}
          </span>
          <span className="mono" style={{ color: 'var(--good)' }}>{fmtQWithUnit(period.settled_amount, settings.currency, wacop)}</span>
        </div>
      ) : (
        renderActions()
      )}

      {period.status === 'overdue' && (
        <div style={{ fontSize: 9, color: 'var(--bad)', marginTop: 4 }}>⚠️ {t('graceExpired')}</div>
      )}

      {dealType === 'partnership' && (period.status === 'due' || period.status === 'overdue' || period.status === 'settled') && (
        <DecisionCard periodId={period.id} periodKey={period.period_key} />
      )}
    </div>
  );
}

export function SettlementTab({ relationshipId, deals, isPartner, trades, tradeCalc }: Props) {
  const t = useT();
  const { settings } = useTheme();
  const { data: periods, isLoading } = useSettlementPeriods(relationshipId);
  const syncPeriods = useSyncSettlementPeriods(relationshipId);
  const [filterDealId, setFilterDealId] = useState<string>('all');

  const { derived } = useTrackerState({});
  const wacop = useMemo(() => getWACOP(derived), [derived]);

  useEffect(() => {
    if (deals.length > 0) {
      syncPeriods.mutate({
        deals: deals.map(d => ({
          id: d.id,
          settlement_cadence: (d.settlement_cadence || 'monthly') as Cadence,
          created_at: d.created_at,
        })),
        trades,
        tradeCalc,
      });
    }
  }, [deals.length]);

  const filtered = (periods || []).filter(p =>
    filterDealId === 'all' || p.deal_id === filterDealId
  );

  const dueCount = filtered.filter(p => p.status === 'due').length;
  const overdueCount = filtered.filter(p => p.status === 'overdue').length;
  const settledCount = filtered.filter(p => p.status === 'settled').length;
  const totalSettled = filtered.filter(p => p.status === 'settled').reduce((s, p) => s + Number(p.settled_amount), 0);

  const dealAmountMap = new Map(deals.map(d => [d.id, d.amount]));
  const dealTypeMap = new Map(deals.map(d => [d.id, d.deal_type]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="kpi-band">
        <div className="kpi-band-title">{t('settlementTracker')}</div>
        <div className="kpi-band-cols">
          <div>
            <div className="kpi-period">{t('dueNow')}</div>
            <div className="kpi-cell-val" style={{ color: dueCount > 0 ? 'var(--warn-text, orange)' : 'var(--muted)' }}>{dueCount}</div>
          </div>
          <div>
            <div className="kpi-period">{t('overdueSettlement')}</div>
            <div className="kpi-cell-val" style={{ color: overdueCount > 0 ? 'var(--bad)' : 'var(--muted)' }}>{overdueCount}</div>
          </div>
          <div>
            <div className="kpi-period">{t('settled')}</div>
            <div className="kpi-cell-val">{settledCount}</div>
          </div>
          <div>
            <div className="kpi-period">{t('totalSettled')}</div>
            <div className="kpi-cell-val" style={{ color: 'var(--good)' }}>{fmtQWithUnit(totalSettled, settings.currency, wacop)}</div>
          </div>
        </div>
      </div>

      {deals.length > 1 && (
        <select
          value={filterDealId}
          onChange={e => setFilterDealId(e.target.value)}
          className="w-full p-2 text-xs border rounded bg-background text-foreground"
          style={{ maxWidth: 300 }}
        >
          <option value="all">{t('allDeals') || 'All Deals'}</option>
          {deals.map(d => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
      )}

      {isLoading ? (
        <div className="empty"><div className="empty-t">{t('loading') || '...'}</div></div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-t">{t('noDeals')}</div>
          <div className="empty-s">{t('createDealsFromWorkspace')}</div>
        </div>
      ) : (
        filtered.map(p => (
          <PeriodCard
            key={p.id}
            period={p}
            dealAmount={dealAmountMap.get(p.deal_id) || 0}
            relationshipId={relationshipId}
            isPartner={isPartner}
            dealType={dealTypeMap.get(p.deal_id) || p.deal_type || 'partnership'}
            wacop={wacop}
          />
        ))
      )}
    </div>
  );
}