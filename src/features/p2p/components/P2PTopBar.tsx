import { Menu, Search, SlidersHorizontal } from 'lucide-react';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import ActivityCenter from '@/components/notifications/ActivityCenter';

export function P2PTopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { settings, update } = useTheme();
  const t = useT();
  return <header className="pm-topbar app-topbar">
    <button type="button" onClick={onMenuClick} aria-label={t('pmMenu')}><Menu /></button>
    <ActivityCenter compact />
    <div className="pm-topbar-range">{(['today', '7d', 'this_month', 'all'] as const).map((range, index) => <button type="button" key={range} aria-pressed={settings.range === range} onClick={() => update({ range })}>{['1D', '7D', '30D', 'ALL'][index]}</button>)}</div>
    <div className="pm-topbar-currency">{(['QAR', 'USDT'] as const).map(currency => <button type="button" key={currency} aria-pressed={settings.currency === currency} onClick={() => update({ currency, ...(currency === 'QAR' ? { baseFiatCurrency: currency } : {}) })}>{currency}</button>)}</div>
    <div className="pm-topbar-language">{(['ar', 'en'] as const).map(language => <button type="button" key={language} aria-pressed={settings.language === language} onClick={() => update({ language })}>{language.toUpperCase()}</button>)}</div>
    <button type="button" aria-label={t('pmSearch')} onClick={() => window.dispatchEvent(new Event('p2p-search'))}><Search /></button>
    <button type="button" aria-label={t('pmFilters')} onClick={() => window.dispatchEvent(new Event('p2p-filters'))}><SlidersHorizontal /></button>
  </header>;
}
