import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  qatarRates: { sellAvg: number; buyAvg: number } | null;
  egyptAverages: { vCashBuyAvg: number | null; instaBuyAvg: number | null } | null;
}

export function EgyptMarketKPIs({ qatarRates, egyptAverages }: Props) {
  const [overrideStr, setOverrideStr] = useState('');
  const override = parseFloat(overrideStr);
  const isOverrideValid = Number.isFinite(override) && override > 0;

  if (!qatarRates || !egyptAverages) return null;

  const { sellAvg: qaSell, buyAvg: qaBuy } = qatarRates;
  const { vCashBuyAvg, instaBuyAvg } = egyptAverages;

  // VCash V1: QA Sell average ÷ EG Buy top 20 (Vodafone Cash)
  const vCashV1 = vCashBuyAvg ? qaSell / vCashBuyAvg : null;
  // VCash V2: QA Buy average ÷ EG Buy top 20 (Vodafone Cash)
  const vCashV2 = vCashBuyAvg ? qaBuy / vCashBuyAvg : null;

  // InstaPay V1: QA Sell average ÷ EG Buy top 20 (InstaPay/Bank) - supports override
  const instaDenominator = isOverrideValid ? override : instaBuyAvg;
  const instaPayV1 = instaDenominator ? qaSell / instaDenominator : null;
  // InstaPay V2: QA Buy average ÷ EG Buy top 20 (InstaPay/Bank)
  const instaPayV2 = instaBuyAvg ? qaBuy / instaBuyAvg : null;

  const Card = ({ label, value, tint }: { label: string; value: number | null; tint: string }) => (
    <div style={{
      padding: '12px', background: 'var(--tracker-panel)', border: '1px solid var(--tracker-line)',
      borderRadius: 'var(--lt-radius)', boxShadow: 'var(--lt-shadow)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', color: tint, letterSpacing: '.1em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--lt-font-mono)', color: 'var(--tracker-text)' }}>
        {value ? value.toFixed(4) : '—'}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <Card label="VCash V1" value={vCashV1} tint="var(--tracker-brand)" />
        <Card label="VCash V2" value={vCashV2} tint="var(--tracker-brand)" />
        <Card label="InstaPay V1" value={instaPayV1} tint="var(--tracker-good)" />
        <Card label="InstaPay V2" value={instaPayV2} tint="var(--tracker-good)" />
      </div>

      <div style={{ 
        padding: '10px 14px', borderRadius: 8, border: '1px solid var(--tracker-line)',
        background: 'color-mix(in srgb, var(--tracker-good) 5%, var(--tracker-panel))',
        display: 'flex', alignItems: 'center', gap: 12
      }}>
        <div style={{ flex: 1 }}>
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">EGY Average Buy Override</Label>
          <p className="text-[9px] text-muted-foreground leading-tight">Affects InstaPay V1 calculation only. Computed average: {instaBuyAvg?.toFixed(2) || '—'}</p>
        </div>
        <div style={{ width: 120 }}>
          <Input 
            type="number" 
            value={overrideStr} 
            onChange={e => setOverrideStr(e.target.value)}
            placeholder="0.00"
            className="h-8 font-black font-mono text-xs"
          />
        </div>
      </div>
    </div>
  );
}