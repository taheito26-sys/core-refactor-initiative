import { useT } from '@/lib/i18n';
import { fmtU } from '@/lib/tracker-helpers';
import { useProfitDistribution } from '@/hooks/useProfitDistribution';
import { getAgreementFamilyLabel } from '@/lib/deal-templates';
import '@/styles/tracker.css';

interface Props {
  relationshipId: string;
}

export function ProfitDistributionPanel({ relationshipId }: Props) {
  const t = useT();
  const { data: dist, isLoading } = useProfitDistribution(relationshipId);

  if (isLoading) {
    return <div className="empty"><div className="empty-t">{t('loading') || 'Loading...'}</div></div>;
  }

  if (!dist || dist.deals.length === 0) {
    return (
      <div className="empty">
        <div className="empty-t">{t('noDeals')}</div>
        <div className="empty-s">{t('createDealsFromWorkspace')}</div>
      </div>
    );
  }

  const { summary } = dist;
  const netColor = summary.netOutstanding > 0 ? 'var(--bad)' : summary.netOutstanding < 0 ? 'var(--good)' : 'var(--muted)';
  const netLabel = summary.netOutstanding > 0
    ? t('youOwePartner')
    : summary.netOutstanding < 0
    ? t('partnerOwesYou')
    : t('allSettled');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Summary KPI */}
      <div className="kpi-band">
        <div className="kpi-band-title">{t('profitDistribution')}</div>
        <div className="kpi-band-cols">
          <div>
            <div className="kpi-period">{t('partnerShare')}</div>
            <div className="kpi-cell-val">{fmtU(summary.totalPartnerOwed)}</div>
          </div>
          <div>
            <div className="kpi-period">{t('merchantShareDist')}</div>
            <div className="kpi-cell-val">{fmtU(summary.totalMerchantOwed)}</div>
          </div>
          <div>
            <div className="kpi-period">{t('totalSettled')}</div>
            <div className="kpi-cell-val" style={{ color: 'var(--good)' }}>{fmtU(summary.totalSettled)}</div>
          </div>
          <div>
            <div className="kpi-period">{t('netOutstanding')}</div>
            <div className="kpi-cell-val" style={{ color: netColor, fontWeight: 800 }}>
              {fmtU(Math.abs(summary.netOutstanding))}
            </div>
            <div style={{ fontSize: 9, color: netColor }}>{netLabel}</div>
          </div>
        </div>
      </div>

      {/* Deal breakdown table */}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>{t('title') || 'Title'}</th>
              <th>{t('type') || 'Type'}</th>
              <th>{t('allocationBaseDist')}</th>
              <th className="r">{t('partnerShare')} %</th>
              <th className="r">{t('volume') || 'Volume'}</th>
              <th className="r">{t('partnerShare')}</th>
              <th className="r">{t('totalSettled')}</th>
              <th className="r">{t('outstanding')}</th>
            </tr>
          </thead>
          <tbody>
            {dist.deals.map(d => {
              const family = getAgreementFamilyLabel(d.dealType, t.lang as 'en' | 'ar');
              const outColor = d.partnerOutstanding > 0 ? 'var(--bad)' : d.partnerOutstanding < 0 ? 'var(--good)' : 'var(--muted)';
              return (
                <tr key={d.dealId}>
                  <td style={{ fontWeight: 700, fontSize: 11 }}>{d.dealTitle}</td>
                  <td><span className="pill">{family.icon} {family.label}</span></td>
                  <td style={{ fontSize: 10 }}>
                    {d.allocationBase === 'net_profit' ? t('netProfit') : t('saleEconomicsDist')}
                  </td>
                  <td className="mono r">{d.partnerPct}%</td>
                  <td className="mono r">{fmtU(d.totalOrderVolume)}</td>
                  <td className="mono r">{fmtU(d.partnerOwed)}</td>
                  <td className="mono r" style={{ color: 'var(--good)' }}>{fmtU(d.totalSettled)}</td>
                  <td className="mono r" style={{ color: outColor, fontWeight: 700 }}>
                    {d.partnerOutstanding >= 0 ? '' : '−'}{fmtU(Math.abs(d.partnerOutstanding))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 800 }}>
              <td colSpan={5} style={{ textAlign: 'right' }}>{t('total') || 'Total'}</td>
              <td className="mono r">{fmtU(summary.totalPartnerOwed)}</td>
              <td className="mono r" style={{ color: 'var(--good)' }}>{fmtU(summary.totalSettled)}</td>
              <td className="mono r" style={{ color: netColor }}>
                {summary.netOutstanding >= 0 ? '' : '−'}{fmtU(Math.abs(summary.netOutstanding))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}