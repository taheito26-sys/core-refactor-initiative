import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { fmtU } from '@/lib/tracker-helpers';
import { useT } from '@/lib/i18n';
import { buildLiquidityActions, type LiquidityFilters, type LiquidityPublishMode, type LiquidityStatus } from './liquidity-model';
import { useMerchantLiquidity } from './useMerchantLiquidity';

interface LiquidityTabProps {
  onOpenRelationship: (relationshipId: string) => void;
  onOpenChat: (relationshipId: string) => void;
  onOpenDeal: (relationshipId: string) => void;
}

const statusOptions: LiquidityStatus[] = ['available', 'limited', 'unavailable'];

export function LiquidityTab({ onOpenRelationship, onOpenChat, onOpenDeal }: LiquidityTabProps) {
  const t = useT();
  const {
    isLoading,
    myProfile,
    internal,
    saveProfile,
    isSaving,
    boardEntries,
    overview,
    filter,
    rank,
  } = useMerchantLiquidity();

  const [filters, setFilters] = useState<LiquidityFilters>({
    side: 'both',
    minAmount: 0,
    relationship: 'all',
    updatedRecentlyHours: null,
  });

  const [matchSide, setMatchSide] = useState<'cash' | 'usdt'>('cash');
  const [matchAmount, setMatchAmount] = useState('50000');

  const [draft, setDraft] = useState(myProfile);

  React.useEffect(() => {
    setDraft(myProfile);
  }, [myProfile]);

  const filtered = useMemo(() => filter(filters), [filter, filters]);
  const ranked = useMemo(() => rank(matchSide, Number(matchAmount) || 0), [rank, matchAmount, matchSide]);

  const save = async () => {
    if (!draft) return;
    try {
      await saveProfile(draft);
      toast.success(t('liquidityPublishUpdated') || 'Liquidity publishing preferences updated');
    } catch (error: any) {
      toast.error(error?.message || (t('liquidityPublishFailed') || 'Failed to publish liquidity settings'));
    }
  };

  const renderAmount = (side: {
    enabled: boolean;
    mode: LiquidityPublishMode;
    exactAmount: number | null;
    rangeMin: number | null;
    rangeMax: number | null;
    status: LiquidityStatus;
  }) => {
    const statusLabel = side.status === 'available'
      ? (t('liquidityStatusAvailable') || 'Available')
      : side.status === 'limited'
        ? (t('liquidityStatusLimited') || 'Limited')
        : (t('liquidityStatusUnavailable') || 'Unavailable');
    if (!side.enabled) return <span style={{ color: 'var(--muted)' }}>{t('liquidityHidden') || 'Hidden'}</span>;
    if (side.mode === 'status') return <span className={`pill ${side.status === 'available' ? 'good' : side.status === 'limited' ? 'warn' : 'bad'}`}>{statusLabel}</span>;
    if (side.mode === 'range') return <span className="mono">{fmtU(side.rangeMin || 0)} - {fmtU(side.rangeMax || 0)}</span>;
    return <span className="mono" style={{ fontWeight: 700 }}>{fmtU(side.exactAmount || 0)}</span>;
  };

  if (isLoading || !myProfile || !draft) {
    return <div className="empty"><div className="empty-t">{t('loadingLiquidityWorkspace') || 'Loading liquidity workspace…'}</div></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="kpi-band">
        <div className="kpi-band-title">{t('liquidityMarketOverview') || 'Liquidity Market Overview'}</div>
        <div className="kpi-band-cols" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          <div><div className="kpi-period">{t('liquiditySharedCash') || 'Shared Cash'}</div><div className="kpi-cell-val">{fmtU(overview.totalCashAvailable)}</div></div>
          <div><div className="kpi-period">{t('liquiditySharedUsdt') || 'Shared USDT'}</div><div className="kpi-cell-val">{fmtU(overview.totalUsdtAvailable)}</div></div>
          <div><div className="kpi-period">{t('liquidityActiveMerchants') || 'Active Merchants'}</div><div className="kpi-cell-val">{overview.activeMerchantsCount}</div></div>
          <div><div className="kpi-period">{t('liquidityStalePostings') || 'Stale Postings'}</div><div className="kpi-cell-val" style={{ color: overview.staleCount > 0 ? 'var(--warn)' : 'var(--muted)' }}>{overview.staleCount}</div></div>
          <div><div className="kpi-period">{t('liquidityFreshness') || 'Freshness'}</div><div className="kpi-cell-val" style={{ fontSize: 11 }}>{overview.mostRecentUpdate ? new Date(overview.mostRecentUpdate).toLocaleString() : (t('liquidityNoUpdates') || 'No updates')}</div></div>
        </div>
      </div>

      <div className="panel" style={{ padding: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{t('liquidityBoard') || 'Liquidity Board'}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select value={filters.side} onChange={(e) => setFilters((s) => ({ ...s, side: e.target.value as LiquidityFilters['side'] }))}>
              <option value="both">{t('liquidityCashPlusUsdt') || 'Cash + USDT'}</option>
              <option value="cash">{t('liquidityCashOnly') || 'Cash only'}</option>
              <option value="usdt">{t('liquidityUsdtOnly') || 'USDT only'}</option>
            </select>
            <input className="inputBox" style={{ width: 120 }} value={String(filters.minAmount)} onChange={(e) => setFilters((s) => ({ ...s, minAmount: Number(e.target.value) || 0 }))} placeholder={t('liquidityMinAmount') || 'Min amount'} />
            <select value={filters.relationship} onChange={(e) => setFilters((s) => ({ ...s, relationship: e.target.value as LiquidityFilters['relationship'] }))}>
              <option value="all">{t('liquidityAllRelationships') || 'All relationships'}</option>
              <option value="active">{t('liquidityActiveOnly') || 'Active only'}</option>
              <option value="pending">{t('liquidityPendingOnly') || 'Pending only'}</option>
            </select>
            <select value={filters.updatedRecentlyHours ?? ''} onChange={(e) => setFilters((s) => ({ ...s, updatedRecentlyHours: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">{t('liquidityAnyUpdateTime') || 'Any update time'}</option>
              <option value="4">{t('liquidityUpdated4h') || 'Updated ≤ 4h'}</option>
              <option value="24">{t('liquidityUpdated24h') || 'Updated ≤ 24h'}</option>
              <option value="72">{t('liquidityUpdated72h') || 'Updated ≤ 72h'}</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty"><div className="empty-t">{t('liquidityNoMatchFilters') || 'No liquidity postings match your filters.'}</div></div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{t('merchant') || 'Merchant'}</th>
                  <th>{t('relationship') || 'Relationship'}</th>
                  <th>{t('onboardRegion') || 'Region'}</th>
                  <th className="r">{t('cash') || 'Cash'}</th>
                  <th className="r">{t('usdt') || 'USDT'}</th>
                  <th>{t('liquidityVisibility') || 'Visibility'}</th>
                  <th>{t('p2pUpdated') || 'Updated'}</th>
                  <th>{t('actions') || 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const actions = buildLiquidityActions(entry.relationshipId);
                  return (
                    <tr key={entry.merchantId}>
                      <td style={{ fontWeight: 700 }}>{entry.merchantName}</td>
                      <td><span className={`pill ${entry.relationshipStatus === 'active' ? 'good' : entry.relationshipStatus === 'pending' ? 'warn' : ''}`}>{entry.relationshipStatus}</span></td>
                      <td>{entry.region || '—'}</td>
                      <td className="r">{renderAmount(entry.cash)}</td>
                      <td className="r">{renderAmount(entry.usdt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <span className="pill">{t('cash') || 'Cash'}: {entry.cash.mode}</span>
                          <span className="pill">{t('usdt') || 'USDT'}: {entry.usdt.mode}</span>
                          {entry.isStale && <span className="pill warn">{t('liquidityStale') || 'stale'}</span>}
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 10 }}>{new Date(entry.updatedAt).toLocaleString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button className="rowBtn" disabled={!actions.workspacePath} onClick={() => actions.workspacePath && onOpenRelationship(entry.relationshipId!)}>{t('openWorkspaceLabel') || 'Open workspace'}</button>
                          <button className="rowBtn" disabled={!actions.chatPath} onClick={() => actions.chatPath && onOpenChat(entry.relationshipId!)}>{t('liquidityOpenChat') || 'Open chat'}</button>
                          <button className="rowBtn" disabled={!actions.dealPath} onClick={() => actions.dealPath && onOpenDeal(entry.relationshipId!)}>{t('liquidityCreateDeal') || 'Create deal'}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ padding: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t('liquidityMatchCounterparties') || 'Match Counterparties'}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={matchSide} onChange={(e) => setMatchSide(e.target.value as 'cash' | 'usdt')}>
            <option value="cash">{t('liquidityNeedCash') || 'Need cash'}</option>
            <option value="usdt">{t('liquidityNeedUsdt') || 'Need USDT'}</option>
          </select>
          <input className="inputBox" style={{ width: 140 }} value={matchAmount} onChange={(e) => setMatchAmount(e.target.value)} placeholder={t('liquidityRequestedAmount') || 'Requested amount'} />
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('liquiditySortHint') || 'Sorted by sufficiency, relationship, freshness.'}</div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          {ranked.slice(0, 5).map((entry, idx) => (
            <div key={`${entry.merchantId}-${idx}`} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>{idx + 1}. {entry.merchantName}</strong>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{entry.relationshipStatus} · {entry.region || (t('liquidityRegionNA') || 'region n/a')}</div>
              </div>
              <div>{matchSide === 'cash' ? renderAmount(entry.cash) : renderAmount(entry.usdt)}</div>
            </div>
          ))}
          {ranked.length === 0 && <div className="empty"><div className="empty-s">{t('liquidityNoCounterparties') || 'No counterparties currently available.'}</div></div>}
        </div>
      </div>

      <div className="panel" style={{ padding: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{t('liquidityMyLiquidity') || 'My Liquidity'}</div>
          <span className="pill">{t('liquidityInternalCashBasis') || 'Internal cash basis'}: {fmtU(internal?.cashAvailable || 0)}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 10 }}>
          <SideEditor
            label={t('cash') || 'Cash'}
            enabled={draft.publishCashEnabled}
            mode={draft.cashPublishMode}
            exactAmount={draft.publishedCashAmount}
            rangeMin={draft.cashRangeMin}
            rangeMax={draft.cashRangeMax}
            status={draft.cashStatus}
            reserveBuffer={draft.reserveBufferCash}
            onEnabledChange={(v) => setDraft((s) => s ? ({ ...s, publishCashEnabled: v }) : s)}
            onModeChange={(v) => setDraft((s) => s ? ({ ...s, cashPublishMode: v }) : s)}
            onExactChange={(v) => setDraft((s) => s ? ({ ...s, publishedCashAmount: v }) : s)}
            onRangeMinChange={(v) => setDraft((s) => s ? ({ ...s, cashRangeMin: v }) : s)}
            onRangeMaxChange={(v) => setDraft((s) => s ? ({ ...s, cashRangeMax: v }) : s)}
            onStatusChange={(v) => setDraft((s) => s ? ({ ...s, cashStatus: v }) : s)}
            onReserveBufferChange={(v) => setDraft((s) => s ? ({ ...s, reserveBufferCash: v }) : s)}
          />

          <SideEditor
            label={t('usdt') || 'USDT'}
            enabled={draft.publishUsdtEnabled}
            mode={draft.usdtPublishMode}
            exactAmount={draft.publishedUsdtAmount}
            rangeMin={draft.usdtRangeMin}
            rangeMax={draft.usdtRangeMax}
            status={draft.usdtStatus}
            reserveBuffer={draft.reserveBufferUsdt}
            onEnabledChange={(v) => setDraft((s) => s ? ({ ...s, publishUsdtEnabled: v }) : s)}
            onModeChange={(v) => setDraft((s) => s ? ({ ...s, usdtPublishMode: v }) : s)}
            onExactChange={(v) => setDraft((s) => s ? ({ ...s, publishedUsdtAmount: v }) : s)}
            onRangeMinChange={(v) => setDraft((s) => s ? ({ ...s, usdtRangeMin: v }) : s)}
            onRangeMaxChange={(v) => setDraft((s) => s ? ({ ...s, usdtRangeMax: v }) : s)}
            onStatusChange={(v) => setDraft((s) => s ? ({ ...s, usdtStatus: v }) : s)}
            onReserveBufferChange={(v) => setDraft((s) => s ? ({ ...s, reserveBufferUsdt: v }) : s)}
          />
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 10 }}><input type="checkbox" checked={draft.autoSyncEnabled} onChange={(e) => setDraft((s) => s ? ({ ...s, autoSyncEnabled: e.target.checked }) : s)} /> {t('liquidityAutoSync') || 'Auto-sync from internal basis'}</label>
          <label style={{ fontSize: 10 }}>
            {t('liquidityVisibility') || 'Visibility'}
            <select value={draft.visibilityScope} onChange={(e) => setDraft((s) => s ? ({ ...s, visibilityScope: e.target.value as 'relationships' | 'network' }) : s)} style={{ marginLeft: 4 }}>
              <option value="relationships">{t('liquidityRelationshipsOnly') || 'Relationships only'}</option>
              <option value="network">{t('liquidityNetwork') || 'Network'}</option>
            </select>
          </label>
          <label style={{ fontSize: 10 }}>
            {t('expires') || 'Expires'}
            <input type="datetime-local" value={draft.expiresAt ? draft.expiresAt.slice(0, 16) : ''} onChange={(e) => setDraft((s) => s ? ({ ...s, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null }) : s)} style={{ marginLeft: 4 }} />
          </label>
          <button className="btn" onClick={save} disabled={isSaving}>{isSaving ? (t('saving') || 'Saving…') : (t('liquidityPublishButton') || 'Publish liquidity')}</button>
        </div>
      </div>
    </div>
  );
}

interface SideEditorProps {
  label: string;
  enabled: boolean;
  mode: LiquidityPublishMode;
  exactAmount: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
  status: LiquidityStatus;
  reserveBuffer: number;
  onEnabledChange: (value: boolean) => void;
  onModeChange: (value: LiquidityPublishMode) => void;
  onExactChange: (value: number | null) => void;
  onRangeMinChange: (value: number | null) => void;
  onRangeMaxChange: (value: number | null) => void;
  onStatusChange: (value: LiquidityStatus) => void;
  onReserveBufferChange: (value: number) => void;
}

function SideEditor(props: SideEditorProps) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ fontWeight: 700 }}>{props.label}</div>
        <label style={{ fontSize: 10 }}>
          <input type="checkbox" checked={props.enabled} onChange={(e) => props.onEnabledChange(e.target.checked)} /> {t('liquidityPublish') || 'Publish'}
        </label>
      </div>

      <label style={{ fontSize: 10 }}>
        {t('liquidityMode') || 'Mode'}
        <select value={props.mode} onChange={(e) => props.onModeChange(e.target.value as LiquidityPublishMode)} style={{ marginLeft: 6 }}>
            <option value="status">{t('liquidityStatusOnly') || 'Status only'}</option>
            <option value="range">{t('liquidityRange') || 'Range'}</option>
            <option value="exact">{t('liquidityExactAmount') || 'Exact amount'}</option>
          </select>
        </label>

      {props.mode === 'exact' && (
        <label style={{ fontSize: 10 }}>
          {t('liquidityPublishedAmount') || 'Published amount'}
          <input className="inputBox" value={String(props.exactAmount ?? '')} onChange={(e) => props.onExactChange(e.target.value ? Number(e.target.value) : null)} style={{ marginLeft: 6 }} />
        </label>
      )}

      {props.mode === 'range' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 10 }}>{t('liquidityMin') || 'Min'} <input className="inputBox" value={String(props.rangeMin ?? '')} onChange={(e) => props.onRangeMinChange(e.target.value ? Number(e.target.value) : null)} style={{ marginLeft: 4, width: 90 }} /></label>
          <label style={{ fontSize: 10 }}>{t('liquidityMax') || 'Max'} <input className="inputBox" value={String(props.rangeMax ?? '')} onChange={(e) => props.onRangeMaxChange(e.target.value ? Number(e.target.value) : null)} style={{ marginLeft: 4, width: 90 }} /></label>
        </div>
      )}

      {props.mode === 'status' && (
        <label style={{ fontSize: 10 }}>
          {t('status') || 'Status'}
          <select value={props.status} onChange={(e) => props.onStatusChange(e.target.value as LiquidityStatus)} style={{ marginLeft: 6 }}>
            {statusOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 'available'
                  ? (t('liquidityStatusAvailable') || 'Available')
                  : opt === 'limited'
                    ? (t('liquidityStatusLimited') || 'Limited')
                    : (t('liquidityStatusUnavailable') || 'Unavailable')}
              </option>
            ))}
          </select>
        </label>
      )}

      <label style={{ fontSize: 10 }}>
        {t('liquidityReserveBuffer') || 'Reserve buffer'}
        <input className="inputBox" value={String(props.reserveBuffer || '')} onChange={(e) => props.onReserveBufferChange(Number(e.target.value) || 0)} style={{ marginLeft: 6, width: 120 }} />
      </label>
    </div>
  );
}
