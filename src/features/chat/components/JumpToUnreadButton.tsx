import { ChevronDown } from 'lucide-react';

interface Props {
  visible: boolean;
  onClick: () => void;
}

export function JumpToUnreadButton({ visible, onClick }: Props) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all flex items-center gap-2"
    >
      <ChevronDown size={14} /> New Messages
    </button>
  );
}
