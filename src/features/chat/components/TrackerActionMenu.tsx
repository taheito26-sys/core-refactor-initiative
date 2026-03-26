interface Props {
  onCreateOrder: () => void;
  onCreateTask: () => void;
}

export function TrackerActionMenu({ onCreateOrder, onCreateTask }: Props) {
  return (
    <div className="inline-flex gap-1">
      <button className="text-[11px] rounded border px-1.5" onClick={onCreateOrder}>Order</button>
      <button className="text-[11px] rounded border px-1.5" onClick={onCreateTask}>Task</button>
    </div>
  );
}
