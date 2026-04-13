import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface Props {
  callState: 'idle' | 'ringing' | 'connecting' | 'connected' | 'ended';
  isIncoming: boolean;
  callerId: string | null;
  remoteStream: MediaStream | null;
  acceptCall: () => void;
  rejectCall: () => void;
  toggleMute: (muted: boolean) => void;
  endCall: () => void;
}

export function CallOrchestrator({
  callState,
  isIncoming,
  callerId,
  remoteStream,
  acceptCall,
  rejectCall,
  toggleMute,
  endCall,
}: Props) {
  const [isMuted, setIsMuted] = useState(false);

  if (callState === 'idle') return null;

  return (
    <div className="fixed inset-x-0 top-10 flex justify-center z-[9999] pointer-events-none">
      <div
        className={cn(
          'pointer-events-auto bg-[#0f172a]/95 backdrop-blur-xl border border-slate-700/50 shadow-2xl rounded-[32px] p-6 flex flex-col items-center space-y-6 transition-all duration-500 transform',
          callState === 'ringing' ? 'scale-110 animate-pulse' : 'scale-100',
          'w-[320px]'
        )}
      >
        <div className="w-20 h-20 rounded-[32px] bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-white text-3xl font-black shadow-xl shadow-violet-500/20">
          {(callerId || 'A').charAt(0).toUpperCase()}
        </div>

        <div className="text-center">
          <h3 className="text-white font-black text-lg uppercase tracking-tight">
            {isIncoming ? (callState === 'ringing' ? 'Incoming Call' : 'In Call') : 'Outgoing Call'}
          </h3>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mt-1">
            {callState === 'ringing' ? 'Ringing...' : callState === 'connecting' ? 'Connecting...' : 'Secure Node 492'}
          </p>
        </div>

        {remoteStream && (
          <div className="w-full h-32 bg-black/40 rounded-2xl overflow-hidden border border-white/5 relative">
            <video
              autoPlay
              playsInline
              ref={(el) => {
                if (el) el.srcObject = remoteStream;
              }}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
              <span className="text-[9px] text-white/50 font-black uppercase">Remote Feed (Encrypted)</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              const next = !isMuted;
              setIsMuted(next);
              toggleMute(next);
            }}
            className={cn(
              'w-12 h-12 rounded-full flex items-center justify-center transition-all bg-slate-800 text-white hover:bg-slate-700',
              isMuted && 'bg-red-500 hover:bg-red-600'
            )}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          {isIncoming && callState === 'ringing' && (
            <>
              <button
                onClick={acceptCall}
                className="w-16 h-16 rounded-[24px] bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30 hover:bg-emerald-600 transition-all hover:scale-105"
              >
                <Phone size={28} />
              </button>
              <button
                onClick={rejectCall}
                className="w-12 h-12 rounded-full bg-slate-700 text-white flex items-center justify-center hover:bg-slate-600 transition-all"
                title="Reject call"
              >
                <PhoneOff size={18} />
              </button>
            </>
          )}

          <button
            onClick={endCall}
            className="w-16 h-16 rounded-[24px] bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/30 hover:bg-red-600 transition-all hover:scale-105"
          >
            <PhoneOff size={28} />
          </button>
        </div>
      </div>
    </div>
  );
}
