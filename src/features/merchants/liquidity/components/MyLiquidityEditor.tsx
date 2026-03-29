import React, { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtU } from '@/lib/tracker-helpers';
import { type InternalLiquiditySnapshot, type LiquidityPublishMode, type LiquidityPublishProfile, type LiquidityStatus } from '../liquidity-model';
import { Settings2, Wallet, Save } from 'lucide-react';

const statusOptions: LiquidityStatus[] = ['available', 'limited', 'unavailable'];

interface Props {
  myProfile: LiquidityPublishProfile;
  internal: InternalLiquiditySnapshot | undefined;
  saveProfile: (profile: LiquidityPublishProfile) => Promise<void>;
  isSaving: boolean;
  t: (key: string) => string;
}

function SideCard({
  label,
  enabled,
  mode,
  exactAmount,
  rangeMin,
  rangeMax,
  status,
  reserveBuffer,
  onEnabledChange,
  onModeChange,
  onExactChange,
  onRangeMinChange,
  onRangeMaxChange,
  onStatusChange,
  onReserveBufferChange,
  t,
}: {
  label: string;
  enabled: boolean;
  mode: LiquidityPublishMode;
  exactAmount: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
  status: LiquidityStatus;
  reserveBuffer: number;
  onEnabledChange: (v: boolean) => void;
  onModeChange: (v: LiquidityPublishMode) => void;
  onExactChange: (v: number | null) => void;
  onRangeMinChange: (v: number | null) => void;
  onRangeMaxChange: (v: number | null) => void;
  onStatusChange: (v: LiquidityStatus) => void;
  onReserveBufferChange: (v: number) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">{label}</span>
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-muted-foreground">{t('liquidityPublish') || 'Publish'}</Label>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        </div>
      </div>

      {enabled && (
        <>
          <div className="space-y-2">
            <Label className="text-[11px] text-muted-foreground">{t('liquidityMode') || 'Display mode'}</Label>
            <Select value={mode} onValueChange={(v) => onModeChange(v as LiquidityPublishMode)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="status">{t('liquidityStatusOnly') || 'Status only'}</SelectItem>
                <SelectItem value="range">{t('liquidityRange') || 'Range'}</SelectItem>
                <SelectItem value="exact">{t('liquidityExactAmount') || 'Exact amount'}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'exact' && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{t('liquidityPublishedAmount') || 'Published amount'}</Label>
              <Input
                className="h-8 text-xs font-mono"
                value={String(exactAmount ?? '')}
                onChange={(e) => onExactChange(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          )}

          {mode === 'range' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('liquidityMin') || 'Min'}</Label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={String(rangeMin ?? '')}
                  onChange={(e) => onRangeMinChange(e.target.value ? Number(e.target.value) : null)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('liquidityMax') || 'Max'}</Label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={String(rangeMax ?? '')}
                  onChange={(e) => onRangeMaxChange(e.target.value ? Number(e.target.value) : null)}
                />
              </div>
            </div>
          )}

          {mode === 'status' && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{t('status') || 'Status'}</Label>
              <Select value={status} onValueChange={(v) => onStatusChange(v as LiquidityStatus)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt === 'available'
                        ? (t('liquidityStatusAvailable') || 'Available')
                        : opt === 'limited'
                          ? (t('liquidityStatusLimited') || 'Limited')
                          : (t('liquidityStatusUnavailable') || 'Unavailable')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">{t('liquidityReserveBuffer') || 'Reserve buffer'}</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={String(reserveBuffer || '')}
              onChange={(e) => onReserveBufferChange(Number(e.target.value) || 0)}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function MyLiquidityEditor({ myProfile, internal, saveProfile, isSaving, t }: Props) {
  const [draft, setDraft] = useState(myProfile);

  React.useEffect(() => {
    setDraft(myProfile);
  }, [myProfile]);

  const save = async () => {
    if (!draft) return;
    try {
      await saveProfile(draft);
      toast.success(t('liquidityPublishUpdated') || 'Liquidity settings updated');
    } catch (error: any) {
      toast.error(error?.message || (t('liquidityPublishFailed') || 'Failed to publish'));
    }
  };

  if (!draft) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            {t('liquidityMyLiquidity') || 'My Liquidity Settings'}
          </CardTitle>
          {internal && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              <Wallet className="w-3 h-3" />
              {t('liquidityInternalCashBasis') || 'Cash basis'}: {fmtU(internal.cashAvailable)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SideCard
            label={t('cash') || 'Cash'}
            enabled={draft.publishCashEnabled}
            mode={draft.cashPublishMode}
            exactAmount={draft.publishedCashAmount}
            rangeMin={draft.cashRangeMin}
            rangeMax={draft.cashRangeMax}
            status={draft.cashStatus}
            reserveBuffer={draft.reserveBufferCash}
            onEnabledChange={(v) => setDraft(s => s ? ({ ...s, publishCashEnabled: v }) : s)}
            onModeChange={(v) => setDraft(s => s ? ({ ...s, cashPublishMode: v }) : s)}
            onExactChange={(v) => setDraft(s => s ? ({ ...s, publishedCashAmount: v }) : s)}
            onRangeMinChange={(v) => setDraft(s => s ? ({ ...s, cashRangeMin: v }) : s)}
            onRangeMaxChange={(v) => setDraft(s => s ? ({ ...s, cashRangeMax: v }) : s)}
            onStatusChange={(v) => setDraft(s => s ? ({ ...s, cashStatus: v }) : s)}
            onReserveBufferChange={(v) => setDraft(s => s ? ({ ...s, reserveBufferCash: v }) : s)}
            t={t}
          />
          <SideCard
            label={t('usdt') || 'USDT'}
            enabled={draft.publishUsdtEnabled}
            mode={draft.usdtPublishMode}
            exactAmount={draft.publishedUsdtAmount}
            rangeMin={draft.usdtRangeMin}
            rangeMax={draft.usdtRangeMax}
            status={draft.usdtStatus}
            reserveBuffer={draft.reserveBufferUsdt}
            onEnabledChange={(v) => setDraft(s => s ? ({ ...s, publishUsdtEnabled: v }) : s)}
            onModeChange={(v) => setDraft(s => s ? ({ ...s, usdtPublishMode: v }) : s)}
            onExactChange={(v) => setDraft(s => s ? ({ ...s, publishedUsdtAmount: v }) : s)}
            onRangeMinChange={(v) => setDraft(s => s ? ({ ...s, usdtRangeMin: v }) : s)}
            onRangeMaxChange={(v) => setDraft(s => s ? ({ ...s, usdtRangeMax: v }) : s)}
            onStatusChange={(v) => setDraft(s => s ? ({ ...s, usdtStatus: v }) : s)}
            onReserveBufferChange={(v) => setDraft(s => s ? ({ ...s, reserveBufferUsdt: v }) : s)}
            t={t}
          />
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Switch checked={draft.autoSyncEnabled} onCheckedChange={(v) => setDraft(s => s ? ({ ...s, autoSyncEnabled: v }) : s)} />
            <Label className="text-[11px]">{t('liquidityAutoSync') || 'Auto-sync from internal basis'}</Label>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">{t('liquidityVisibility') || 'Visibility'}</Label>
            <Select value={draft.visibilityScope} onValueChange={(v) => setDraft(s => s ? ({ ...s, visibilityScope: v as 'relationships' | 'network' }) : s)}>
              <SelectTrigger className="h-7 w-[140px] text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="relationships">{t('liquidityRelationshipsOnly') || 'Relationships only'}</SelectItem>
                <SelectItem value="network">{t('liquidityNetwork') || 'Network'}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">{t('expires') || 'Expires'}</Label>
            <Input
              type="datetime-local"
              className="h-7 w-auto text-[11px]"
              value={draft.expiresAt ? draft.expiresAt.slice(0, 16) : ''}
              onChange={(e) => setDraft(s => s ? ({ ...s, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null }) : s)}
            />
          </div>

          <Button onClick={save} disabled={isSaving} size="sm" className="ml-auto gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {isSaving ? (t('saving') || 'Saving…') : (t('liquidityPublishButton') || 'Publish')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
