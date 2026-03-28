import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtU } from '@/lib/tracker-helpers';
import { type LiquidityBoardEntry, type LiquidityPublishMode, type LiquidityStatus } from '../liquidity-model';
import { Search } from 'lucide-react';

interface Props {
  rank: (side: 'cash' | 'usdt', amount: number) => LiquidityBoardEntry[];
  t: (key: string) => string;
}

function renderSideAmount(side: {
  enabled: boolean;
  mode: LiquidityPublishMode;
  exactAmount: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
  status: LiquidityStatus;
}) {
  if (!side.enabled) return <span className="text-muted-foreground">—</span>;
  if (side.mode === 'status') {
    const variant = side.status === 'available' ? 'default' : side.status === 'limited' ? 'secondary' : 'destructive';
    return <Badge variant={variant} className="text-[10px]">{side.status}</Badge>;
  }
  if (side.mode === 'range') return <span className="font-mono">{fmtU(side.rangeMin || 0)} – {fmtU(side.rangeMax || 0)}</span>;
  return <span className="font-mono font-bold">{fmtU(side.exactAmount || 0)}</span>;
}

export function LiquidityMatchPanel({ rank, t }: Props) {
  const [matchSide, setMatchSide] = useState<'cash' | 'usdt'>('cash');
  const [matchAmount, setMatchAmount] = useState('50000');

  const ranked = useMemo(() => rank(matchSide, Number(matchAmount) || 0), [rank, matchAmount, matchSide]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Search className="w-4 h-4 text-primary" />
          {t('liquidityMatchCounterparties') || 'Find Counterparties'}
        </CardTitle>
        <div className="flex items-center gap-2 pt-2">
          <Select value={matchSide} onValueChange={(v) => setMatchSide(v as 'cash' | 'usdt')}>
            <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">{t('liquidityNeedCash') || 'Need cash'}</SelectItem>
              <SelectItem value="usdt">{t('liquidityNeedUsdt') || 'Need USDT'}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="w-[140px] h-8 text-xs font-mono"
            value={matchAmount}
            onChange={(e) => setMatchAmount(e.target.value)}
            placeholder={t('liquidityRequestedAmount') || 'Amount'}
          />
          <span className="text-[10px] text-muted-foreground">{t('liquiditySortHint') || 'Sorted by best match'}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {ranked.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            {t('liquidityNoCounterparties') || 'No counterparties currently available.'}
          </div>
        ) : (
          ranked.slice(0, 5).map((entry, idx) => (
            <div key={`${entry.merchantId}-${idx}`} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-primary w-5">{idx + 1}.</span>
                  <span className="font-semibold text-sm truncate">{entry.merchantName}</span>
                </div>
                <p className="text-[10px] text-muted-foreground ml-7">
                  {entry.relationshipStatus} · {entry.region || (t('liquidityRegionNA') || 'region n/a')}
                </p>
              </div>
              <div className="text-sm shrink-0">
                {matchSide === 'cash' ? renderSideAmount(entry.cash) : renderSideAmount(entry.usdt)}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
