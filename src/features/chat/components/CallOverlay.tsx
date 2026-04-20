// ─── CallOverlay ─────────────────────────────────────────────────────────────
// iPhone-style full-screen mobile call UI with full controls.
// RTL-aware: reads language from theme context, applies dir="rtl" to portal
// roots, translates all strings, and flips directional layouts.
// Uses createPortal(…, document.body) so fixed positioning is never clipped.
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Phone, PhoneOff, PhoneIncoming, PhoneMissed,
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, X,
  Wifi, WifiOff, User, Volume2, Bluetooth,
  Hash, PauseCircle, PlayCircle, FlipHorizontal,
  Signal, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/lib/theme-context';
import type { UseWebRTCReturn, CallQualityStats } from '../hooks/useWebRTC';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props { webrtc: UseWebRTCReturn }
type SpeakerMode = 'earpiece' | 'speaker' | 'bluetooth';

// ── Translations ──────────────────────────────────────────────────────────────
const T = {
  en: {
    incomingCall: 'Incoming Call', ringing: 'Ringing…',
    calling: 'Calling…', connecting: 'Connecting…', pleaseWait: 'Please wait',
    inCall: 'In Call', reconnecting: 'Reconnecting…',
    decline: 'Decline', accept: 'Accept',
    mute: 'Mute', unmute: 'Unmute',
    speaker: 'Speaker', earpiece: 'Earpiece', bluetooth: 'Bluetooth',
    video: 'Video', flip: 'Flip', hold: 'Hold', resume: 'Resume',
    keypad: 'Keypad', stats: 'Stats', endCall: 'End call',
    muted: 'Muted', onHold: 'On Hold',
    callQuality: 'Call Quality',
    bitrate: 'Bitrate', packetLoss: 'Packet Loss', jitter: 'Jitter',
    rtt: 'RTT', quality: 'Quality',
    end: 'End',
    callEnded: 'Call ended', callFailed: 'Call failed',
    missedCall: 'Missed call', callDeclined: 'Call declined',
  },
  ar: {
    incomingCall: 'مكالمة واردة', ringing: 'يرن…',
    calling: 'جارٍ الاتصال…', connecting: 'جارٍ الاتصال…', pleaseWait: 'يرجى الانتظار',
    inCall: 'في مكالمة', reconnecting: 'إعادة الاتصال…',
    decline: 'رفض', accept: 'قبول',
    mute: 'كتم', unmute: 'إلغاء الكتم',
    speaker: 'مكبر الصوت', earpiece: 'السماعة', bluetooth: 'بلوتوث',
    video: 'فيديو', flip: 'قلب', hold: 'تعليق', resume: 'استئناف',
    keypad: 'لوحة المفاتيح', stats: 'الجودة', endCall: 'إنهاء المكالمة',
    muted: 'مكتوم', onHold: 'معلق',
    callQuality: 'جودة المكالمة',
    bitrate: 'معدل البيانات', packetLoss: 'فقدان الحزم', jitter: 'الاهتزاز',
    rtt: 'زمن الاستجابة', quality: 'الجودة',
    end: 'إنهاء',
    callEnded: 'انتهت المكالمة', callFailed: 'فشلت المكالمة',
    missedCall: 'مكالمة فائتة', callDeclined: 'تم رفض المكالمة',
  },
} as const;

type Lang = keyof typeof T;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

const LABELS: Record<string, { en: string; ar: string }> = {
  idle:         { en: '',                  ar: '' },
  calling:      { en: 'Calling…',          ar: 'جارٍ الاتصال…' },
  ringing:      { en: 'Incoming call',     ar: 'مكالمة واردة' },
  connecting:   { en: 'Connecting…',       ar: 'جارٍ الاتصال…' },
  connected:    { en: 'In call',           ar: 'في مكالمة' },
  reconnecting: { en: 'Reconnecting…',     ar: 'إعادة الاتصال…' },
  ended:        { en: 'Call ended',        ar: 'انتهت المكالمة' },
  failed:       { en: 'Call failed',       ar: 'فشلت المكالمة' },
  missed:       { en: 'Missed call',       ar: 'مكالمة فائتة' },
  declined:     { en: 'Call declined',     ar: 'تم رفض المكالمة' },
};

