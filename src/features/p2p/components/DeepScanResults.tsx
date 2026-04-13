import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { P2POffer } from '../types';
import { MerchantIntelligenceCard } from './MerchantIntelligenceCard';

function maxUSDTPerTx(offer: P2POffer): number {
  if (offer.max > 0 && offer.price > 0) return offer.max / offer.price;
  return offer.available;
}

function dedupeByNick(offers: P2POffer[]): P2POffer[] {
  const seen = new Set<string>();
  const result: P2POffer[] = [];
  for (const offer of [...offers].sort((a, b) => a.price - b.price || b.available - a.available)) {
    const nick = offer.nick.trim().toLowerCase();
    if (!nick || seen.has(nick)) continue;
    seen.add(nick);
    result.push(offer);
  }
  return result;
}

interface Props {
  offers: P2POffer[];
  currency: string;
}

export function DeepScanResults({ offers, currency }: Props) {
  const [requiredUsdt, setRequiredUsdt] = useState('');
  const [singleMerchantOnly, setSingleMerchantOnly] = useState(false);
  const [scanAmount, setScanAmount] = useState<number | null>(null);
  const [scanned, setScanned] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const results = useMemo(() => {
    if (!scanned || scanAmount == null) return [];
    return dedupeByNick(offers).filter(offer => {
      if (offer.available < scanAmount) return false;
      if (singleMerchantOnly && maxUSDTPerTx(offer) < scanAmount) return false;
      return true;
    });
  }, [offers, scanned, scanAmount, singleMerchantOnly]);

  const handleScan = () => {
    const parsed = Number(requiredUsdt);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setValidationError('Enter a valid USDT amount greater than zero.');
      setScanned(false);
      setScanAmount(null);
      return;
    }

    setValidationError(null);
    setScanAmount(parsed);
    setScanned(true);
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-2.5 px-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-[11px] font-semibold flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" />
            Deep Scan
          </CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Required USDT"
              value={requiredUsdt}
              onChange={e => {
                setRequiredUsdt(e.target.value);
                if (validationError) setValidationError(null);
              }}
              className="h-8 w-36 text-[11px]"
              aria-invalid={!!validationError}
              onKeyDown={e => {
                if (e.key === 'Enter') handleScan();
              }}
            />
            <Button
              type="button"
              variant={singleMerchantOnly ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-[10px] px-2.5"
              onClick={() => setSingleMerchantOnly(v => !v)}
            >
              Single Merchant Only {singleMerchantOnly ? 'On' : 'Off'}
            </Button>
            <Button type="button" size="sm" className="h-8 text-[10px] px-3" onClick={handleScan}>
              Run Deep Scan
            </Button>
            {scanned && scanAmount != null ? (
              <Badge variant="secondary" className="text-[9px]">
                {results.length} matching merchants · {scanAmount.toLocaleString()} USDT
              </Badge>
            ) : null}
          </div>
        </div>
        {validationError ? (
          <div className="text-[10px] text-destructive">{validationError}</div>
        ) : null}
      </CardHeader>

      <CardContent className="p-3 pt-0">
        {!scanned && !validationError ? (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-[10px] text-muted-foreground">
            Enter a USDT amount to find merchants who can fulfill it.
          </div>
        ) : scanned && scanAmount != null && results.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-[10px] text-muted-foreground">
            No merchants match {scanAmount.toLocaleString()} USDT.
          </div>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            {results.map((offer, index) => (
              <MerchantIntelligenceCard
                key={`${offer.nick}-${offer.price}-${index}`}
                offer={offer}
                currency={currency}
                rank={index + 1}
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
