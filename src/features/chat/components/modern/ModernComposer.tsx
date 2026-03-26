import { useState, useRef, useCallback } from 'react';
import { ArrowUp, Paperclip, Mic, StopCircle, Clock, Sparkles, LayoutGrid } from 'lucide-react';
import { encodeVoice } from '../../lib/message-codec';

interface Props {
  onSend: (content: string) => void;
  onOpenApp?: (app: 'calculator' | 'order_form' | 'balance_checker' | 'schedule_tool') => void;
  disabled?: boolean;
}

export function ModernComposer({ onSend, disabled, onOpenApp }: Props) {
  const [text, setText] = useState('');
  const [vanishMode, setVanishMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimeRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);

  const handleSend = useCallback(() => {
    let content = text.trim();
    if (!content) return;
    if (vanishMode) content = '||VANISH||' + content;
    
    onSend(content);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [text, onSend, vanishMode]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const generateAIDraft = () => {
    setText("🤖 [AI Draft] Based on your active negotiation phase, I suggest proceeding with the formal Deal Offer.");
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = '60px';
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onSend(`||IMAGE||${ev.target?.result as string}`);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        const durationSec = recordingTimeRef.current || 1;
        const blob = new Blob(chunks, { type: mr.mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1] || '';
          if (b64) onSend(`||VOICE||${durationSec < 10 ? '0' : ''}${durationSec}`);
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
    } catch { alert("Microphone access denied."); }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
  };

  const fmtRecTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ flexShrink: 0, padding: '0 24px 24px', background: '#ffffff' }}>
      <div style={{
        maxWidth: 800, margin: '0 auto', position: 'relative',
      }}>
        
        {/* Floating Composer Container */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 12,
          background: '#f8fafc', border: '1px solid #cbd5e1', 
          borderRadius: 24, padding: '12px 16px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
          transition: 'border-color 0.2s',
        }}>
          
          <input type="file" accept="image/*" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileChange} />
          
          {/* Feature 10: AI Assist */}
          <button onClick={generateAIDraft} title="Draft AI Response" style={{ width: 32, height: 32, borderRadius: '50%', background: '#ecfdf5', color: '#10b981', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={18} />
          </button>
          
          {/* Feature 20: Mini Apps */}
          <button onClick={() => onOpenApp?.('order_form')} title="Open Embedded App" style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', color: '#475569', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <LayoutGrid size={18} />
          </button>

          {/* File Picker */}
          <button 
            onClick={() => fileInputRef.current?.click()}
            style={{ 
              width: 32, height: 32, borderRadius: '50%', background: '#e2e8f0', color: '#475569',
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}
          >
            <Paperclip size={18} />
          </button>

          {/* Voice Button */}
          <button 
            onPointerDown={startRecording}
            onPointerUp={stopRecording}
            onPointerLeave={isRecording ? stopRecording : undefined}
            style={{ 
              width: isRecording ? 'auto' : 32, height: 32, borderRadius: 20, 
              background: isRecording ? '#ef4444' : 'transparent', color: isRecording ? '#fff' : '#475569',
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              padding: isRecording ? '0 12px' : 0, transition: 'all 0.2s', gap: 6
            }}
          >
            {isRecording ? <StopCircle size={18} /> : <Mic size={20} />}
            {isRecording && <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtRecTime(recordingTime)}</span>}
          </button>

          {/* Input */}
          <textarea
            ref={textareaRef}
            data-chat-composer="true"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKey}
            disabled={disabled || isRecording}
            placeholder={vanishMode ? "Type a disappearing message..." : "Send a message..."}
            rows={1}
            style={{
              flex: 1, resize: 'none', border: 'none', padding: '6px 4px', fontSize: 15,
              background: 'transparent', color: vanishMode ? '#9333ea' : '#0f172a',
              outline: 'none', maxHeight: 160, lineHeight: 1.4, fontFamily: 'inherit',
              fontStyle: vanishMode ? 'italic' : 'normal'
            }}
          />

          {/* Vanish toggle */}
          <button 
            onClick={() => setVanishMode(!vanishMode)}
            style={{ 
              width: 32, height: 32, borderRadius: '50%',
              background: vanishMode ? '#f3e8ff' : 'transparent', 
              color: vanishMode ? '#9333ea' : '#94a3b8', 
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}
            title="Toggle Vanish Mode"
          >
            <Clock size={20} />
          </button>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={disabled || isRecording || !text.trim()}
            style={{
              width: 34, height: 34, borderRadius: '50%', 
              background: (disabled || isRecording || !text.trim()) ? '#e2e8f0' : '#2563eb', 
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              color: '#fff', transition: 'all 0.2s'
            }}
          >
            <ArrowUp size={18} />
          </button>

        </div>
        <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
          <strong>Pro Tip:</strong> <span>⇧ + Enter for new line. Enter to send.</span>
        </div>
      </div>
    </div>
  );
}
