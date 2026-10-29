import { useT } from '@/lib/i18n';
import { fmtU } from '@/lib/tracker-helpers';
import '@/styles/batch-consumption.css';

/** FIFO quantities, shown without opening a batch's details. */
export function BatchConsumption({ initial, remaining }: { initial: number; remaining: number }) {
  const t = useT();
  const total = Number.isFinite(initial) ? Math.max(0, initial) : 0;
  const left = Number.isFinite(remaining) ? Math.max(0, Math.min(total, remaining)) : total;
  const used = Math.max(0, total - left);
  const percent = total > 0 ? used / total * 100 : 0;
  const description = `${t('batchConsumedQty')}: ${fmtU(used)} USDT · ${t('remaining')}: ${fmtU(left)} USDT`;
  return <span className="batch-consumption" title={description}>
    <span className="batch-consumption-values" aria-hidden="true"><span className="batch-consumption-used">{t('usedLabel')} <b>{fmtU(used)}</b></span><span className="batch-consumption-left">{t('rem')} <b>{fmtU(left)}</b></span></span>
    <span className="batch-consumption-track" data-empty={total === 0} role="progressbar" aria-label={t('usage')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(percent.toFixed(2))} aria-valuetext={description}>
      <span className="batch-consumption-fill" style={{ width: `${percent}%` }} />
    </span>
  </span>;
}
