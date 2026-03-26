interface Props {
  connected: boolean;
  muted: boolean;
  error: string | null;
  onToggleMute: () => void;
  onLeave: () => void;
}

export function CallPanel({ connected, muted, error, onToggleMute, onLeave }: Props) {
  return (
    <section className="border rounded-md p-3 bg-card">
      <h3 className="text-xs font-semibold mb-2">Call</h3>
      <div className="text-xs text-muted-foreground">State: {connected ? 'Connected' : 'Connecting / idle'}</div>
      {error && <div className="text-xs text-destructive mt-1">{error}</div>}
      <div className="mt-2 flex gap-2">
        <button className="rounded border px-2 py-1 text-xs" onClick={onToggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
        <button className="rounded border px-2 py-1 text-xs" onClick={onLeave}>Leave</button>
      </div>
    </section>
  );
}
