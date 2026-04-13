import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Crosshair, ChevronDown, ChevronUp } from 'lucide-react';
import type { MarketId, P2PSnapshot } from '../types';
import type { DeepScanRequest, DeepScanResult, DeepScanMode } from '../types.deepScan';
import { buildDeepScanResult } from '../utils/deepScanMatcher';
import { MerchantIntelligenceCard } from './MerchantIntelligenceCard';
import { fmtPrice } from '@/lib/tracker-helpers';

interface Props {
  snapshot: P2PSnapshot;
  market: MarketId;
}

export function DeepScanBox({ snapshot, market }: Props) {
  const [requiredUsdtRaw, setRequiredUsdtRaw] = useState('20000');
  const [mode, setMode] = useState<DeepScanMode>('single_merchant_only');
  const [showExcluded, setShowExcluded] = useState(false);
  const [ran, setRan] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<DeepScanResult | null>(null);

  const runScan = () => {
    const parsed = Number(requiredUsdtRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setValidationError('Enter a valid USDT amount greater than 0');
      setResult(null);
      setRan(false);
      return;
    }
    setValidationError(null);

    const request: DeepScanRequest = {
      market,
      requiredUsdt: parsed,
      mode,
      requireFullCoverage: mode === 'single_merchant_only',
    };

    const res = buildDeepScanResult(snapshot.sellOffers, request);
    setResult(res);
    setRan(true);
  };

  return (
    <div className="tracker-root panel">
      <div className="panel-head" style={{ padding: '8px 12px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
          <Crosshair className="h-3 w-3" /> Deep Scan — Merchant Intelligence
        </h2>
        <Badge variant="outline" className="text-[8px] font-mono px-1.5 py-0">
          {market.toUpperCase()}
        </Badge>
      </div>
      <div className="panel-body" style={{ padding: '10px 12px' }}>
        {/* Input controls */}
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="min-w-[140px]">
            <label className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              Required USDT
            </label>
            <Input
              type="number"
              value={requiredUsdtRaw}
              onChange={e => { setRequiredUsdtRaw(e.target.value); setValidationError(null); }}
              className="h-7 text-[11px] font-mono"
              min={1}
            />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              Single Merchant Only
            </label>
            <div className="flex items-center gap-2 h-7">
              <Switch
                checked={mode === 'single_merchant_only'}
                onCheckedChange={v => setMode(v ? 'single_merchant_only' : 'allow_multi_fallback')}
              />
              <span className="text-[9px] text-muted-foreground">{mode === 'single_merchant_only' ? 'Yes' : 'No'}</span>
            </div>
          </div>
          <Button onClick={runScan} variant="default" size="sm" className="gap-1.5 text-[10px] h-7">
            <Crosshair className="h-3 w-3" /> Run Deep Scan
          </Button>
        </div>

        {validationError && (
          <div className="text-[11px] text-destructive font-medium py-2">
            {validationError}
          </div>
        )}

        {/* Results */}
        {ran && result && !validationError && (
          <div className="mt-3 space-y-3">
            {/* Summary strip */}
            <div className="flex flex-wrap gap-2 text-[10px]">
              <Badge variant="outline" className="font-mono text-[9px]">
                {result.eligibleMerchantCount} matching
              </Badge>
              <Badge variant="outline" className="font-mono text-[9px]">
                Avg Price: {result.averageEligiblePrice != null ? fmtPrice(result.averageEligiblePrice) : '—'}
              </Badge>
              {result.excludedCandidates.length > 0 && (
                <Badge variant="outline" className="font-mono text-[9px]">
                  {result.excludedCandidates.length} excluded
                </Badge>
              )}
            </div>

            {/* All matching merchants */}
            {result.topCandidates.length > 0 ? (
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Matching Merchants ({result.topCandidates.length})
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {result.topCandidates.map((c, i) => (
                    <MerchantIntelligenceCard key={c.nick} candidate={c} compact={i > 0} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-destructive font-medium py-3 text-center">
                No merchants can fulfill {Number(requiredUsdtRaw).toLocaleString()} USDT
                {mode === 'single_merchant_only' ? ' in a single trade' : ''}
              </div>
            )}

            {/* Excluded toggle */}
            {result.excludedCandidates.length > 0 && (
              <div>
                <button
                  onClick={() => setShowExcluded(!showExcluded)}
                  className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showExcluded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {result.excludedCandidates.length} excluded merchants
                </button>
                {showExcluded && (
                  <div className="mt-1.5 space-y-1">
                    {result.excludedCandidates.map(c => (
                      <div key={c.nick} className="flex items-center justify-between text-[9px] rounded border border-border/40 px-2 py-1">
                        <span className="truncate font-medium">{c.nick}</span>
                        <span className="text-destructive/80 text-[8px] truncate max-w-[200px]">
                          {c.rejectionReasons[0] || 'Filtered'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
