import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtU } from '@/lib/tracker-helpers';
import { buildLiquidityActions, type LiquidityBoardEntry, type LiquidityFilters, type LiquidityPublishMode, type LiquidityStatus } from '../liquidity-model';
import { Filter, ExternalLink, MessageSquare, Plus } from 'lucide-react';

interface Props {
  filter: (filters: LiquidityFilters) => LiquidityBoardEntry[];
  onOpenRelationship: (id: string) => void;
  onOpenChat: (id: string) => void;
  onOpenDeal: (id: string) => void;
  t: (key: string) => string;
}

function renderAmount(side: {
  enabled: boolean;
  mode: LiquidityPublishMode;
  exactAmount: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
  status: LiquidityStatus;
}, t: (key: string) => string) {
  if (!side.enabled) return <span className="text-muted-foreground text-xs">{t('liquidityHidden') || 'Hidden'}</span>;
  if (side.mode === 'status') {
    const variant = side.status === 'available' ? 'default' : side.status === 'limited' ? 'secondary' : 'destructive';
    const label = side.status === 'available'
      ? (t('liquidityStatusAvailable') || 'Available')
      : side.status === 'limited'
        ? (t('liquidityStatusLimited') || 'Limited')
        : (t('liquidityStatusUnavailable') || 'Unavailable');
    return <Badge variant={variant} className="text-[10px]">{label}</Badge>;
  }
  if (side.mode === 'range') return <span className="font-mono text-xs">{fmtU(side.rangeMin || 0)} – {fmtU(side.rangeMax || 0)}</span>;
  return <span className="font-mono text-xs font-bold">{fmtU(side.exactAmount || 0)}</span>;
}

export function LiquidityBoardTable({ filter, onOpenRelationship, onOpenChat, onOpenDeal, t }: Props) {
  const [filters, setFilters] = useState<LiquidityFilters>({
    side: 'both',
    minAmount: 0,
    relationship: 'all',
    updatedRecentlyHours: null,
  });
  const [showFilters, setShowFilters] = useState(false);

  const filtered = filter(filters);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{t('liquidityBoard') || 'Liquidity Board'}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{filtered.length} {t('liquidityActiveMerchants') || 'merchants'}</Badge>
            <Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)} className="h-7 px-2 gap-1">
              <Filter className="w-3.5 h-3.5" />
              <span className="text-xs">{t('filter') || 'Filter'}</span>
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-border/50 mt-3">
            <Select value={filters.side} onValueChange={(v) => setFilters(s => ({ ...s, side: v as LiquidityFilters['side'] }))}>
              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">{t('liquidityCashPlusUsdt') || 'Cash + USDT'}</SelectItem>
                <SelectItem value="cash">{t('liquidityCashOnly') || 'Cash only'}</SelectItem>
                <SelectItem value="usdt">{t('liquidityUsdtOnly') || 'USDT only'}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="w-[100px] h-8 text-xs"
              placeholder={t('liquidityMinAmount') || 'Min amount'}
              value={String(filters.minAmount || '')}
              onChange={(e) => setFilters(s => ({ ...s, minAmount: Number(e.target.value) || 0 }))}
            />
            <Select value={filters.relationship} onValueChange={(v) => setFilters(s => ({ ...s, relationship: v as LiquidityFilters['relationship'] }))}>
              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('liquidityAllRelationships') || 'All'}</SelectItem>
                <SelectItem value="active">{t('liquidityActiveOnly') || 'Active'}</SelectItem>
                <SelectItem value="pending">{t('liquidityPendingOnly') || 'Pending'}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.updatedRecentlyHours != null ? String(filters.updatedRecentlyHours) : 'any'} onValueChange={(v) => setFilters(s => ({ ...s, updatedRecentlyHours: v === 'any' ? null : Number(v) }))}>
              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t('liquidityAnyUpdateTime') || 'Any time'}</SelectItem>
                <SelectItem value="4">{t('liquidityUpdated4h') || '≤ 4h'}</SelectItem>
                <SelectItem value="24">{t('liquidityUpdated24h') || '≤ 24h'}</SelectItem>
                <SelectItem value="72">{t('liquidityUpdated72h') || '≤ 72h'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {t('liquidityNoMatchFilters') || 'No liquidity postings match your filters.'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((entry) => {
              const actions = buildLiquidityActions(entry.relationshipId);
              return (
                <div key={entry.merchantId} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm truncate">{entry.merchantName}</span>
                      <Badge
                        variant={entry.relationshipStatus === 'active' ? 'default' : entry.relationshipStatus === 'pending' ? 'secondary' : 'outline'}
                        className="text-[9px] px-1.5 py-0 shrink-0"
                      >
                        {entry.relationshipStatus}
                      </Badge>
                      {entry.isStale && <Badge variant="destructive" className="text-[9px] px-1.5 py-0">{t('liquidityStale') || 'stale'}</Badge>}
                      {entry.region && <span className="text-[10px] text-muted-foreground">{entry.region}</span>}
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{t('cash') || 'Cash'}:</span>
                        {renderAmount(entry.cash, t)}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{t('usdt') || 'USDT'}:</span>
                        {renderAmount(entry.usdt, t)}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono ml-auto hidden sm:inline">
                        {new Date(entry.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={!actions.workspacePath} onClick={() => actions.workspacePath && onOpenRelationship(entry.relationshipId!)}>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={!actions.chatPath} onClick={() => actions.chatPath && onOpenChat(entry.relationshipId!)}>
                      <MessageSquare className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={!actions.dealPath} onClick={() => actions.dealPath && onOpenDeal(entry.relationshipId!)}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
