import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Send,
  Mic,
  Smile,
  Paperclip,
  Eye,
  Clock,
  LayoutGrid,
  X,
  Plus,
  Trash2,
  Square
} from 'lucide-react';
import { encodeVoice, encodePoll } from '../lib/message-codec';

interface Props {
  onSend: (payload: { content: string; type: string; expiresAt?: string | null }) => void;
  onTyping: (isTyping: boolean) => void;
  sending: boolean;
  replyTo?: any;
  onCancelReply?: () => void;
  compact?: boolean;
}

export function MessageComposer({ onSend, onTyping, sending, replyTo, onCancelReply, compact }: Props) {
  const [content, setContent] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOpts, setPollOpts] = useState(['', '']);
  const [isOneTime, setIsOneTime] = useState(false);
  const [expirySeconds, setExpirySeconds] = useState<number | null>(null);
  const [showExpiry, setShowExpiry] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordingTime(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!content.trim() || sending) return;

    let expiresAt: string | null = null;
    if (isOneTime) {
      const d = new Date();
      d.setHours(d.getHours() + 1);
      expiresAt = d.toISOString();
    } else if (expirySeconds) {
      expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
    }

    onSend({ content: content.trim(), type: isOneTime ? 'vanish' : 'text', expiresAt });
    setContent('');
    setIsOneTime(false);
    setExpirySeconds(null);
    onTyping(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => {
        const durationSec = recordingTime || 1;
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1] || '';
          if (b64) onSend({ content: encodeVoice(durationSec, b64), type: 'voice' });
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      setIsRecording(true);
    } catch (err) { console.error('Mic error:', err); }
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className={cn("border-t border-slate-100 bg-slate-50/60 backdrop-blur-xl transition-all", compact ? "p-2" : "p-4")}>
      {replyTo && (
        <div className="mb-3 px-4 py-2 bg-white/60 border-l-4 border-indigo-600 rounded-r-xl flex items-center justify-between animate-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Reply Context</span>
            <span className="text-xs text-slate-500 truncate max-w-[300px]">{replyTo.content || replyTo.body}</span>
          </div>
          <button onClick={onCancelReply} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
        </div>
      )}

      {showPoll && (
        <div className="mb-3 p-3 bg-white border border-slate-200 rounded-2xl shadow-xl space-y-2 animate-in fade-in slide-in-from-bottom-2">
           <input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Question..." className="w-full bg-slate-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none" />
           {pollOpts.map((opt, i) => (
             <input key={i} value={opt} onChange={e => { const n = [...pollOpts]; n[i] = e.target.value; setPollOpts(n); }} placeholder={`Option ${i+1}`} className="w-full bg-slate-50 border-none rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500/20 outline-none" />
           ))}
           <button onClick={() => { if (pollQuestion.trim()) { onSend({ content: encodePoll(pollQuestion, pollOpts.filter(o => o)), type: 'poll' }); setShowPoll(false); } }} className="w-full py-2 bg-indigo-600 text-white text-[10px] font-black uppercase rounded-xl tracking-widest shadow-lg shadow-indigo-200">Broadcast Poll</button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1">
            <button onClick={() => setIsOneTime(!isOneTime)} className={cn("p-2 rounded-xl transition-all", isOneTime ? "bg-rose-500 text-white shadow-lg shadow-rose-200" : "text-slate-400 hover:bg-slate-100")}>
              <Eye size={18} />
            </button>
            <div className="relative">
              <button type="button" onClick={() => setShowExpiry(!showExpiry)} className={cn("p-2 rounded-xl transition-all", expirySeconds ? "bg-amber-500 text-white shadow-lg shadow-amber-200" : "text-slate-400 hover:bg-slate-100")}>
                <Clock size={18} />
              </button>
              {showExpiry && (
                <div className="absolute bottom-full left-0 mb-3 bg-white border border-slate-100 rounded-2xl shadow-2xl p-1.5 flex flex-col min-w-[140px] z-50 animate-in fade-in slide-in-from-bottom-2">
                  {[{l:'Off',v:null}, {l:'10s',v:10}, {l:'1m',v:60}, {l:'1h',v:3600}].map(o => (
                    <button key={o.l} type="button" onClick={() => {setExpirySeconds(o.v); setShowExpiry(false);}} className="px-4 py-2 text-[12px] font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl text-left">{o.l}</button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setShowPoll(!showPoll)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all"><LayoutGrid size={18} /></button>
          </div>

          {isRecording && (
            <div className="flex items-center gap-2 px-3 py-1 bg-rose-50 text-rose-600 rounded-full border border-rose-100">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-[11px] font-mono font-black">{fmtTime(recordingTime)}</span>
            </div>
          )}
        </div>

        <div className="flex items-end gap-2 bg-white border border-slate-200 rounded-[32px] p-1.5 focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-500/5 shadow-sm">
          <button type="button" className="p-2 text-slate-400 hover:bg-slate-50 rounded-full"><Plus size={20} /></button>
          <textarea
            className="flex-1 bg-transparent border-none focus:ring-0 text-[14px] font-medium py-2 px-1 max-h-32 min-h-[36px] resize-none placeholder:text-slate-400 font-sans"
            value={isRecording ? 'Capturing audio link...' : content}
            onChange={e => { setContent(e.target.value); onTyping(e.target.value.trim().length > 0); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Type your message..."
          />
          <div className="flex items-center gap-1.5 pb-0.5 pr-1">
             <button type="button" onMouseDown={startRecording} onMouseUp={stopRecording} className={cn("p-2.5 rounded-full transition-all", isRecording ? "bg-rose-500 text-white shadow-lg" : "text-slate-400 hover:bg-slate-50")}>
               {isRecording ? <Square size={18} fill="white" /> : <Mic size={20} />}
             </button>
             <button type="submit" disabled={(!content.trim() && !isRecording) || sending} onClick={handleSubmit} className="p-2.5 bg-indigo-600 text-white rounded-[20px] shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 disabled:opacity-20 transition-all active:scale-95">
               <Send size={18} />
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}
