import { useState } from 'react';

interface Props {
  onSearch: (query: string) => void;
}

export function RoomSearchPanel({ onSearch }: Props) {
  const [q, setQ] = useState('');
  return (
    <section className="border rounded-md p-3 bg-card">
      <h3 className="text-xs font-semibold mb-2">Room Search</h3>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 rounded border px-2 py-1 text-xs" placeholder="Search in room" />
        <button className="rounded border px-2 text-xs" onClick={() => onSearch(q)}>Go</button>
      </div>
    </section>
  );
}
