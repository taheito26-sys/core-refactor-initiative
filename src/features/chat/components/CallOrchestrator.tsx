import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { CallPanel } from './CallPanel';
import { Phone, PhoneOff } from 'lucide-react';

export function CallOrchestrator({ roomId }: { roomId: string | null }) {
  const [incomingCall, setIncomingCall] = useState<{ id: string; from: string } | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  const { connected, muted, error, toggleMute } = useVoiceCall(activeCallId, roomId);

  useEffect(() => {
    if (!roomId) return;

    // Listen for incoming call offers on the room channel
    const channel = supabase.channel(`room:${roomId}:calls`);
    channel
      .on('broadcast', { event: 'offer' }, (payload) => {
        if (!activeCallId && !incomingCall) {
          setIncomingCall({ id: payload.payload.callSessionId, from: payload.payload.started_by });
        }
      })
      .on('broadcast', { event: 'end' }, () => {
        setActiveCallId(null);
        setIncomingCall(null);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, activeCallId, incomingCall]);

  const handleAccept = () => {
    if (incomingCall) {
      setActiveCallId(incomingCall.id);
      setIncomingCall(null);
    }
  };

  const handleDecline = () => {
    setIncomingCall(null);
    // Optionally send 'end' broadcast
  };

  return (
    <>
      {incomingCall && (
        <div className="fixed top-4 right-4 z-50 bg-primary text-primary-foreground p-4 rounded-lg shadow-xl animate-bounce flex items-center gap-4 border border-primary-foreground/20">
          <div className="flex-1">
            <p className="text-xs opacity-80 uppercase font-bold tracking-wider">Incoming Call</p>
            <p className="text-sm font-semibold">Merchant calling...</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAccept} className="bg-green-500 hover:bg-green-600 p-2 rounded-full transition shadow-lg">
              <Phone size={18} />
            </button>
            <button onClick={handleDecline} className="bg-destructive hover:bg-destructive/80 p-2 rounded-full transition shadow-lg">
              <PhoneOff size={18} />
            </button>
          </div>
        </div>
      )}
      
      {activeCallId && (
        <div className="fixed bottom-4 right-4 z-50 w-64">
          <CallPanel 
            connected={connected} 
            muted={muted} 
            error={error} 
            onToggleMute={toggleMute} 
            onLeave={() => setActiveCallId(null)} 
          />
        </div>
      )}
    </>
  );
}