const DTMF_FREQS: Record<string, [number,number]> = {
  '1':[697,1209],'2':[697,1336],'3':[697,1477],
  '4':[770,1209],'5':[770,1336],'6':[770,1477],
  '7':[852,1209],'8':[852,1336],'9':[852,1477],
  '*':[941,1209],'0':[941,1336],'#':[941,1477],
};

async function setSinkSafe(el: HTMLAudioElement | null, id: string): Promise<boolean> {
  if (!el) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = el as any;
  if (typeof a.setSinkId !== 'function') {
    console.log('[Speaker] setSinkId not supported on this browser');
    return false;
  }
  try {
    // Ensure element is playing before routing — setSinkId fails on paused elements
    if (el.paused && el.srcObject) el.play().catch(() => {});
    await a.setSinkId(id);
    console.log('[Speaker] setSinkId succeeded, deviceId:', id || '(earpiece)');
    return true;
  } catch (e) {
    console.warn('[Speaker] setSinkId failed:', (e as Error).message);
    return false;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────
function QualityBadge({ stats }: { stats: CallQualityStats | null }) {
  if (!stats) return null;
  const col = { excellent:'text-emerald-400', good:'text-amber-400', poor:'text-red-400' }[stats.level];
  const Icon = stats.level === 'poor' ? WifiOff : Wifi;
  return (
    <span className={cn('flex items-center gap-1 text-xs', col)}
      title={`${stats.bitrate}kbps · ${stats.packetLoss}% loss · ${stats.roundTripTime}ms`}>
      <Icon className="h-3 w-3" /><span className="capitalize">{stats.level}</span>
    </span>
  );
}

function Btn({ icon, label, on=false, danger=false, disabled=false, onClick, lg=false }:{
  icon:React.ReactNode; label:string; on?:boolean; danger?:boolean;
  disabled?:boolean; onClick:()=>void; lg?:boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button onClick={onClick} disabled={disabled}
        className={cn(
          lg ? 'h-16 w-16' : 'h-14 w-14',
          'rounded-full flex items-center justify-center transition-all active:scale-90 shadow-lg select-none',
          danger   ? 'bg-red-500 text-white shadow-red-500/30' :
          on       ? 'bg-white text-slate-900 shadow-white/20' :
          disabled ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed' :
                     'bg-slate-700/80 text-white shadow-black/30',
        )}>
        {icon}
      </button>
      <span className={cn('text-xs font-medium',
        danger?'text-red-400': on?'text-white':'text-slate-400')}>{label}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function CallOverlay({ webrtc }: Props) {
  const {
    callState, isMuted, isVideoEnabled, isVideoCall, isScreenSharing,
    callDuration, endReason, localStream, remoteStream, qualityStats,
    answerIncoming, declineIncoming, hangUp, toggleMute, toggleVideo, toggleScreenShare,
    remoteAudioRef,
  } = webrtc;
  const isMobile = useIsMobile();
  const { settings } = useTheme();
  const lang: Lang = settings.language === 'ar' ? 'ar' : 'en';
  const t = T[lang];
  const isRTL = lang === 'ar';
  // dir attribute applied to every portal root so text/layout is correct
  const dir = isRTL ? 'rtl' : 'ltr';

  // ── local UI state ────────────────────────────────────────────────────
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>('earpiece');
  const [isOnHold,    setIsOnHold]    = useState(false);
  const [showKeypad,  setShowKeypad]  = useState(false);
  const [dtmfInput,   setDtmfInput]   = useState('');
  const [showStats,   setShowStats]   = useState(false);
  const [frontCam,    setFrontCam]    = useState(true);
  const [audioDevs,   setAudioDevs]   = useState<MediaDeviceInfo[]>([]);

  // Video refs — always mounted so srcObject assignment never races
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Enumerate audio output devices once on mount
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices()
      .then(d => setAudioDevs(d.filter(x => x.kind === 'audiooutput')))
      .catch(() => {});
  }, []);

  // ── wire remoteAudioRef (owned by hook) to remote stream ─────────────
  // The hook already handles visibilitychange/pageshow/resume to call
  // el.play() when the screen unlocks — we just keep srcObject in sync.
  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el) return;
    if (remoteStream) {
      if (el.srcObject !== remoteStream) {
        el.srcObject = remoteStream;
        el.play().catch(() => {});
      }
    } else {
      el.pause();
      el.srcObject = null;
    }
  }, [remoteStream, remoteAudioRef]);

  // ── wire video elements ───────────────────────────────────────────────
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

  // ── speaker routing ───────────────────────────────────────────────────
  // ── speaker routing ───────────────────────────────────────────────────
  // Android Chrome: setSinkId() works once mic permission is granted.
  //   Mic grant also unlocks audiooutput device enumeration with real IDs.
  //   'default' → loudspeaker, '' → earpiece on Android Chrome.
  // iOS Chrome/Safari: setSinkId not supported — visual toggle only.
  const cycleSpeaker = useCallback(async () => {
    const el = remoteAudioRef.current;

    // Re-enumerate — mic permission may have been granted since mount
    let devices = audioDevs;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const outputs = all.filter(d => d.kind === 'audiooutput');
      if (outputs.length > 0) { devices = outputs; setAudioDevs(outputs); }
    } catch { /**/ }

    const hasBT = devices.some(d => /bluetooth|bt\b/i.test(d.label));
    const modes: SpeakerMode[] = hasBT
      ? ['earpiece', 'speaker', 'bluetooth']
      : ['earpiece', 'speaker'];
    const next = modes[(modes.indexOf(speakerMode) + 1) % modes.length];

    if (next === 'speaker') {
      // 'default' routes to loudspeaker on Android Chrome
      await setSinkSafe(el, 'default');
    } else if (next === 'bluetooth') {
      const bt = devices.find(d => /bluetooth|bt\b/i.test(d.label));
      await setSinkSafe(el, bt?.deviceId ?? 'default');
    } else {
      // Earpiece: '' or specific earpiece device ID
      const ear = devices.find(d => /earpiece|receiver/i.test(d.label));
      await setSinkSafe(el, ear?.deviceId ?? '');
    }

    setSpeakerMode(next);
  }, [speakerMode, audioDevs, remoteAudioRef]);

  // ── hold ──────────────────────────────────────────────────────────────
  const toggleHold = useCallback(() => {
    if (!localStream) return;
    const next = !isOnHold;
    localStream.getAudioTracks().forEach(t => { t.enabled = !next; });
    setIsOnHold(next);
  }, [localStream, isOnHold]);

  // ── DTMF ──────────────────────────────────────────────────────────────
  const pressKey = useCallback((key: string) => {
    setDtmfInput(p => p + key);
    try {
      const ctx = new AudioContext();
      const pair = DTMF_FREQS[key];
      if (pair) {
        const gain = ctx.createGain(); gain.gain.value = 0.15; gain.connect(ctx.destination);
        pair.forEach(freq => {
          const osc = ctx.createOscillator(); osc.frequency.value = freq;
          osc.connect(gain); osc.start(); osc.stop(ctx.currentTime + 0.12);
        });
        setTimeout(() => ctx.close(), 300);
      }
    } catch { /**/ }
  }, []);

  // ── flip camera ───────────────────────────────────────────────────────
  const flipCamera = useCallback(async () => {
    if (!localStream || !isVideoEnabled) return;
    try {
      const ns = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: frontCam ? 'environment' : 'user' }, audio: false,
      });
      const nt = ns.getVideoTracks()[0];
      localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
      localStream.addTrack(nt);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
      setFrontCam(f => !f);
    } catch { /**/ }
  }, [localStream, isVideoEnabled, frontCam]);

  if (callState === 'idle') return null;

  const isActive     = callState === 'connected' || callState === 'reconnecting';
  const isCalling    = callState === 'calling';
  const isRinging    = callState === 'ringing';
  const isConnecting = callState === 'connecting';
  const isTerminal   = ['ended','failed','missed','declined'].includes(callState);

  const localHasVideo  = (localStream?.getVideoTracks().length ?? 0) > 0;
  const remoteHasVideo = (remoteStream?.getVideoTracks().length ?? 0) > 0;
  // Show video layout if either side has video tracks, regardless of isVideoCall flag
  const showVideo = (isVideoCall || isScreenSharing || localHasVideo || remoteHasVideo)
    && (isActive || isConnecting);

  // Speaker icon helper
  const SpeakerIcon = speakerMode === 'bluetooth' ? Bluetooth
    : speakerMode === 'speaker' ? Volume2
    : Signal;
  const speakerLabel = speakerMode === 'bluetooth' ? t.bluetooth
    : speakerMode === 'speaker' ? t.speaker
    : t.earpiece;

  // ── VIDEO CALL ────────────────────────────────────────────────────────
  if (showVideo) {
    return createPortal(
      <div dir={dir} className="fixed inset-0 z-[9999] bg-black flex flex-col">
        <audio ref={remoteAudioRef as React.RefObject<HTMLAudioElement>} autoPlay playsInline className="hidden" />
        <div className="flex-1 relative overflow-hidden">
          {remoteStream
            ? <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center bg-black">
                <div className="h-8 w-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
          }
          {/* PiP — position flips in RTL */}
          {localStream && (isVideoEnabled || isScreenSharing) && (
            <div className={cn(
              'absolute bottom-28 w-24 h-32 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl',
              isRTL ? 'left-3' : 'right-3',
            )}>
              <video ref={localVideoRef} autoPlay playsInline muted
                className="w-full h-full object-cover"
                style={{ transform: isScreenSharing ? 'none' : 'scaleX(-1)' }} />
            </div>
          )}
          <div className="absolute top-0 inset-x-0 pt-12 px-4 pb-4 bg-gradient-to-b from-black/70 to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isActive && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
                <span className="text-white text-sm font-semibold">{LABELS[callState]?.[lang]}</span>
              </div>
              <div className="flex items-center gap-3">
                <QualityBadge stats={qualityStats} />
                {isActive && <span className="text-white/80 text-sm font-mono">{fmt(callDuration)}</span>}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-black/90 backdrop-blur-md px-6 py-5 pb-10 flex items-center justify-center gap-5">
          <Btn icon={isMuted ? <MicOff className="h-6 w-6"/> : <Mic className="h-6 w-6"/>}
            label={isMuted ? t.unmute : t.mute} on={isMuted} onClick={toggleMute} />
          <Btn icon={isVideoEnabled ? <Video className="h-6 w-6"/> : <VideoOff className="h-6 w-6"/>}
            label={t.video} on={!isVideoEnabled} onClick={toggleVideo} />
          <Btn icon={<FlipHorizontal className="h-6 w-6"/>} label={t.flip} onClick={flipCamera} />
          <Btn icon={<SpeakerIcon className="h-6 w-6"/>} label={speakerLabel}
            on={speakerMode!=='earpiece'} onClick={cycleSpeaker} />
          <Btn icon={<PhoneOff className="h-7 w-7"/>} label={t.end} danger lg onClick={hangUp} />
        </div>
      </div>,
      document.body,
    );
  }

  // ── MOBILE: INCOMING ──────────────────────────────────────────────────
  if (isMobile && isRinging) {
    return createPortal(
      <div dir={dir} className="fixed inset-0 z-[9999] bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-between">
        <audio ref={remoteAudioRef as React.RefObject<HTMLAudioElement>} autoPlay playsInline className="hidden" />
        <div className="w-full pt-14 px-6 text-center">
          <p className="text-slate-400 text-sm font-medium tracking-widest uppercase">{t.incomingCall}</p>
        </div>
        <div className="flex flex-col items-center">
          <div className="relative mb-6">
            <div className="absolute rounded-full bg-emerald-500/20 animate-ping" style={{inset:-14}} />
            <div className="absolute rounded-full bg-emerald-500/10 animate-pulse" style={{inset:-26,animationDelay:'0.3s'}} />
            <div className="relative h-36 w-36 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 border-4 border-emerald-400/30 flex items-center justify-center shadow-2xl">
              <User strokeWidth={1.5} style={{width:72,height:72,color:'white'}} />
            </div>
          </div>
          <h2 className="text-white text-3xl font-semibold mb-1">{t.incomingCall}</h2>
          <p className="text-emerald-400 text-base">{t.ringing}</p>
        </div>
        {/* In RTL: Accept on the left (start), Decline on the right (end) */}
        <div className="w-full px-10 pb-16">
          <div className={cn('flex items-end justify-center gap-20', isRTL && 'flex-row-reverse')}>
            <div className="flex flex-col items-center gap-3">
              <button onClick={declineIncoming} className="h-16 w-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/40 active:scale-90 transition-transform">
                <PhoneOff className="h-7 w-7" />
              </button>
              <span className="text-sm text-red-400 font-medium">{t.decline}</span>
            </div>
            <div className="flex flex-col items-center gap-3">
              <button onClick={answerIncoming} className="h-20 w-20 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xl shadow-emerald-500/50 active:scale-90 transition-transform">
                <Phone className="h-9 w-9" />
              </button>
              <span className="text-sm text-emerald-400 font-medium">{t.accept}</span>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── MOBILE: CALLING / CONNECTING ──────────────────────────────────────
  if (isMobile && (isCalling || isConnecting)) {
    return createPortal(
      <div dir={dir} className="fixed inset-0 z-[9999] bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-between">
        <audio ref={remoteAudioRef as React.RefObject<HTMLAudioElement>} autoPlay playsInline className="hidden" />
        <div className="w-full pt-14 px-6 text-center">
          <p className="text-slate-400 text-sm font-medium tracking-widest uppercase">{isCalling ? t.calling : t.connecting}</p>
        </div>
        <div className="flex flex-col items-center">
          <div className="relative mb-8">
            <div className="absolute rounded-full bg-blue-500/20 animate-ping" style={{inset:-14}} />
            <div className="relative h-36 w-36 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 border-4 border-blue-400/30 flex items-center justify-center shadow-2xl">
              <User strokeWidth={1.5} style={{width:72,height:72,color:'white'}} />
            </div>
          </div>
          <h2 className="text-white text-3xl font-semibold mb-2">{t.calling}</h2>
          <p className="text-blue-400 text-base mb-8">{t.pleaseWait}</p>
          <div className="h-6 w-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="w-full px-8 pb-16 flex justify-center">
          <button onClick={hangUp} className="h-16 w-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-xl shadow-red-500/40 active:scale-90 transition-transform">
            <PhoneOff className="h-7 w-7" />
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  // ── MOBILE: ACTIVE AUDIO CALL — full controls ─────────────────────────
  if (isMobile && isActive && !showVideo) {
    return createPortal(
      <div dir={dir} className="fixed inset-0 z-[9999] bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col">
        <audio ref={remoteAudioRef as React.RefObject<HTMLAudioElement>} autoPlay playsInline className="hidden" />
        <video ref={remoteVideoRef} autoPlay playsInline muted style={{display:'none'}} />
        <video ref={localVideoRef}  autoPlay playsInline muted style={{display:'none'}} />

        {/* Top bar */}
        <div className="flex items-center justify-between pt-14 px-6 pb-2">
          <div className="flex items-center gap-2">
            {callState==='reconnecting'
              ? <div className="h-4 w-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"/>
              : <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse"/>}
            <span className="text-slate-300 text-sm font-medium">{callState==='reconnecting' ? t.reconnecting : t.inCall}</span>
          </div>
          <QualityBadge stats={qualityStats} />
        </div>

        {/* Avatar + duration */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="relative mb-6">
            <div className="h-40 w-40 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 border-4 border-emerald-400/20 flex items-center justify-center shadow-2xl shadow-emerald-500/10">
              <User strokeWidth={1.5} style={{width:80,height:80,color:'white'}} />
            </div>
            <div className="absolute bottom-2 right-2 h-6 w-6 rounded-full bg-emerald-400 border-4 border-slate-900 animate-pulse" />
          </div>
          <h2 className="text-white text-3xl font-semibold mb-2">{t.inCall}</h2>
          <p className="text-emerald-400 text-2xl font-mono tabular-nums" dir="ltr">{fmt(callDuration)}</p>
          {isMuted && (
            <div className="mt-4 flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-500/20 border border-red-500/30">
              <MicOff className="h-4 w-4 text-red-400"/><span className="text-red-400 text-sm font-medium">{t.muted}</span>
            </div>
          )}
          {isOnHold && (
            <div className="mt-2 flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30">
              <PauseCircle className="h-4 w-4 text-amber-400"/><span className="text-amber-400 text-sm font-medium">{t.onHold}</span>
            </div>
          )}
        </div>

        {/* DTMF Keypad overlay — always LTR (digits are universal) */}
        {showKeypad && (
          <div className="absolute inset-0 z-10 bg-slate-900/98 flex flex-col items-center justify-center" dir="ltr">
            <div className="w-full px-8 mb-4">
              <div className="bg-slate-800 rounded-2xl px-4 py-3 text-center">
                <span className="text-white text-2xl font-mono tracking-widest min-h-[2rem] block">
                  {dtmfInput || <span className="text-slate-600">···</span>}
                </span>
              </div>
            </div>
            {[['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']].map((row,i) => (
              <div key={i} className="flex gap-6 mb-4">
                {row.map(k => (
                  <button key={k} onClick={() => pressKey(k)}
                    className="h-16 w-16 rounded-full bg-slate-700 text-white text-xl font-semibold flex items-center justify-center active:scale-90 transition-transform shadow-lg">
                    {k}
                  </button>
                ))}
              </div>
            ))}
            <button onClick={() => setShowKeypad(false)} className="mt-4 h-12 w-12 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center active:scale-90">
              <ChevronDown className="h-6 w-6"/>
            </button>
          </div>
        )}

        {/* Stats overlay */}
        {showStats && qualityStats && (
          <div className="absolute top-24 inset-x-4 z-10 bg-slate-800/95 rounded-2xl p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white text-sm font-semibold">{t.callQuality}</span>
              <button onClick={() => setShowStats(false)} className="text-slate-400"><X className="h-4 w-4"/></button>
            </div>
            {([
              [t.bitrate,     `${qualityStats.bitrate} kbps`],
              [t.packetLoss,  `${qualityStats.packetLoss.toFixed(1)}%`],
              [t.jitter,      `${qualityStats.jitter} ms`],
              [t.rtt,         `${qualityStats.roundTripTime} ms`],
              [t.quality,     qualityStats.level],
            ] as [string,string][]).map(([k,v]) => (
              <div key={k} className="flex justify-between py-1 border-b border-slate-700/50 last:border-0">
                <span className="text-slate-400 text-xs">{k}</span>
                <span className="text-white text-xs font-mono" dir="ltr">{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Controls grid — grid-cols-3 is direction-agnostic, items flow RTL automatically */}
        <div className="px-6 pb-12">
          <div className="grid grid-cols-3 gap-y-6 gap-x-4 mb-6 place-items-center">
            <Btn icon={isMuted ? <MicOff className="h-6 w-6"/> : <Mic className="h-6 w-6"/>}
              label={isMuted ? t.unmute : t.mute} on={isMuted} onClick={toggleMute} />
            <Btn icon={<SpeakerIcon className="h-6 w-6"/>} label={speakerLabel}
              on={speakerMode!=='earpiece'} onClick={cycleSpeaker} />
            <Btn icon={<Video className="h-6 w-6"/>} label={t.video} onClick={toggleVideo} />
            <Btn icon={isOnHold ? <PlayCircle className="h-6 w-6"/> : <PauseCircle className="h-6 w-6"/>}
              label={isOnHold ? t.resume : t.hold} on={isOnHold} onClick={toggleHold} />
            <Btn icon={<Hash className="h-6 w-6"/>} label={t.keypad} on={showKeypad} onClick={() => setShowKeypad(k => !k)} />
            <Btn icon={<Signal className="h-6 w-6"/>} label={t.stats} on={showStats} onClick={() => setShowStats(s => !s)} />
          </div>
          <div className="flex justify-center">
            <Btn icon={<PhoneOff className="h-7 w-7"/>} label={t.endCall} danger lg onClick={hangUp} />
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── DESKTOP + TERMINAL — compact bar ─────────────────────────────────
  return createPortal(
    <div dir={dir} className={cn('fixed inset-x-0 z-[9999] flex justify-center pointer-events-none',
      isMobile?'top-0 px-2 pt-2':'top-0 px-4 pt-4')}>
      <audio ref={remoteAudioRef as React.RefObject<HTMLAudioElement>} autoPlay playsInline className="hidden" />
      <video ref={remoteVideoRef} autoPlay playsInline muted style={{display:'none'}} />
      <video ref={localVideoRef}  autoPlay playsInline muted style={{display:'none'}} />
      <div className={cn(
        'pointer-events-auto flex items-center gap-3 rounded-2xl shadow-2xl border backdrop-blur-md',
        isMobile?'px-4 py-3 w-full max-w-sm':'px-6 py-3',
        isActive   ?'bg-emerald-950/90 border-emerald-700/40 text-emerald-100':
        isRinging  ?'bg-violet-950/90 border-violet-700/40 text-violet-100 animate-pulse':
        isTerminal ?'bg-muted/95 border-border text-muted-foreground':
                    'bg-card/95 border-border text-foreground',
      )}>
        <div className="shrink-0">
          {isActive   && <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse"/>}
          {isRinging  && <PhoneIncoming className="h-5 w-5 text-violet-400"/>}
          {callState==='missed' && <PhoneMissed className="h-5 w-5 text-amber-400"/>}
          {(isCalling||isConnecting) && <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/>}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-bold truncate">{LABELS[callState]?.[lang] || callState}</span>
          {isActive && <div className="flex items-center gap-2"><span className="text-xs font-mono opacity-80" dir="ltr">{fmt(callDuration)}</span><QualityBadge stats={qualityStats}/></div>}
          {isTerminal && endReason && endReason!==callState && <span className="text-[10px] opacity-60 truncate">{endReason.replace(/_/g,' ')}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRinging && <>
            <button onClick={answerIncoming} className="h-10 w-10 rounded-full bg-emerald-600 text-white flex items-center justify-center active:scale-95"><Phone className="h-5 w-5"/></button>
            <button onClick={declineIncoming} className="h-10 w-10 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center active:scale-95"><PhoneOff className="h-5 w-5"/></button>
          </>}
          {isActive && <>
            <button onClick={toggleMute} className={cn('h-9 w-9 rounded-full flex items-center justify-center active:scale-95',isMuted?'bg-destructive/20 text-destructive':'bg-emerald-800/50 text-emerald-300')}>
              {isMuted?<MicOff className="h-4 w-4"/>:<Mic className="h-4 w-4"/>}
            </button>
            <button onClick={toggleVideo} className="h-9 w-9 rounded-full bg-emerald-800/50 text-emerald-300 flex items-center justify-center active:scale-95">
              {isVideoEnabled?<VideoOff className="h-4 w-4"/>:<Video className="h-4 w-4"/>}
            </button>
            {!isMobile && <button onClick={toggleScreenShare} className={cn('h-9 w-9 rounded-full flex items-center justify-center active:scale-95',isScreenSharing?'bg-blue-600/30 text-blue-300':'bg-emerald-800/50 text-emerald-300')}>
              {isScreenSharing?<MonitorOff className="h-4 w-4"/>:<Monitor className="h-4 w-4"/>}
            </button>}
          </>}
          {(isCalling||isConnecting||isActive) && <button onClick={hangUp} className="h-10 w-10 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center active:scale-95"><PhoneOff className="h-5 w-5"/></button>}
          {isTerminal && <button onClick={hangUp} className="h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center active:scale-95"><X className="h-4 w-4"/></button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

