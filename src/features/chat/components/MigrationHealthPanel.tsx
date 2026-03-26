interface Props {
  health: Record<string, unknown> | undefined;
  onDryRun: () => void;
  onMigrate: () => void;
  running: boolean;
}

export function MigrationHealthPanel({ health, onDryRun, onMigrate, running }: Props) {
  return (
    <section className="border rounded-md p-3 bg-card">
      <h3 className="text-xs font-semibold mb-2">Migration Health</h3>
      <pre className="text-[10px] bg-muted rounded p-2 overflow-auto max-h-28">{JSON.stringify(health ?? {}, null, 2)}</pre>
      <div className="mt-2 flex gap-2">
        <button disabled={running} className="rounded border px-2 py-1 text-xs" onClick={onDryRun}>Dry Run</button>
        <button disabled={running} className="rounded border px-2 py-1 text-xs" onClick={onMigrate}>Run Migration</button>
      </div>
    </section>
  );
}
