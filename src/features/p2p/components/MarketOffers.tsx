import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DeepScanResults } from './DeepScanResults';
import { MARKETS, type MarketId, type MarketConfig, type P2POffer } from '../types';
import { DEFAULT_OFFER_FILTERS, filterMarketOffers, type OfferFilters } from '../market-view';

export function MarketOffers({ offers, side, market, onMarketChange }: { offers: P2POffer[]; side: 'buy' | 'sell'; market: MarketConfig; onMarketChange: (market: MarketId) => void }) {
  const t = useT();
  const [filters, setFilters] = useState<OfferFilters>(DEFAULT_OFFER_FILTERS);
  const [advanced, setAdvanced] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const search = () => { setSearchOpen(true); setTimeout(() => { searchRef.current?.focus(); searchRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 0); };
    const filter = () => { setAdvanced(true); filterRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    window.addEventListener('p2p-search', search); window.addEventListener('p2p-filters', filter);
    return () => { window.removeEventListener('p2p-search', search); window.removeEventListener('p2p-filters', filter); };
  }, []);
  const [selected, setSelected] = useState<P2POffer | null>(null);
  const methods = useMemo(() => [...new Set(offers.flatMap(offer => offer.methods))].sort(), [offers]);
  const visible = useMemo(() => filterMarketOffers(offers, side, filters), [offers, side, filters]);
  const set = <K extends keyof OfferFilters>(key: K, value: OfferFilters[K]) => setFilters(previous => ({ ...previous, [key]: value }));
  const format = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const active = filters.search || filters.method || filters.amount || filters.completion || filters.online;
  return <section className="pm-offers" aria-label={t('pmMerchants')}>
    <div className="pm-offer-tools" ref={filterRef}>
      <div className="pm-country-tabs"><button type="button" aria-pressed={!active} onClick={() => setFilters(DEFAULT_OFFER_FILTERS)}>{t('pmAllMerchants')}</button>{MARKETS.map(item => <button type="button" key={item.id} aria-pressed={market.id === item.id} onClick={() => onMarketChange(item.id)}><span aria-hidden="true">{item.id === 'qatar' ? '🇶🇦' : '🇪🇬'}</span>{t(item.id === 'qatar' ? 'pmQatar' : 'pmEgypt')}</button>)}</div>
      <button type="button" className="pm-outline" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><SlidersHorizontal size={13} />{t('pmFilters')}<ChevronDown size={12} /></button>
    </div>
    {(searchOpen || advanced) && <label className="pm-search"><Search size={14} /><input ref={searchRef} aria-label={t('pmSearch')} placeholder={t('pmSearch')} value={filters.search} onChange={event => set('search', event.target.value)} /></label>}
    <div className="pm-filter-grid">
      <label><span>{t('p2pMethods')}</span><select aria-label={t('p2pMethods')} value={filters.method} onChange={event => set('method', event.target.value)}><option value="">{t('p2pMethods')}</option>{methods.map(method => <option key={method}>{method}</option>)}</select></label>
      <label><span>{t('pmAmount')}</span><input type="number" min="0" step="any" aria-label={t('pmAmount')} placeholder={t('pmMinAmount')} value={filters.amount} onChange={event => set('amount', event.target.value)} /></label>
      <label><span>{t('pmCompletion')}</span><select aria-label={t('pmCompletion')} value={filters.completion} onChange={event => set('completion', event.target.value)}><option value="">{t('pmCompletion')}</option>{[0.9, 0.95, 0.98, 1].map(rate => <option key={rate} value={rate}>{Math.round(rate * 100)}%+</option>)}</select></label>
      <label className="pm-online"><input type="checkbox" checked={filters.online} onChange={event => set('online', event.target.checked)} />{t('pmOnlineOnly')}</label>
    </div>
    {advanced && <div className="pm-filter-note"><p>{t('pmAmountHint')}</p>{active && <button type="button" onClick={() => setFilters(DEFAULT_OFFER_FILTERS)}>{t('pmReset')}</button>}</div>}
    <div className="pm-section-head pm-list-heading"><h2>{t('pmMerchants')} <span>({visible.length})</span></h2><label className="pm-sort"><ArrowDownUp size={12} /><select aria-label={t('pmSort')} value={filters.sort} onChange={event => set('sort', event.target.value as OfferFilters['sort'])}><option value="price">{t('pmBestPrice')}</option><option value="available">{t('pmAvailability')}</option><option value="completion">{t('pmCompletion')}</option></select></label></div>
    <div className="pm-merchant-list">{visible.map((offer, index) => <article className={`pm-merchant ${index === 0 ? 'pm-best' : ''}`} key={`${offer.nick}-${offer.price}-${index}`}>
      <div className={`pm-avatar pm-avatar-${index % 4}`} aria-hidden="true">{Array.from(offer.nick)[0]?.toUpperCase()}{offer.status?.toLowerCase() === 'online' && <i />}</div>
      <div className="pm-merchant-info"><h3 dir="auto">{offer.nick}</h3><div className="pm-method-tags">{offer.methods.map(method => <span key={method}>{method}</span>)}</div><p>{format(offer.trades)} {t('pmOrders')} <span>·</span> {Math.round(offer.completion * 100)}% {t('pmCompletionShort')}</p></div>
      <div className="pm-offer-price"><small>{t('p2pPrice')} ({market.currency})</small><strong>{offer.price.toFixed(4)}</strong><span>{t('pmAvailable')} <b>{format(offer.available)}</b> USDT</span><span>{t('pmLimits')} <b>{format(offer.min)} – {offer.max > 0 ? format(offer.max) : '∞'}</b></span></div>
      <button type="button" className="pm-offer-action" aria-label={`${t('pmViewOffer')} ${offer.nick}`} onClick={() => setSelected(offer)}>{t(side === 'buy' ? 'pmBuyShort' : 'pmSellShort')}</button>
    </article>)}</div>
    {!visible.length && <div className="pm-empty"><Search size={24} /><h3>{t('pmNoMatches')}</h3><button type="button" onClick={() => setFilters(DEFAULT_OFFER_FILTERS)}>{t('pmReset')}</button></div>}
    <Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{t(side === 'buy' ? 'pmBuy' : 'pmSell')} · {selected?.nick}</DialogTitle></DialogHeader><p className="text-xs text-muted-foreground">{t('pmOfferHint')}</p>{selected && <DeepScanResults results={[selected]} amount={Number(filters.amount) || 0} currency={market.currency} />}</DialogContent></Dialog>
  </section>;
}
