/* ═══════════════════════════════════════════════════════════════
   UnreadDivider — visual separator showing unread message count
   ═══════════════════════════════════════════════════════════════ */

interface Props {
  count: number;
}

export function UnreadDivider({ count }: Props) {
  return (
    <div className="relative my-3 px-4 flex items-center gap-3 animate-in fade-in duration-500">
      <div className="flex-1 h-[1px] bg-primary/20" />
      <span className="px-3 py-1 rounded-full bg-primary/10 text-[11px] font-bold text-primary uppercase tracking-wide">
        {count} unread {count === 1 ? 'message' : 'messages'}
      </span>
      <div className="flex-1 h-[1px] bg-primary/20" />
    </div>
  );
}
