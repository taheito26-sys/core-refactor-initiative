// ─── TypingIndicator — WhatsApp-style ghost bubble with bouncing dots ──────
// Phase 20: Replaces plain text with animated dots in a mini chat bubble

import { cn } from '@/lib/utils';

interface Props {
  users: string[];
}

export function TypingIndicator({ users }: Props) {
  if (users.length === 0) return null;

  const label = users.length === 1
    ? `${users[0]} is typing`
    : users.length === 2
    ? `${users[0]} and ${users[1]} are typing`
    : `${users[0]} and ${users.length - 1} others are typing`;

  return (
    <div className="flex justify-start px-2 sm:px-4 mt-1 mb-1">
      <div className="max-w-[85%] sm:max-w-[65%]">
        <div className="px-3 py-2.5 rounded-lg rounded-tl-[4px] bg-card shadow-sm">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-[3px]">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block h-[7px] w-[7px] rounded-full bg-muted-foreground/50"
                  style={{
                    animation: `typing-bounce 1.4s ${i * 0.16}s ease-in-out infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5 px-1 truncate">
          {label}
        </p>
      </div>
      <style>{`
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
