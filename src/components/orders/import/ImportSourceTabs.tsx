import type { LedgerSourceType } from '@/types/ledgerImport';

const OPTIONS: Array<{ key: LedgerSourceType; label: string }> = [
  { key: 'pasted_text', label: 'Paste Text' },
  { key: 'text_file', label: 'Upload Text File' },
  { key: 'spreadsheet', label: 'Upload Spreadsheet' },
  { key: 'image', label: 'Upload Photo' },
];

interface Props {
  value: LedgerSourceType;
  onChange: (value: LedgerSourceType) => void;
}

export function ImportSourceTabs({ value, onChange }: Props) {
  return (
    <div className="orders-tab-bar">
      {OPTIONS.map((option) => (
        <button
          key={option.key}
          className={`orders-tab-btn ${value === option.key ? 'active' : ''}`}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
