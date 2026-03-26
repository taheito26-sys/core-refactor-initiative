interface Props {
  value: {
    disable_forward: boolean;
    disable_copy: boolean;
    disable_export: boolean;
    disable_attachment_download: boolean;
    restricted_badge: boolean;
    watermark_enabled: boolean;
  };
  onChange: (next: Partial<Props['value']>) => void;
  onSave: () => void;
}

export function PolicyCenterPanel({ value, onChange, onSave }: Props) {
  const rows: Array<{ key: keyof Props['value']; label: string }> = [
    { key: 'disable_forward', label: 'Disable forward' },
    { key: 'disable_copy', label: 'Disable copy' },
    { key: 'disable_export', label: 'Disable export' },
    { key: 'disable_attachment_download', label: 'Disable downloads' },
    { key: 'restricted_badge', label: 'Restricted badge' },
    { key: 'watermark_enabled', label: 'Watermark' },
  ];

  return (
    <section className="border rounded-md p-3 bg-card">
      <h3 className="text-xs font-semibold mb-2">Policy Center</h3>
      <div className="space-y-1">
        {rows.map((row) => (
          <label key={row.key} className="flex items-center justify-between text-xs">
            <span>{row.label}</span>
            <input
              type="checkbox"
              checked={value[row.key]}
              onChange={(e) => onChange({ [row.key]: e.target.checked })}
            />
          </label>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground mt-2">
        Screenshot blocking is not technically enforceable in browsers; this policy uses best-effort deterrence only.
      </div>
      <button className="rounded border px-2 py-1 text-xs mt-2" onClick={onSave}>Apply Policy</button>
    </section>
  );
}
