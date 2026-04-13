import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { fmtPrice } from '@/lib/tracker-helpers';
import type { MarketId, P2POffer, P2PSnapshot } from '../types';
import { computeDistinctMerchantAverage } from '../utils/converters';

interface Props {
  snapshot: P2PSnapshot;
  market: MarketId;
  qatarRates?: { sellAvg: number; buyAvg: number } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

const VCASH_RE = /vodafone|vcash|v[\s-]?cash|فودافون/i;
const INSTA_RE = /instapay|insta\s*pay|إنستاباي|\bbank\b|\bbanks?\b|\btransfer\b|\biban\b|\bnational\s*bank\b|\bbanque\s*misr\b|\balex\s*bank\b|\bqnb\b|\bfaisal\b|\barab\s*bank\b|\bhsbc\b|\bmeeza\b/i;

function isVcashOffer(offer: P2POffer): boolean {
  return offer.methods.some(method => VCASH_RE.test(method));
}

function isInstaBankOffer(offer: P2POffer): boolean {
  return !isVcashOffer(offer) && offer.methods.some(method => INSTA_RE.test(method));
}

function bucketTop20(offers: P2POffer[]): P2POffer[] {
  const seen = new Set<string>();
  const selected: P2POffer[] = [];
  for (const offer of [...offers].sort((a, b) => a.price - b.price)) {
    const nick = offer.nick.trim().toLowerCase();
    if (!nick || seen.has(nick)) continue;
    seen.add(nick);
    selected.push(offer);
    if (selected.length >= 20) break;
  }
  return selected;
}

function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}

export function MarketKpiGrid({ snapshot, market, qatarRates, t }: Props) {
  const [overrideText, setOverrideText] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('p2p-egypt-average-buy-override');
    if (stored != null) setOverrideText(stored);
  }, []);

  useEffect(() => {
    localStorage.setItem('p2p-egypt-average-buy-override', overrideText);
  }, [overrideText]);

  const isEgypt = market === 'egypt';

  const egyptCards = useMemo(() => {
    if (!isEgypt || !qatarRates?.sellAvg || !qatarRates.buyAvg) return null;

    const vcashOffers = bucketTop20(snapshot.buyOffers.filter(isVcashOffer));
    const instaOffers = bucketTop20(snapshot.buyOffers.filter(isInstaBankOffer));
    const egBuyVcashAvg = computeDistinctMerchantAverage(vcashOffers);
    const egBuyInstaAvg = computeDistinctMerchantAverage(instaOffers);
    const overrideValue = Number(overrideText);
    const hasValidOverride = Number.isFinite(overrideValue) && overrideValue > 0;
    const instaDenominator = hasValidOverride ? overrideValue : egBuyInstaAvg;

    return {
      vcashV1: safeRatio(qatarRates.sellAvg, egBuyVcashAvg),
      vcashV2: safeRatio(qatarRates.buyAvg, egBuyVcashAvg),
      instaPayV1: safeRatio(qatarRates.sellAvg, instaDenominator),
      instaPayV2: safeRatio(qatarRates.buyAvg, egBuyInstaAvg),
      egBuyVcashAvg,
      egBuyInstaAvg,
      hasValidOverride,
      overrideValue: hasValidOverride ? overrideValue : null,
      vcashCount: vcashOffers.length,
      instaCount: instaOffers.length,
    };
  }, [isEgypt, qatarRates, snapshot.buyOffers, overrideText]);

  if (!isEgypt) {
    return null;
  }

  const cardValue = (value: number | null) => (value != null ? fmtPrice(value) : '—');

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_auto]">
        <Card className="border-border/60 p-3">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">EGY Average Buy Override</div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={overrideText}
                onChange={e => setOverrideText(e.target.value)}
                className="h-8 w-40 text-[11px]"
                placeholder="Optional manual override"
              />
              <button
                type="button"
                onClick={() => setOverrideText('')}
                className="h-8 rounded-md border border-border px-3 text-[11px] text-muted-foreground"
              >
                Clear
              </button>
              <div className="text-[10px] text-muted-foreground">
                Used only for InstaPay V1 when valid.
              </div>
            </div>
          </div>
        </Card>
        <Card className="border-border/60 p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Egypt Buckets</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {egyptCards
              ? `VCash ${egyptCards.vcashCount} offers · InstaPay/Banks ${egyptCards.instaCount} offers`
              : 'Waiting for Qatar rates and Egypt offers'}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="VCash V1" value={cardValue(egyptCards?.vcashV1 ?? null)} sub="QA Sell average ÷ EG Buy (top 20)" />
        <KpiCard label="VCash V2" value={cardValue(egyptCards?.vcashV2 ?? null)} sub="QA Buy average ÷ EG Buy (top 20)" />
        <KpiCard
          label="InstaPay V1"
          value={cardValue(egyptCards?.instaPayV1 ?? null)}
          sub={`QA Sell average ÷ EG Buy (top 20)${egyptCards?.hasValidOverride && egyptCards.overrideValue != null ? ` · override ${fmtPrice(egyptCards.overrideValue)}` : ''}`}
        />
        <KpiCard label="InstaPay V2" value={cardValue(egyptCards?.instaPayV2 ?? null)} sub="QA Buy average ÷ EG Buy (top 20)" />
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="border-border/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-bold">{value}</div>
      <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{sub}</div>
    </Card>
  );
}
