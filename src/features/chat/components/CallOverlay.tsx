// ─── CallOverlay — Production in-call UI ────────────────────────────────
// Mobile-safe, video support, screen sharing, quality indicator, duration timer
// iPhone-style full-screen call UI on mobile when connected.
// Uses a React portal (renders into document.body) so fixed positioning
// is never clipped by overflow:hidden on parent layout containers.
import {
  Phone, PhoneOff, PhoneIncoming, PhoneMissed,
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, X,
  Wifi, WifiOff, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { UseWebRTCReturn, CallQualityStats } from '../hooks/useWebRTC';

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

function QualityBadge({ stats }: { stats: CallQualityStats | null }) {
  if (!stats) return null;
  const colors = { excellent: 'text-emerald-400', good: 'text-amber-400', poor: 'text-red-400' };
  const Icon = stats.level === 'poor' ? WifiOff : Wifi;
  return (
    <div
      className={cn('flex items-center gap-1 text-xs', colors[stats.level])}
      title={`${stats.bitrate}kbps · ${stats.packetLoss}% loss · ${stats.roundTripTime}ms RTT`}
    >
      <Icon className="h-3 w-3" />
      <span className="capitalize">{stats.level}</span>
    </div>
  );
}

export function CallOverlay({ webrtc }: Props) {
  const {
    callState, isMuted, isVideoEnabled, isVideoCall, isScreenSharing,
    callDuration, endReason, localStream, remoteStream, qualityStats,
    answerIncoming, declineIncoming, hangUp, toggleMute, toggleVideo, toggleScreenShare,
  } = webrtc;
  const isMobile = useIsMobile();

  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el) return;
    if (remoteStream) { el.srcObject = remoteStream; el.play().catch(() => {}); }
    else { el.pause(); el.srcObject = null; }
  }, [remoteStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  if (callState === 'idle') return null;

  const isActive     = callState === 'connected' || callState === 'reconnecting';
  const isCalling    = callState === 'calling';
  const isRinging    = callState === 'ringing';
  const isConnecting = callState === 'connecting';
  const isTerminal   = ['ended', 'failed', 'missed', 'declined'].includes(callState);

  const localHasVideo  = (localStream?.getVideoTracks().length ?? 0) > 0;
  const remoteHasVideo = (remoteStream?.getVideoTracks().length ?? 0) > 0;
  const showVideo = (isVideoCall || isScreenSharing || localHasVideo || remoteHasVideo) && (isActive || isConnecting);

  // ── Video call — full screen ──────────────────────────────────────────
  if (showVideo) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
        <div className="flex-1 relative">
          {remoteStream ? (
            <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-black">
              <div className="h-8 w-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* PiP local video */}
          {localStream && (isVideoEnabled || isScreenSharing) && (
            <div className={cn(
              'absolute rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl',
              isMobile ? 'bottom-28 right-3 w-24 h-32' : 'bottom-24 right-4 w-32 h-44',
            )}>
              <video
                ref={localVideoRef} autoPlay playsInline muted
                className="w-full h-full object-cover"
                style={{ transform: isScreenSharing ? 'none' : 'scaleX(-1)' }}
              />
            </div>
          )}

          {/* Top status bar */}
          <div className="absolute top-0 inset-x-0 p-4 pt-12 bg-gradient-to-b from-black/70 to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isActive && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
                <span className="text-white text-sm font-semibold">{STATE_LABELS[callState]}</span>
                {isScreenSharing && (
                  <span className="text-xs bg-blue-600/60 text-blue-200 px-2 py-0.5 rounded-full">Sharing screen</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <QualityBadge stats={qualityStats} />
                {isActive && <span className="text-white/80 text-sm font-mono">{formatDuration(callDuration)}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-black/90 backdrop-blur-md px-6 py-6 pb-10 flex items-center justify-center gap-5">
          <button onClick={toggleMute} className={cn('h-14 w-14 rounded-full flex items-center justify-center transition-all active:scale-90', isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white')}>
            {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </button>
          <button onClick={toggleVideo} className={cn('h-14 w-14 rounded-full flex items-center justify-center transition-all active:scale-90', !isVideoEnabled ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white')}>
            {isVideoEnabled ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
          </button>
          {!isMobile && (
            <button onClick={toggleScreenShare} className={cn('h-14 w-14 rounded-full flex items-center justify-center transition-all active:scale-90', isScreenSharing ? 'bg-blue-500/30 text-blue-300' : 'bg-white/10 text-white')}>
              {isScreenSharing ? <MonitorOff className="h-6 w-6" /> : <Monitor className="h-6 w-6" />}
            </button>
          )}
          <button onClick={hangUp} className="h-16 w-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/30 active:scale-90 transition-transform">
            <PhoneOff className="h-7 w-7" />
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Mobile: incoming call — full screen ───────────────────────────────
  if (isMobile && isRinging) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-between">
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        {/* Top label */}
        <div className="w-full pt-14 px-6 text-center">
          <p className="text-slate-400 text-sm font-medium tracking-wide uppercase">Incoming Call</p>
        </div>

        {/* Avatar */}
        <div className="flex flex-col items-center">
          <div className="relative mb-6">
            <div className="absolute rounded-full bg-emerald-500/20 animate-ping" style={{ inset: -12 }} />
            <div className="absolute rounded-full bg-emerald-500/10 animate-pulse" style={{ inset: -24, animationDelay: '0.3s' }} />
            <div className="h-36 w-36 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 border-4 border-emerald-400/30 flex items-center justify-center shadow-2xl shadow-emerald-500/20 relative">
              <User className="h-18 w-18 text-white" strokeWidth={1.5} style={{ width: 72, height: 72 }} />
            </div>
          </div>
          <h2 className="text-white text-3xl font-semibold mb-1">Incoming Call</h2>
          <p className="text-emerald-400 text-base">Ringing…</p>
        </div>

        {/* Buttons */}
        <div className="w-full px-10 pb-16">
          <div className="flex items-end justify-center gap-20">
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={declineIncoming}
                className="h-16 w-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/40 active:scale-90 transition-transform"
              >
                <PhoneOff className="h-7 w-7" />
              </button>
              <span className="text-sm text-red-400 font-medium">Decline</span>
            </div>
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={answerIncoming}
                className="h-20 w-20 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xl shadow-emerald-500/50 active:scale-90 transition-transform"
              >
                <Phone className="h-9 w-9" />
              </button>
              <span className="text-sm text-emerald-400 font-medium">Accept</span>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Mobile: active audio call — full screen ───────────────────────────
  if (isMobile && isActive && !showVideo) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-between">
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        {/* Top bar */}
        <div className="w-full pt-14 px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {callState === 'reconnecting' && (
              <div className="h-4 w-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            )}
            <span className="text-slate-400 text-sm font-medium">
              {callState === 'reconnecting' ? 'Reconnecting…' : 'In Call'}
            </span>
          </div>
          <QualityBadge stats={qualityStats} />
        </div>

        {/* Avatar + info */}
        <div className="flex flex-col items-center">
          <div className="relative mb-8">
            <div className="h-44 w-44 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 border-4 border-emerald-400/20 flex items-center justify-center shadow-2xl shadow-emerald-500/10">
              <User strokeWidth={1.5} style={{ width: 88, height: 88, color: 'white' }} />
            </div>
            {/* Active dot */}
            <div className="absolute bottom-3 right-3 h-6 w-6 rounded-full bg-emerald-400 border-4 border-slate-900 animate-pulse" />
          </div>

          <h2 className="text-white text-3xl font-semibold mb-3">In Call</h2>

          {/* Duration */}
          <p className="text-emerald-400 text-2xl font-mono font-medium tabular-nums">
            {formatDuration(callDuration)}
          </p>

          {/* Muted pill */}
          {isMuted && (
            <div className="mt-5 flex items-center gap-2 px-5 py-2 rounded-full bg-red-500/20 border border-red-500/30">
              <MicOff className="h-4 w-4 text-red-400" />
              <span className="text-red-400 text-sm font-medium">Muted</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="w-full px-8 pb-14">
          {/* Top row: Mute + Video */}
          <div className="flex items-center justify-center gap-10 mb-10">
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={toggleMute}
                className={cn(
                  'h-16 w-16 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-lg',
                  isMuted ? 'bg-red-500 text-white shadow-red-500/30' : 'bg-slate-700 text-white shadow-black/30',
                )}
              >
                {isMuted ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
              </button>
              <span className="text-xs text-slate-400 font-medium">{isMuted ? 'Unmute' : 'Mute'}</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button
                onClick={toggleVideo}
                className="h-16 w-16 rounded-full bg-slate-700 text-white flex items-center justify-center transition-all active:scale-90 shadow-lg shadow-black/30"
              >
                <Video className="h-7 w-7" />
              </button>
              <span className="text-xs text-slate-400 font-medium">Video</span>
            </div>
          </div>

          {/* End call */}
          <div className="flex justify-center">
            <button
              onClick={hangUp}
              className="h-16 w-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-xl shadow-red-500/40 active:scale-90 transition-transform"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Mobile: calling / connecting — full screen ────────────────────────
  if (isMobile && (isCalling || isConnecting)) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-between">
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        <div className="w-full pt-14 px-6 text-center">
          <p className="text-slate-400 text-sm font-medium tracking-wide uppercase">
            {isCalling ? 'Calling…' : 'Connecting…'}
          </p>
        </div>

        <div className="flex flex-col items-center">
          <div className="relative mb-8">
            <div className="absolute rounded-full bg-blue-500/20 animate-ping" style={{ inset: -12 }} />
            <div className="h-36 w-36 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 border-4 border-blue-400/30 flex items-center justify-center shadow-2xl shadow-blue-500/20 relative">
              <User strokeWidth={1.5} style={{ width: 72, height: 72, color: 'white' }} />
            </div>
          </div>
          <h2 className="text-white text-3xl font-semibold mb-2">Calling…</h2>
          <p className="text-blue-400 text-base mb-8">Please wait</p>
          <div className="h-6 w-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>

        <div className="w-full px-8 pb-16 flex justify-center">
          <button
            onClick={hangUp}
            className="h-16 w-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-xl shadow-red-500/40 active:scale-90 transition-transform"
          >
            <PhoneOff className="h-7 w-7" />
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Desktop + terminal states — compact floating bar ──────────────────
  return createPortal(
    <div className={cn(
      'fixed inset-x-0 z-[9999] flex justify-center pointer-events-none',
      isMobile ? 'top-0 px-2 pt-2' : 'top-0 px-4 pt-4',
    )}>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
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
        <div className="shrink-0">
          {isActive && <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />}
          {isRinging && <PhoneIncoming className="h-5 w-5 text-violet-400" />}
          {callState === 'missed' && <PhoneMissed className="h-5 w-5 text-amber-400" />}
          {(isCalling || isConnecting) && <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-bold truncate">{STATE_LABELS[callState] || callState}</span>
          {isActive && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono opacity-80">{formatDuration(callDuration)}</span>
              <QualityBadge stats={qualityStats} />
            </div>
          )}
          {isTerminal && endReason && endReason !== callState && (
            <span className="text-[10px] opacity-60 truncate">{endReason.replace(/_/g, ' ')}</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRinging && (
            <>
              <button onClick={answerIncoming} className="h-10 w-10 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center transition-colors shadow-lg shadow-emerald-600/30 active:scale-95" title="Answer">
                <Phone className="h-5 w-5" />
              </button>
              <button onClick={declineIncoming} className="h-10 w-10 rounded-full bg-destructive hover:bg-destructive/80 text-destructive-foreground flex items-center justify-center transition-colors active:scale-95" title="Decline">
                <PhoneOff className="h-5 w-5" />
              </button>
            </>
          )}
          {isActive && (
            <>
              <button onClick={toggleMute} className={cn('h-9 w-9 rounded-full flex items-center justify-center transition-colors active:scale-95', isMuted ? 'bg-destructive/20 text-destructive' : 'bg-emerald-800/50 text-emerald-300')} title={isMuted ? 'Unmute' : 'Mute'}>
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button onClick={toggleVideo} className="h-9 w-9 rounded-full bg-emerald-800/50 text-emerald-300 flex items-center justify-center transition-colors active:scale-95" title="Toggle video">
                {isVideoEnabled ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
              </button>
              {!isMobile && (
                <button onClick={toggleScreenShare} className={cn('h-9 w-9 rounded-full flex items-center justify-center transition-colors active:scale-95', isScreenSharing ? 'bg-blue-600/30 text-blue-300' : 'bg-emerald-800/50 text-emerald-300')} title={isScreenSharing ? 'Stop sharing' : 'Share screen'}>
                  {isScreenSharing ? <MonitorOff className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
                </button>
              )}
            </>
          )}
          {(isCalling || isConnecting || isActive) && (
            <button onClick={hangUp} className="h-10 w-10 rounded-full bg-destructive hover:bg-destructive/80 text-destructive-foreground flex items-center justify-center transition-colors shadow-lg shadow-destructive/30 active:scale-95" title="End call">
              <PhoneOff className="h-5 w-5" />
            </button>
          )}
          {isTerminal && (
            <button onClick={() => hangUp()} className="h-8 w-8 rounded-full bg-muted hover:bg-accent text-muted-foreground flex items-center justify-center transition-colors active:scale-95" title="Dismiss">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
