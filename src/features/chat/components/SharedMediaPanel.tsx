interface Props {
  attachments: Array<{ id: string; file_name?: string | null; kind?: string | null }>;
}

export function SharedMediaPanel({ attachments }: Props) {
  return (
    <section className="border rounded-md p-3 bg-card">
      <h3 className="text-xs font-semibold mb-2">Shared Media</h3>
      <div className="space-y-1">
        {attachments.length === 0 && <div className="text-[11px] text-muted-foreground">No shared files</div>}
        {attachments.map((a) => (
          <div key={a.id} className="text-xs border rounded px-2 py-1">{a.file_name || a.id} ({a.kind || 'file'})</div>
        ))}
      </div>
    </section>
  );
}
