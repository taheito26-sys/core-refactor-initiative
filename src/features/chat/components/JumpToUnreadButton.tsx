interface Props {
  visible: boolean;
  onClick: () => void;
}

export function JumpToUnreadButton({ visible, onClick }: Props) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      className="absolute bottom-20 right-4 rounded-full border bg-background px-3 py-2 text-xs shadow"
    >
      Jump to unread
    </button>
  );
}
