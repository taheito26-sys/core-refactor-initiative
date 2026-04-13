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
  const [requiredUsdt, setRequiredUsdt] = useState(20000);
  const [mode, setMode] = useState<DeepScanMode>('single_merchant_only');
  const [min30dTrades, setMin30dTrades] = useState(100);
  const [minCompletionPct, setMinCompletionPct] = useState(90);
  const [showExcluded, setShowExcluded] = useState(false);
  const [ran, setRan] = useState(false);

  const request: DeepScanRequest = useMemo(() => ({
    market,
    requiredUsdt,
    mode,
    min30dTrades,
    minCompletionPct,
    requireFullCoverage: mode === 'single_merchant_only',
  }), [market, requiredUsdt, mode, min30dTrades, minCompletionPct]);

  const [result, setResult] = useState<DeepScanResult | null>(null);

  const runScan = () => {
    // Use sell offers — operator is selling USDT to a buyer
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <div>
            <label className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              Required USDT
            </label>
            <Input
              type="number"
              value={requiredUsdt}
              onChange={e => setRequiredUsdt(Number(e.target.value) || 0)}
              className="h-7 text-[11px] font-mono"
            />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              Min 30d Trades
            </label>
            <Input
              type="number"
              value={min30dTrades}
              onChange={e => setMin30dTrades(Number(e.target.value) || 0)}
              className="h-7 text-[11px] font-mono"
            />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              Min Completion %
            </label>
            <Input
              type="number"
              value={minCompletionPct}
              onChange={e => setMinCompletionPct(Number(e.target.value) || 0)}
              className="h-7 text-[11px] font-mono"
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
        </div>
        <Button onClick={runScan} variant="default" size="sm" className="gap-1.5 text-[10px] h-7">
          <Crosshair className="h-3 w-3" /> Run Deep Scan
        </Button>

        {/* Results */}
        {ran && result && (
          <div className="mt-3 space-y-3">
            {/* Summary strip */}
            <div className="flex flex-wrap gap-2 text-[10px]">
              <Badge variant="outline" className="font-mono text-[9px]">
                {result.eligibleMerchantCount} eligible
              </Badge>
              <Badge variant="outline" className="font-mono text-[9px]">
                Avg Price: {result.averageEligiblePrice != null ? fmtPrice(result.averageEligiblePrice) : '—'}
              </Badge>
              <Badge variant="outline" className="font-mono text-[9px]">
                {result.excludedCandidates.length} excluded
              </Badge>
            </div>

            {/* Winner */}
            {result.winner ? (
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  🏆 Best Match
                </div>
                <MerchantIntelligenceCard candidate={result.winner} />
              </div>
            ) : (
              <div className="text-[11px] text-destructive font-medium py-3 text-center">
                No merchant matches all criteria for {requiredUsdt.toLocaleString()} USDT
              </div>
            )}

            {/* Top candidates */}
            {result.topCandidates.length > 1 && (
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Top Candidates
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {result.topCandidates.slice(1).map(c => (
                    <MerchantIntelligenceCard key={c.nick} candidate={c} compact />
                  ))}
                </div>
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
