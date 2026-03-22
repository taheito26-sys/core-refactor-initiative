import { useState } from 'react';
import { Radio } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useP2PRates } from '@/features/dashboard/hooks/useP2PRates';
import { useP2PRateHistory } from '@/features/p2p/hooks/useP2PRateHistory';
import { MarketRateCard } from '@/features/p2p/components/MarketRateCard';
import { SpreadChart } from '@/features/p2p/components/SpreadChart';
import { RateHistoryTable } from '@/features/p2p/components/RateHistoryTable';

const MARKETS = [
  { value: 'qatar', label: 'Qatar', pair: 'USDT/QAR' },
  { value: 'uae', label: 'UAE', pair: 'USDT/AED' },
  { value: 'saudi', label: 'Saudi', pair: 'USDT/SAR' },
  { value: 'india', label: 'India', pair: 'USDT/INR' },
];

export default function P2PTrackerPage() {
  const [market, setMarket] = useState('qatar');
  const { data: rateData, isLoading: ratesLoading } = useP2PRates(market);
  const { data: historyData, isLoading: historyLoading } = useP2PRateHistory(market);

  const activeMarket = MARKETS.find((m) => m.value === market);

  return (
    <div className="app-page-shell">
      <div className="app-page-content space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-display text-foreground">P2P Tracker</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live P2P market rates — {activeMarket?.pair ?? 'USDT'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                rateData?.isLive ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'
              }`}
            />
            <span className="text-xs font-medium text-muted-foreground">
              {rateData?.isLive ? 'LIVE' : 'CACHED'}
            </span>
          </div>
        </div>

        {/* Market Tabs */}
        <Tabs value={market} onValueChange={setMarket}>
          <TabsList className="w-full sm:w-auto">
            {MARKETS.map((m) => (
              <TabsTrigger key={m.value} value={m.value} className="flex-1 sm:flex-none">
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {MARKETS.map((m) => (
            <TabsContent key={m.value} value={m.value} className="space-y-6 mt-4">
              {/* Rate Cards */}
              <MarketRateCard data={rateData} isLoading={ratesLoading} />

              {/* Chart + Order Book */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SpreadChart data={historyData} isLoading={historyLoading} />
                <RateHistoryTable data={historyData} isLoading={historyLoading} />
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Last updated */}
        {rateData?.fetchedAt && (
          <p className="text-[11px] text-muted-foreground text-right">
            Last updated: {new Date(rateData.fetchedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
