import type { LedgerNetworkMerchant } from '@/types/ledgerImport';

interface Props {
  merchants: LedgerNetworkMerchant[];
  selectedRelationshipId: string;
  onSelect: (value: string) => void;
}

export function MerchantNetworkSelector({ merchants, selectedRelationshipId, onSelect }: Props) {
  if (merchants.length === 0) {
    return <div className="empty-s">No network merchants available. Create/activate a relationship first.</div>;
  }

  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Counterparty merchant (network only)</span>
      <select className="inp" value={selectedRelationshipId} onChange={(e) => onSelect(e.target.value)}>
        <option value="">Select merchant...</option>
        {merchants.map((merchant) => (
          <option key={merchant.relationshipId} value={merchant.relationshipId}>
            {merchant.merchantName}
          </option>
        ))}
      </select>
    </label>
  );
}
