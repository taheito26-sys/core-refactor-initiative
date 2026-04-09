// ─── CallHistoryPanel — Past call log for a chat room ───────────────────
import { useEffect, useState } from 'react';
import {
  Phone, PhoneIncoming, PhoneOff, PhoneMissed, Video, Clock,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface CallRecord {
  id: string;
  room_id: string;
  initiated_by: string;
  status: string;
  started_at: string;
  connected_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
}

interface Props {
  roomId: string;
  meId: string;
  onCallback?: () => void;
}

function formatCallDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function callIcon(status: string, isOutgoing: boolean) {
  switch (status) {
    case 'missed':
    case 'no_answer':
      return <PhoneMissed className="h-4 w-4 text-amber-500" />;
    case 'declined':
      return <PhoneOff className="h-4 w-4 text-destructive" />;
    case 'failed':
      return <PhoneOff className="h-4 w-4 text-muted-foreground" />;
    default:
      return isOutgoing
        ? <Phone className="h-4 w-4 text-emerald-500" />
        : <PhoneIncoming className="h-4 w-4 text-primary" />;
  }
}

function statusLabel(status: string, endReason: string | null): string {
  switch (status) {
    case 'ended':    return 'Completed';
    case 'missed':
    case 'no_answer': return 'Missed';
    case 'declined': return 'Declined';
    case 'failed':   return endReason ?? 'Failed';
    default:         return status;
  }
}

export function CallHistoryPanel({ roomId, meId, onCallback }: Props) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('chat_calls' as never)
        .select('id, room_id, initiated_by, status, started_at, connected_at, ended_at, duration_seconds, end_reason')
        .eq('room_id', roomId)
        .order('started_at', { ascending: false })
        .limit(50);
      if (!cancelled) {
        setCalls((data ?? []) as unknown as CallRecord[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
        <Phone className="h-8 w-8 opacity-30" />
        <p className="text-sm">No call history yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      {calls.map((call) => {
        const isOutgoing = call.initiated_by === meId;
        const isCompleted = call.status === 'ended' && (call.duration_seconds ?? 0) > 0;

        return (
          <div
            key={call.id}
            className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors"
          >
            {/* Icon */}
            <div className="shrink-0 w-9 h-9 rounded-full bg-muted flex items-center justify-center">
              {callIcon(call.status, isOutgoing)}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  'text-sm font-semibold',
                  (call.status === 'missed' || call.status === 'no_answer') && !isOutgoing
                    ? 'text-amber-500'
                    : 'text-foreground',
                )}>
                  {isOutgoing ? 'Outgoing' : 'Incoming'}
                </span>
                <span className="text-xs text-muted-foreground">
                  · {statusLabel(call.status, call.end_reason)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{format(new Date(call.started_at), 'MMM d, h:mm a')}</span>
                {isCompleted && (
                  <>
                    <Clock className="h-3 w-3" />
                    <span>{formatCallDuration(call.duration_seconds)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Callback button */}
            {onCallback && (
              <button
                onClick={onCallback}
                className="shrink-0 w-9 h-9 rounded-full hover:bg-accent flex items-center justify-center text-primary transition-colors active:scale-95"
                title="Call back"
              >
                <Phone className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
