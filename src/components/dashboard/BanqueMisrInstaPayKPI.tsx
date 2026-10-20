import { useBanqueMisrRate } from '@/features/dashboard/hooks/useBanqueMisrRate';

export function BanqueMisrInstaPayKPI() {
  const { kpi, loading } = useBanqueMisrRate();

  return (
    <div className="kpi-card">
      <div className="kpi-lbl">QAR/EGP</div>
      <div className="kpi-val">
        {loading ? '…' : kpi ? kpi.instaPayV1BanqueMisr.toFixed(4) : '—'}
      </div>
      <div className="kpi-sub">
        {kpi ? `Banque Misr · top ${kpi.offerCount} sell avg ${kpi.egSellBanqueMisrAvg.toFixed(3)} EGP` : 'No data available'}
      </div>
    </div>
  );
}
