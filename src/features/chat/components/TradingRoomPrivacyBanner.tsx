// ─── TradingRoomPrivacyBanner — Theme-aware top privacy watermark ─────────
// Mandatory privacy banner for Qatar P2P Market and trading rooms.
// Always renders opposite-contrast watermark relative to the active theme.

import { useMemo } from 'react';
import { Shield, Eye } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';

interface Props {
  roomName?: string | null;
  className?: string;
}

/**
 * Placement: Above message list, below ConversationHeader.
 * Styling logic:
 *   - Dark theme → light watermark text (foreground token)
 *   - Light theme → dark watermark text (foreground token)
 *   - Uses semantic tokens so contrast auto-adapts.
 *   - Background uses a low-opacity foreground wash for guaranteed contrast.
 * Accessibility: text is aria-hidden since it's decorative security signaling.
 */
export function TradingRoomPrivacyBanner({ roomName, className }: Props) {
  const { userId } = useAuth();

  const traceId = useMemo(() => {
    const id = userId?.slice(0, 6) ?? '000000';
    const ts = Date.now().toString(36).slice(-4).toUpperCase();
    return `${id}·${ts}`;
  }, [userId]);

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden select-none',
        // Guaranteed contrast: foreground/5 bg = always opposite of theme
        'bg-foreground/[0.04] border-b border-foreground/[0.06]',
        className,
      )}
      aria-hidden="true"
    >
      {/* Main banner content */}
      <div className="flex items-center justify-between px-3 md:px-4 py-1.5 gap-3">
        {/* Left: Security badge */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-foreground/[0.07] shrink-0">
            <Shield className="w-3 h-3 text-foreground/50" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold tracking-[0.08em] uppercase text-foreground/40 leading-tight truncate">
              Private Trading Environment
            </span>
            <span className="text-[9px] font-mono text-foreground/25 leading-tight truncate">
              Monitored · All activity is logged · {traceId}
            </span>
          </div>
        </div>

        {/* Right: Surveillance indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Eye className="w-3 h-3 text-foreground/25" />
          <span className="text-[9px] font-mono font-semibold text-foreground/25 hidden sm:inline">
            TRACED
          </span>
        </div>
      </div>

      {/* Repeating diagonal watermark overlay across the banner */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ opacity: 0.025 }}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="trading-privacy-wm"
              x="0" y="0"
              width="200" height="30"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-15)"
            >
              <text
                x="0" y="20"
                fontFamily="monospace"
                fontSize="8"
                fontWeight="bold"
                className="fill-foreground"
                fill="currentColor"
              >
                CONFIDENTIAL · {traceId} · MONITORED
              </text>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#trading-privacy-wm)" className="text-foreground" />
        </svg>
      </div>
    </div>
  );
}
