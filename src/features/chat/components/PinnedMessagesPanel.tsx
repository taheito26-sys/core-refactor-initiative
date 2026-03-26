interface Props {
  pinned: Array<{ message_id: string; pinned_at: string }>;
  onJump: (messageId: string) => void;
}

export function PinnedMessagesPanel({ pinned, onJump }: Props) {
  return (
    <section className="border rounded-md p-3 bg-card">
      <h3 className="text-xs font-semibold mb-2">Pinned Messages</h3>
      <div className="space-y-1">
        {pinned.length === 0 && <div className="text-[11px] text-muted-foreground">No pinned messages</div>}
        {pinned.map((p) => (
          <button key={p.message_id} className="w-full text-left text-xs border rounded px-2 py-1" onClick={() => onJump(p.message_id)}>
            {p.message_id}
          </button>
        ))}
      </div>
    </section>
  );
}
