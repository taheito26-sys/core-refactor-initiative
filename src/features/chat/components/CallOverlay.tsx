// ─── CallOverlay ─────────────────────────────────────────────────────────
// Phase 4: One-to-one voice call UI for merchant_private rooms
import { Phone, PhoneOff, Mic, MicOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { CallState } from '../hooks/useWebRTC';

interface CallOverlayWebRTC {
  callState: CallState;
  incomingCall: unknown;
  isMuted: boolean;
  answerIncoming: () => void;
  declineIncoming: () => void;
  hangUp: () => void;
  toggleMute: () => void;
}

interface Props {
  webrtc: CallOverlayWebRTC;
}

const STATE_LABELS: Record<string, string> = {
  idle:         '',
  calling:      'Calling...',
  ringing:      'Incoming call',
  connected:    'In call',
  reconnecting: 'Reconnecting...',
  ended:        'Call ended',
  failed:       'Call failed',
};

export function CallOverlay({ webrtc }: Props) {
  const { callState, incomingCall, isMuted, answerIncoming, declineIncoming, hangUp, toggleMute } = webrtc;

  if (callState === 'idle' && !incomingCall) return null;

  const isActive   = callState === 'connected' || callState === 'reconnecting';
  const isCalling  = callState === 'calling';
  const isIncoming = !!incomingCall && callState === 'idle';

  return (
    <div className="absolute inset-x-0 top-4 flex justify-center z-50 pointer-events-none">
      <div className={cn(
        'pointer-events-auto flex items-center gap-4 px-6 py-3 rounded-2xl shadow-2xl border backdrop-blur-sm',
        isActive
          ? 'bg-emerald-950/90 border-emerald-700/40 text-emerald-100'
          : isIncoming
          ? 'bg-violet-950/90 border-violet-700/40 text-violet-100'
          : isCalling
          ? 'bg-card/95 border-border text-foreground'
          : 'bg-card/95 border-border text-foreground',
      )}>
        {/* Status */}
        <div className="flex items-center gap-2">
          {(isActive || callState === 'reconnecting') && (
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
          <span className="text-sm font-semibold">
            {STATE_LABELS[callState] || callState}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {isIncoming && (
            <>
              <Button
                size="sm"
                className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl"
                onClick={answerIncoming}
              >
                <Phone className="h-4 w-4 mr-1" /> Answer
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 px-3 rounded-xl"
                onClick={declineIncoming}
              >
                <PhoneOff className="h-4 w-4 mr-1" /> Decline
              </Button>
            </>
          )}

          {isActive && (
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                'h-8 w-8 rounded-full',
                isMuted ? 'bg-destructive/20 text-destructive' : 'text-emerald-300 hover:text-white',
              )}
              onClick={toggleMute}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          )}

          {(isActive || isCalling || callState === 'reconnecting') && (
            <Button
              size="icon"
              variant="destructive"
              className="h-8 w-8 rounded-full"
              onClick={hangUp}
            >
              <PhoneOff className="h-4 w-4" />
            </Button>
          )}

          {(callState === 'ended' || callState === 'failed') && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-full"
              onClick={() => { /* handled by callState going to idle */ }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
