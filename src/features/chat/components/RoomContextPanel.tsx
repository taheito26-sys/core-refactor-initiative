interface Props {
  roomTitle: string;
  relationshipId: string | null;
}

export function RoomContextPanel({ roomTitle, relationshipId }: Props) {
  return (
    <section className="border rounded-md p-3 bg-card">
      <h3 className="text-xs font-semibold mb-2">Room Context</h3>
      <div className="text-xs text-muted-foreground">Room: {roomTitle}</div>
      <div className="text-xs text-muted-foreground">Relationship: {relationshipId || 'N/A'}</div>
    </section>
  );
}
