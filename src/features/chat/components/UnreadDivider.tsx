/* ═══════════════════════════════════════════════════════════════
   UnreadDivider — visual separator showing unread message count
   ═══════════════════════════════════════════════════════════════ */

interface Props {
  count: number;
}

export function UnreadDivider({ count }: Props) {
  return (
    <div className="relative my-10 px-12 flex items-center gap-6 animate-in fade-in duration-700">
      <div className="flex-1 h-[1px] bg-slate-100" />
      <span className="text-[12px] font-black text-rose-500 uppercase tracking-[0.2em]">{count} unread messages</span>
      <div className="flex-1 h-[1px] bg-transparent" />
    </div>
  );
}
