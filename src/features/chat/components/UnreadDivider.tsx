interface Props {
  count: number;
}

export function UnreadDivider({ count }: Props) {
  return (
    <div className="relative my-3">
      <div className="h-px bg-border" />
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-background px-2 text-[11px] text-muted-foreground">
        {count} unread
      </div>
    </div>
  );
}
