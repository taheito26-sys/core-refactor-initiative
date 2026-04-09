// ─── CallOverlay — Production in-call UI ────────────────────────────────
// Mobile-safe, video support, duration timer, proper state feedback
import {
  Phone, PhoneOff, PhoneIncoming, PhoneMissed,
  Mic, MicOff, Video, VideoOff, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRef, useEffect } from 'react';
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
    callState, isMuted, isVideoEnabled, isVideoCall, callDuration, endReason,
    localStream, remoteStream,
    answerIncoming, declineIncoming, hangUp, toggleMute, toggleVideo,
  } = webrtc;
  const isMobile = useIsMobile();

  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Bind streams to video elements
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  if (callState === 'idle') return null;

  const isActive     = callState === 'connected' || callState === 'reconnecting';
  const isCalling    = callState === 'calling';
  const isRinging    = callState === 'ringing';
  const isConnecting = callState === 'connecting';
  const isTerminal   = ['ended', 'failed', 'missed', 'declined'].includes(callState);

  const showVideo = isVideoCall && (isActive || isConnecting);

  // Full-screen video call layout
  if (showVideo) {
    return (
      <div className="absolute inset-0 z-50 bg-black flex flex-col">
        {/* Remote video (full) */}
        <div className="flex-1 relative">
          {remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted/20">
              <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Local video (picture-in-picture) */}
          {localStream && isVideoEnabled && (
            <div className={cn(
              'absolute rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl',
              isMobile ? 'bottom-24 right-3 w-24 h-32' : 'bottom-20 right-4 w-32 h-44',
            )}>
              <video
                ref={localVideoRef}
                autoPlay playsInline muted
                className="w-full h-full object-cover mirror"
                style={{ transform: 'scaleX(-1)' }}
              />
            </div>
          )}

          {/* Status bar */}
          <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/60 to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isActive && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
                <span className="text-white text-sm font-bold">
                  {STATE_LABELS[callState]}
                </span>
              </div>
              {isActive && (
                <span className="text-white/80 text-sm font-mono">
                  {formatDuration(callDuration)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Controls bar */}
        <div className="bg-black/90 backdrop-blur-md px-6 py-4 flex items-center justify-center gap-4 safe-area-bottom">
          <button
            onClick={toggleMute}
            className={cn(
              'h-12 w-12 rounded-full flex items-center justify-center transition-colors active:scale-95',
              isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white',
            )}
          >
            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          <button
            onClick={toggleVideo}
            className={cn(
              'h-12 w-12 rounded-full flex items-center justify-center transition-colors active:scale-95',
              !isVideoEnabled ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white',
            )}
          >
            {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </button>

          <button
            onClick={hangUp}
            className="h-14 w-14 rounded-full bg-destructive text-white flex items-center justify-center shadow-lg shadow-red-500/30 active:scale-95 transition-transform"
          >
            <PhoneOff className="h-6 w-6" />
          </button>
        </div>
      </div>
    );
  }

  // Audio-only overlay bar
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
          {callState === 'missed' && <PhoneMissed className="h-5 w-5 text-amber-400" />}
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

          {isActive && (
            <>
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
              <button
                onClick={toggleVideo}
                className={cn(
                  'h-9 w-9 rounded-full flex items-center justify-center transition-colors active:scale-95',
                  'bg-emerald-800/50 text-emerald-300 hover:bg-emerald-800/80',
                )}
                title="Toggle video"
              >
                {isVideoEnabled ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
              </button>
            </>
          )}

          {(isCalling || isConnecting || isActive) && (
            <button
              onClick={hangUp}
              className="h-10 w-10 rounded-full bg-destructive hover:bg-destructive/80 text-destructive-foreground flex items-center justify-center transition-colors shadow-lg shadow-destructive/30 active:scale-95"
              title="End call"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          )}

          {isTerminal && (
            <button
              onClick={() => hangUp()}
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
