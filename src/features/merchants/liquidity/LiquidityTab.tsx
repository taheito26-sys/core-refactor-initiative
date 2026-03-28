import { useT } from '@/lib/i18n';
import { useMerchantLiquidity } from './useMerchantLiquidity';
import { LiquidityOverviewCards } from './components/LiquidityOverviewCards';
import { LiquidityBoardTable } from './components/LiquidityBoardTable';
import { LiquidityMatchPanel } from './components/LiquidityMatchPanel';
import { MyLiquidityEditor } from './components/MyLiquidityEditor';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface LiquidityTabProps {
  onOpenRelationship: (relationshipId: string) => void;
  onOpenChat: (relationshipId: string) => void;
  onOpenDeal: (relationshipId: string) => void;
}

export function LiquidityTab({ onOpenRelationship, onOpenChat, onOpenDeal }: LiquidityTabProps) {
  const t = useT();
  const {
    isLoading,
    isError,
    error,
    myProfile,
    internal,
    saveProfile,
    isSaving,
    overview,
    filter,
    rank,
    liquidityTableMissing,
  } = useMerchantLiquidity();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">{t('loadingLiquidityWorkspace') || 'Loading liquidity workspace…'}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <AlertTriangle className="w-5 h-5 text-destructive" />
        <p className="text-sm font-medium">{t('liquidityLoadFailed') || 'Failed to load liquidity workspace.'}</p>
        <p className="text-xs text-muted-foreground">{(error as Error | null)?.message || (t('liquidityLoadFailedHint') || 'Please refresh and try again.')}</p>
      </div>
    );
  }

  if (!myProfile) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        {t('liquidityProfileUnavailable') || 'Liquidity profile unavailable.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {liquidityTableMissing && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-warning/30 bg-warning/5">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <span className="text-xs text-warning">
            {t('liquidityMigrationRequired') || 'Liquidity data table is not installed yet. Apply the latest migration to enable publishing.'}
          </span>
        </div>
      )}

      <LiquidityOverviewCards {...overview} t={t} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <LiquidityBoardTable
            filter={filter}
            onOpenRelationship={onOpenRelationship}
            onOpenChat={onOpenChat}
            onOpenDeal={onOpenDeal}
            t={t}
          />
        </div>
        <div>
          <LiquidityMatchPanel rank={rank} t={t} />
        </div>
      </div>

      <MyLiquidityEditor
        myProfile={myProfile}
        internal={internal}
        saveProfile={saveProfile}
        isSaving={isSaving}
        t={t}
      />
    </div>
  );
}
