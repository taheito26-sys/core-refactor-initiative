import { useMemo, type ComponentProps } from 'react';
import { Layers, LayoutDashboard, Target, type LucideIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { MerchantHero, ThMain, ThRoot, ThTiles, type ThTile } from '@/features/taheito/kit';
import { calendarMonthComparison, pctChange } from '../../dashboard-model';
import { DashboardHome, type HomeTile } from './DashboardHome';

type Props = Omit<ComponentProps<typeof DashboardHome>, 'bare'>;

const CLASSES = ['t1', 't2', 't3', 't4'];

/** The merchant dashboard in the Taheito look: figures edge to edge in one card, the cards beneath in a dense grid. */
export function TaheitoDashboard(props: Props) {
  const t = useT();
  const lang = props.lang;
  const { points, now, tiles, moreTiles, parts, onGo, isAdminView } = props;

  const monthly = useMemo(() => calendarMonthComparison(points, now), [points, now]);
  const net = monthly.cur.net;
  const netPct = pctChange(net, monthly.prev?.net);

  const toTile = (tile: HomeTile, i: number): ThTile => {
    const bad = tile.valueTone === 'bad';
    return {
      key: tile.key, cls: CLASSES[i % CLASSES.length], icon: tile.Icon as LucideIcon, label: tile.label, value: tile.value, unit: tile.unit,
      tone: bad ? 'bad' : tile.valueTone === 'good' ? 'good' : undefined,
      onClick: tile.path && !isAdminView ? () => onGo(tile.path as string) : undefined,
    };
  };
  const headline: ThTile[] = [
    { key: 'month-volume', cls: 't3', icon: Layers, label: t('dhTotalVolume'), value: parts(monthly.cur.vol).n, unit: parts(monthly.cur.vol).u },
    { key: 'month-net', cls: 't4', icon: Target, label: t('dhMyNetProfit'), value: parts(net).n, unit: parts(net).u, tone: net < 0 ? 'bad' : 'good' },
    ...tiles.map((x, i) => toTile(x, i)),
  ];

  return (
    <ThRoot lang={lang} className="th-dash">
      <MerchantHero
        lang={lang} icon={<LayoutDashboard className="co-ttl-ic" strokeWidth={1.7} />} title={t('dashboard')} subtitle={t('thDashSub')}
        trendDown={net < 0} trendTitle={`${parts(net).n} ${parts(net).u}`}
        trendText={netPct == null ? t('dhMyNetProfit') : `${netPct >= 0 ? '+' : ''}${netPct.toFixed(1)}% · ${t('dhMyNetProfit')}`}
      />
      <ThMain label={t('dashboard')}>
        <ThTiles tiles={headline} />
        <ThTiles tiles={moreTiles.map((x, i) => toTile(x, i + 2))} />
      </ThMain>
      <div className="th-dash-body">
        <DashboardHome {...props} bare />
      </div>
    </ThRoot>
  );
}
