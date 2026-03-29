import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Send,
  Mic,
  Smile,
  Paperclip,
  Timer,
  Eye,
  Clock,
  LayoutGrid,
  StopCircle,
  X,
  CheckSquare,
  MapPin
} from 'lucide-react';
import { encodeVoice, encodePoll, encodeScheduled } from '../lib/message-codec';

interface Props {
  onSend: (payload: { content: string; type: string; expiresAt?: string | null }) => void;
  onTyping: () => void;
  sending: boolean;
  replyTo?: any;
  onCancelReply?: () => void;
  compact?: boolean;
}

const QUICK_EMOJIS = ['😀', '😂', '❤️', '👍', '👎', '🔥', '🎉', '😢', '😮', '🙏', '💯', '✅', '❌', '👋', '🤝', '💰'];

export function MessageComposer({ onSend, onTyping, sending, replyTo, onCancelReply, compact }: Props) {
  const [content, setContent] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOpts, setPollOpts] = useState(['', '']);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [isOneTime, setIsOneTime] = useState(false);
  const [has24hTimer, setHas24hTimer] = useState(false);
  const [isSharingLocation, setIsSharingLocation] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimeRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!content.trim() || sending) return;

    let expiresAt: string | null = null;
    if (isOneTime) {
      const d = new Date();
      d.setHours(d.getHours() + 1);
      expiresAt = d.toISOString();
    } else if (has24hTimer) {
      const d = new Date();
      d.setHours(d.getHours() + 24);
      expiresAt = d.toISOString();
    }

    onSend({ content: content.trim(), type: 'text', expiresAt });
    setContent('');
    setIsOneTime(false);
    setHas24hTimer(false);
  };

  // ── Voice recording ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mr;
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        const durationSec = recordingTimeRef.current || 1;
        const blob = new Blob(chunks, { type: mr.mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1] || '';
          if (b64) onSend({ content: encodeVoice(durationSec, b64), type: 'voice' });
        };
        reader.readAsDataURL(blob);
      };
      mr.start(100);
      setIsRecording(true);
      recordingTimeRef.current = 0;
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        recordingTimeRef.current += 1;
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch { /* mic denied */ }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
  };

  const fmtRecTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;


  const shareCurrentLocation = useCallback(() => {
    if (!navigator.geolocation || sending || isRecording) return;
    setIsSharingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const mapUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
        onSend({ content: `📍 Shared location
${mapUrl}`, type: 'location' });
        setIsSharingLocation(false);
      },
      () => {
        setIsSharingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [onSend, sending, isRecording]);

  return (
    <div className={cn("bg-background space-y-2 border-t border-border", compact ? "p-2.5" : "p-3")}>
      {/* Poll creator */}
      {showPoll && (
        <div className="px-4 py-3 border border-border rounded-2xl bg-muted/50 space-y-2 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">📊 Create Poll</span>
            <button onClick={() => setShowPoll(false)} className="text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer p-0.5">
              <X size={14} />
            </button>
          </div>
          <input
            value={pollQuestion}
            onChange={(e) => setPollQuestion(e.target.value)}
            placeholder="Question..."
            className="w-full bg-background border border-border rounded-xl text-[12px] px-3 py-2 text-foreground outline-none focus:border-primary/40"
          />
          {pollOpts.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={opt}
                onChange={(e) => { const n = [...pollOpts]; n[i] = e.target.value; setPollOpts(n); }}
                placeholder={`Option ${i + 1}`}
                className="flex-1 bg-background border border-border rounded-xl text-[12px] px-3 py-2 text-foreground outline-none focus:border-primary/40"
              />
            </div>
          ))}
          <button
            onClick={() => {
              const filteredOpts = pollOpts.filter((o) => o.trim());
              if (!pollQuestion.trim() || filteredOpts.length < 2) return;
              onSend({ content: encodePoll(pollQuestion.trim(), filteredOpts), type: 'poll' });
              setShowPoll(false);
            }}
            className="w-full bg-primary text-primary-foreground text-[11px] font-black uppercase tracking-[0.2em] rounded-xl py-2.5 border-none cursor-pointer hover:bg-primary/90 transition-all font-bold"
          >
            Send Poll
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-1.5 md:gap-2 group">
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          className={cn(
            "rounded-lg transition-all shrink-0 flex items-center justify-center",
            compact ? "w-11 h-11" : "p-2",
            isRecording ? "text-destructive bg-destructive/10 animate-pulse" : "text-muted-foreground hover:text-primary hover:bg-accent"
          )}
          title="Audio Message"
        >
          {isRecording ? <StopCircle size={18} /> : <Mic size={18} />}
        </button>

        <div className={cn(
          "flex-1 relative flex items-center bg-muted border border-border rounded-full px-3 md:px-4 transition-all focus-within:border-primary/40 focus-within:bg-background focus-within:shadow-sm",
          compact ? "min-h-[48px]" : "min-h-[40px]"
        )}>
          <input
            value={isRecording ? `Recording... ${fmtRecTime(recordingTime)}` : content}
            onChange={(e) => {
              setContent(e.target.value);
              onTyping();
            }}
            disabled={isRecording}
            placeholder={isRecording ? "Listening..." : "Type a message..."}
            className={cn(
              "flex-1 bg-transparent border-none focus:outline-none text-foreground placeholder:text-muted-foreground placeholder:font-medium min-w-0",
              compact ? "text-[15px] py-2" : "text-[13px] py-1.5"
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          {!compact && (
            <div className="flex items-center gap-2 pr-1 opacity-60 group-focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => { setIsOneTime(!isOneTime); if (!isOneTime) setHas24hTimer(false); }}
                className={cn("p-1.5 rounded transition-all", isOneTime ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary")}
              >
                <Eye size={16} />
              </button>
              <button
                type="button"
                onClick={() => { setHas24hTimer(!has24hTimer); if (!has24hTimer) setIsOneTime(false); }}
                className={cn("p-1.5 rounded transition-all", has24hTimer ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary")}
              >
                <Clock size={16} />
              </button>
              <button type="button" className="text-muted-foreground hover:text-primary"><Smile size={16} /></button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 md:gap-1 shrink-0">
          {!compact && (
            <button
              type="button"
              onClick={shareCurrentLocation}
              disabled={isSharingLocation}
              className="p-2 text-muted-foreground hover:text-primary transition-all disabled:opacity-50"
              title="Share current location"
            >
              <MapPin size={18} />
            </button>
          )}
          {!compact && (
            <button
              type="button"
              onClick={() => setShowPoll(!showPoll)}
              className="p-2 text-muted-foreground hover:text-primary transition-all"
            >
              <CheckSquare size={18} />
            </button>
          )}
          <button
            type="submit"
            disabled={(!content.trim() && !isRecording) || sending}
            className={cn(
              "rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-50 disabled:shadow-none",
              compact ? "w-11 h-11" : "w-10 h-10"
            )}
          >
            <Send size={16} className={cn(sending && "animate-pulse")} />
          </button>
        </div>
      </form>
    </div>
  );
}
