import { TrendingUp, TrendingDown } from 'lucide-react';
import { useP2PRates } from '../hooks/useP2PRates';

export function P2PRateBanner() {
  const { data, isLoading } = useP2PRates('qatar');

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-primary/90 to-primary/60 p-5 text-primary-foreground">
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold font-display tracking-wide opacity-90">
            Qatar P2P Rate (USDT/QAR)
          </h2>
          <span className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                data?.isLive ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'
              }`}
            />
            <span className="text-[10px] font-medium opacity-75">
              {data?.isLive ? 'LIVE' : 'CACHED'}
            </span>
          </span>
        </div>

        {isLoading ? (
          <div className="flex gap-8">
            <div className="h-10 w-24 animate-pulse rounded bg-white/20" />
            <div className="h-10 w-24 animate-pulse rounded bg-white/20" />
          </div>
        ) : data?.buyRate || data?.sellRate ? (
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <span className="text-[10px] uppercase tracking-widest opacity-70 block mb-1">
                Sell
              </span>
              <span className="text-3xl font-bold font-display flex items-center gap-2 text-green-200">
                <TrendingUp className="h-5 w-5 opacity-60" />
                {data?.sellRate?.toFixed(2) ?? '—'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-widest opacity-70 block mb-1">
                Buy
              </span>
              <span className="text-3xl font-bold font-display flex items-center gap-2 text-red-200">
                <TrendingDown className="h-5 w-5 opacity-60" />
                {data?.buyRate?.toFixed(2) ?? '—'}
              </span>
            </div>
            {data?.spreadPercent != null && (
              <div className="ml-auto text-right">
                <span className="text-[10px] uppercase tracking-widest opacity-70 block mb-1">
                  Spread
                </span>
                <span className="text-lg font-semibold font-display">
                  {data.spreadPercent.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm opacity-75">No rate data available. Rates will appear here once fetched.</p>
        )}
      </div>

      {/* Decorative background */}
      <TrendingUp className="absolute -bottom-4 -right-4 h-32 w-32 opacity-[0.06] rotate-12" />
    </div>
  );
}
