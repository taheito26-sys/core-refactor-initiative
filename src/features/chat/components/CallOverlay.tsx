// ─── CallOverlay — Production in-call UI ────────────────────────────────
// Mobile-safe, clear states, duration timer, proper controls
import { Phone, PhoneOff, PhoneIncoming, PhoneMissed, Mic, MicOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import type { UseWebRTCReturn } from '../hooks/useWebRTC';

interface Props {
  webrtc: UseWebRTCReturn;
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

const STATE_LABELS: Record<string, string> = {
  idle:         '',
  calling:      'Calling…',
  ringing:      'Incoming call',
  connecting:   'Connecting…',
  connected:    'In call',
  reconnecting: 'Reconnecting…',
  ended:        'Call ended',
  failed:       'Call failed',
  missed:       'Missed call',
  declined:     'Call declined',
};

export function CallOverlay({ webrtc }: Props) {
  const {
    callState, incomingCall, isMuted, callDuration, endReason,
    answerIncoming, declineIncoming, hangUp, toggleMute,
  } = webrtc;
  const isMobile = useIsMobile();

  if (callState === 'idle') return null;

  const isActive     = callState === 'connected' || callState === 'reconnecting';
  const isCalling    = callState === 'calling';
  const isRinging    = callState === 'ringing';
  const isConnecting = callState === 'connecting';
  const isTerminal   = callState === 'ended' || callState === 'failed' || callState === 'missed' || callState === 'declined';

  return (
    <div className={cn(
      'absolute inset-x-0 top-0 flex justify-center z-50 pointer-events-none',
      isMobile ? 'px-2 pt-2' : 'px-4 pt-4',
    )}>
      <div className={cn(
        'pointer-events-auto flex items-center gap-3 rounded-2xl shadow-2xl border backdrop-blur-md transition-all duration-300',
        isMobile ? 'px-4 py-3 w-full max-w-sm' : 'px-6 py-3',
        isActive
          ? 'bg-emerald-950/90 border-emerald-700/40 text-emerald-100'
          : isRinging
          ? 'bg-violet-950/90 border-violet-700/40 text-violet-100 animate-pulse'
          : isTerminal
          ? 'bg-muted/95 border-border text-muted-foreground'
          : 'bg-card/95 border-border text-foreground',
      )}>
        {/* Status icon */}
        <div className="shrink-0">
          {isActive && <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />}
          {isRinging && <PhoneIncoming className="h-5 w-5 text-violet-400" />}
          {(callState === 'missed') && <PhoneMissed className="h-5 w-5 text-amber-400" />}
          {(isCalling || isConnecting) && (
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* Label + duration */}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-bold truncate">
            {STATE_LABELS[callState] || callState}
          </span>
          {isActive && (
            <span className="text-xs font-mono opacity-80">
              {formatDuration(callDuration)}
            </span>
          )}
          {isTerminal && endReason && endReason !== callState && (
            <span className="text-[10px] opacity-60 truncate">{endReason.replace(/_/g, ' ')}</span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Incoming: answer + decline */}
          {isRinging && (
            <>
              <button
                onClick={answerIncoming}
                className="h-10 w-10 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center transition-colors shadow-lg shadow-emerald-600/30 active:scale-95"
                title="Answer"
              >
                <Phone className="h-5 w-5" />
              </button>
              <button
                onClick={declineIncoming}
                className="h-10 w-10 rounded-full bg-destructive hover:bg-destructive/80 text-destructive-foreground flex items-center justify-center transition-colors active:scale-95"
                title="Decline"
              >
                <PhoneOff className="h-5 w-5" />
              </button>
            </>
          )}

          {/* Active: mute + hangup */}
          {isActive && (
            <button
              onClick={toggleMute}
              className={cn(
                'h-9 w-9 rounded-full flex items-center justify-center transition-colors active:scale-95',
                isMuted
                  ? 'bg-destructive/20 text-destructive hover:bg-destructive/30'
                  : 'bg-emerald-800/50 text-emerald-300 hover:bg-emerald-800/80',
              )}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}

          {/* Hangup — for calling, connecting, active, reconnecting */}
          {(isCalling || isConnecting || isActive) && (
            <button
              onClick={hangUp}
              className="h-10 w-10 rounded-full bg-destructive hover:bg-destructive/80 text-destructive-foreground flex items-center justify-center transition-colors shadow-lg shadow-destructive/30 active:scale-95"
              title="End call"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          )}

          {/* Terminal: dismiss */}
          {isTerminal && (
            <button
              onClick={() => {
                // Force back to idle
                webrtc.hangUp();
              }}
              className="h-8 w-8 rounded-full bg-muted hover:bg-accent text-muted-foreground flex items-center justify-center transition-colors active:scale-95"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
