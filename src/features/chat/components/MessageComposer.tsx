import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Image as ImageIcon, Mic, StopCircle, Trash2, Sparkles, LayoutGrid } from 'lucide-react';

interface Props {
  onSend: (content: string) => void;
  onTyping?: () => void;
  replyTo?: any;
  onCancelReply?: () => void;
  onOpenApp?: (app: 'calculator' | 'order') => void;
}

export function MessageComposer({ onSend, onTyping, replyTo, onCancelReply, onOpenApp }: Props) {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = '40px';
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const generateAIDraft = () => {
    setText("🤖 [AI Draft] Proceeding with the formal Deal Offer.");
    if (textareaRef.current) {
        textareaRef.current.style.height = '60px';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => onSend(`||IMAGE||${ev.target?.result as string}`);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      const chunks: Blob[] = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = () => {
        const durationSec = recordingTime || 1;
        const blob = new Blob(chunks, { type: mr.mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1];
          if (b64) onSend(`||VOICE||${durationSec < 10 ? '0' : ''}${durationSec}`);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { alert("Error accessing mic"); }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    mediaRecorderRef.current?.stop();
  };

  return (
    <div style={{ padding: '16px 24px', background: '#ffffff', borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
      {replyTo && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: 8, marginBottom: 12, borderLeft: '3px solid #6366f1' }}>
          <div style={{ fontSize: 13, color: '#475569' }}>Replying to message...</div>
          <button onClick={onCancelReply} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        
        {/* Tool container */}
        <div style={{ display: 'flex', gap: 8, paddingBottom: 6 }}>
          <button onClick={generateAIDraft} title="AI Assist" style={{ width: 32, height: 32, borderRadius: '50%', background: '#ecfdf5', color: '#10b981', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sparkles size={16} />
          </button>
          <button onClick={() => onOpenApp?.('calculator')} title="Mini Apps" style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', color: '#64748b', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LayoutGrid size={16} />
          </button>
          <button onClick={() => fileInputRef.current?.click()} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', color: '#64748b', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon size={16} />
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" style={{ display: 'none' }} />
          </button>
        </div>

        {/* Input box */}
        <div style={{ flex: 1, position: 'relative' }}>
          {isRecording ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#fee2e2', borderRadius: 20, minHeight: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', fontWeight: 600 }}>
                <span className="recording-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                Recording {Math.floor(recordingTime/60)}:{String(recordingTime%60).padStart(2, '0')}
              </div>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Type a message..."
              style={{ width: '100%', minHeight: 40, maxHeight: 120, padding: '10px 16px', borderRadius: 20, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 14, resize: 'none', outline: 'none', fontFamily: 'inherit' }}
            />
          )}
        </div>

        {/* Submit / Mic */}
        {text.trim() ? (
          <button onClick={handleSend} style={{ width: 40, height: 40, borderRadius: '50%', background: '#6366f1', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: textareaRef.current?.scrollHeight && textareaRef.current.scrollHeight > 60 ? 4 : 0 }}>
            <Send size={18} style={{ marginLeft: -2 }} />
          </button>
        ) : (
          <button 
            onPointerDown={startRecording} onPointerUp={stopRecording} onPointerLeave={isRecording ? stopRecording : undefined}
            style={{ width: 40, height: 40, borderRadius: '50%', background: isRecording ? '#ef4444' : '#fff', color: isRecording ? '#fff' : '#64748b', border: isRecording ? 'none' : '1px solid #e2e8f0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            {isRecording ? <StopCircle size={18} /> : <Mic size={18} />}
          </button>
        )}
      </div>
    </div>
  );
}
