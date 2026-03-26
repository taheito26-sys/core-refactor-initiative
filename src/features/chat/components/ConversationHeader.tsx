interface Props {
  title?: string;
  name?: string;
  nickname?: string;
  restricted?: boolean;
  onStartCall?: () => void;
  onCallClick?: () => void;
  onBack?: () => void;
  onSearchToggle?: () => void;
  onToggleLayout?: () => void;
}

export function ConversationHeader({ title, name, restricted, onStartCall, onCallClick }: Props) {
  const headerTitle = title || name || 'Conversation';
  return (
    <header className="border-b border-border px-4 py-3 flex items-center justify-between bg-background/80 backdrop-blur-sm">
      <div>
        <div className="text-sm font-semibold">{headerTitle}</div>
        {restricted && <div className="text-[11px] text-destructive">Restricted room policy enabled</div>}
      </div>
      <div className="flex items-center gap-2">
        <button className="rounded-md border px-3 py-1.5 text-xs" onClick={() => (onStartCall || onCallClick)?.()}>Start Call</button>
      </div>
    </header>
  );
}
