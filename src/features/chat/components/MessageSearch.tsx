// ─── MessageSearch — Phase 9: Search messages within a conversation ───────
import { forwardRef, useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import type { ChatMessage } from '../types';

interface Props {
  messages: ChatMessage[];
  onJumpTo: (messageId: string) => void;
  onClose: () => void;
}

export const MessageSearch = forwardRef<HTMLDivElement, Props>(function MessageSearch({ messages, onJumpTo, onClose }, ref) {
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const matches = query.trim().length >= 2
    ? messages.filter((m) =>
        !m.is_deleted &&
        m.type !== 'system' &&
        m.content.toLowerCase().includes(query.toLowerCase()),
      ).reverse()
    : [];

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Enter' && matches.length > 0) {
      const nextIdx = e.shiftKey
        ? (matchIndex - 1 + matches.length) % matches.length
        : (matchIndex + 1) % matches.length;
      setMatchIndex(nextIdx);
      onJumpTo(matches[nextIdx].id);
    }
  }, [matches, matchIndex, onClose, onJumpTo]);

  useEffect(() => {
    if (matches.length > 0) {
      onJumpTo(matches[matchIndex]?.id ?? matches[0].id);
    }
  }, [matches, matchIndex, onJumpTo]);

  const goUp = useCallback(() => {
    if (matches.length === 0) return;
    const idx = (matchIndex + 1) % matches.length;
    setMatchIndex(idx);
    onJumpTo(matches[idx].id);
  }, [matches, matchIndex, onJumpTo]);

  const goDown = useCallback(() => {
    if (matches.length === 0) return;
    const idx = (matchIndex - 1 + matches.length) % matches.length;
    setMatchIndex(idx);
    onJumpTo(matches[idx].id);
  }, [matches, matchIndex, onJumpTo]);

  return (
    <div ref={ref} className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/95 backdrop-blur-sm animate-in slide-in-from-top-2 duration-150">
      <Search className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setMatchIndex(0); }}
        onKeyDown={handleKeyDown}
        placeholder="Search in conversation..."
        className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/40"
      />
      {query.trim().length >= 2 && (
        <span className="text-[11px] text-muted-foreground/60 shrink-0 font-medium tabular-nums">
          {matches.length > 0 ? `${Math.min(matchIndex + 1, matches.length)}/${matches.length}` : 'No results'}
        </span>
      )}
      <div className="flex items-center gap-0.5 shrink-0">
        <button onClick={goUp} disabled={matches.length === 0}
          className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground disabled:opacity-30 transition-colors">
          <ChevronUp className="h-4 w-4" />
        </button>
        <button onClick={goDown} disabled={matches.length === 0}
          className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground disabled:opacity-30 transition-colors">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <button onClick={onClose}
        className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
});
