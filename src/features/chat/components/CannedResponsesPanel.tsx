interface Props {
  onSelect: (text: string) => void;
}

const canned = [
  'Acknowledged. I will process this now.',
  'Please confirm the amount and settlement date.',
  'Order draft has been created from this message.',
];

export function CannedResponsesPanel({ onSelect }: Props) {
  return (
    <section className="border rounded-md p-3 bg-card">
      <h3 className="text-xs font-semibold mb-2">Canned Responses</h3>
      <div className="space-y-1">
        {canned.map((msg) => (
          <button key={msg} className="w-full text-left text-xs border rounded px-2 py-1" onClick={() => onSelect(msg)}>
            {msg}
          </button>
        ))}
      </div>
    </section>
  );
}
