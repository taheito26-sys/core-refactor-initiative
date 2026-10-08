import { useT } from '@/lib/i18n';

/**
 * Normal or emergency, for a loaned order. An emergency sale is one the buyer
 * needed funded right now, so it was sold at the emergency price instead of
 * the normal one; the buyer's portal marks it with a red tag.
 */
export function SaleTypeToggle({
  emergency,
  onChange,
  disabled = false,
}: {
  emergency: boolean;
  onChange: (emergency: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const option = (value: boolean, label: string) => {
    const active = emergency === value;
    const color = value ? 'var(--bad)' : 'var(--brand)';
    return (
      <button
        type="button"
        disabled={disabled}
        aria-pressed={active}
        onClick={() => onChange(value)}
        style={{
          flex: 1, padding: '6px 8px', fontSize: 11, fontWeight: 700, borderRadius: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          border: `1px solid ${active ? color : 'var(--line)'}`,
          background: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent',
          color: active ? color : 'var(--muted)',
        }}
      >
        {value ? '🚨 ' : ''}{label}
      </button>
    );
  };
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {option(false, t('saleTypeNormal'))}
        {option(true, t('saleTypeEmergency'))}
      </div>
      {emergency && (
        <div style={{ fontSize: 9, color: 'var(--bad)', marginTop: 4, lineHeight: 1.5 }}>{t('saleTypeEmergencyHint')}</div>
      )}
    </div>
  );
}
