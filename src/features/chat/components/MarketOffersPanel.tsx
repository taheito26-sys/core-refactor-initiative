import { OfferCard } from './OfferCard';
import type { ChatMarketOffer } from '../types';

interface Props {
  offers: ChatMarketOffer[];
  myUserId: string;
  onCancelOffer?: (offerId: string) => void;
}

function formatOfferAmount(offer: ChatMarketOffer) {
  return `${offer.amount.toLocaleString()} ${offer.asset}`;
}

function formatAvailability(offer: ChatMarketOffer) {
  if (!offer.expires_at) return 'No expiry';
  const expiry = new Date(offer.expires_at);
  if (Number.isNaN(expiry.getTime())) return 'No expiry';
  return `Until ${expiry.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

export function MarketOffersPanel({ offers, myUserId, onCancelOffer }: Props) {
  const activeOffers = offers.filter((offer) => offer.status === 'active');

  return (
    <div className="border-b border-border/50 bg-background/70 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Live Market Offers</p>
          <p className="text-xs text-muted-foreground">Realtime structured cards backed by `market_offers`.</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
          {activeOffers.length} active
        </span>
      </div>

      {activeOffers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-5 text-sm text-muted-foreground">
          No active USDT offers are posted in this room yet.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {activeOffers.map((offer) => (
            <OfferCard
              key={offer.id}
              merchantName={offer.merchant_id}
              merchantId={offer.merchant_id}
              type={offer.offer_type}
              amount={formatOfferAmount(offer)}
              rate={offer.price.toFixed(3)}
              currency={offer.fiat_currency}
              paymentMethod={offer.payment_methods.join(', ') || 'Flexible'}
              availability={formatAvailability(offer)}
              status={offer.status}
              actionLabel={offer.created_by === myUserId ? 'Cancel Offer' : 'View Offer'}
              onAction={offer.created_by === myUserId && onCancelOffer ? () => onCancelOffer(offer.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
