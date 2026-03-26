interface Props {
  history: any[];
}

export function CallHistoryPanel({ history }: Props) {
  return (
    <section className="border rounded-md p-3 bg-card">
      <h3 className="text-xs font-semibold mb-2">Call History</h3>
      <div className="space-y-1 max-h-32 overflow-auto">
        {history.length === 0 && <div className="text-[11px] text-muted-foreground">No calls yet</div>}
        {history.map((call) => (
          <div key={call.call_session_id || call.id} className="text-xs border rounded px-2 py-1">
            {call.status} · {new Date(call.started_at).toLocaleString()}
          </div>
        ))}
      </div>
    </section>
  );
}
