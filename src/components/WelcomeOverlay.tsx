import { useEffect, useRef, useState } from 'react';
import type { WelcomeMsg } from '@/hooks/useWelcomeMessage';

const DURATION_MS = 10000;

interface Props {
  msg: WelcomeMsg;
  onDismiss: () => void;
}

export function WelcomeOverlay({ msg, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const startRef = useRef<number>(0);
  const rafRef   = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Fade in
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, []);

  // Progress bar + auto-dismiss
  useEffect(() => {
    startRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.max(0, 100 - (elapsed / DURATION_MS) * 100);
      setProgress(pct);
      if (pct > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    timerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 350);
    }, DURATION_MS);

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timerRef.current);
    };
  }, [onDismiss]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 350);
  };

  return (
    <div
      onClick={handleDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        transition: 'opacity 0.35s ease',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        dir={msg.isRTL ? 'rtl' : 'ltr'}
        style={{
          background: 'var(--panel)',
          border: '1px solid color-mix(in srgb, var(--brand) 35%, var(--line))',
          borderRadius: 20,
          padding: '36px 40px 28px',
          maxWidth: 420,
          width: 'calc(100vw - 48px)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px color-mix(in srgb, var(--brand) 10%, transparent)',
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.92) translateY(12px)',
          transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.35s ease',
          opacity: visible ? 1 : 0,
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
          cursor: 'default',
        }}
      >
        {/* Big emoji */}
        <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 16, userSelect: 'none' }}>
          {msg.emoji}
        </div>

        {/* Title */}
        <div style={{
          fontSize: 22,
          fontWeight: 800,
          color: 'var(--text)',
          lineHeight: 1.25,
          marginBottom: 10,
          letterSpacing: '-0.3px',
        }}>
          {msg.title}
        </div>

        {/* Body */}
        <div style={{
          fontSize: 14,
          color: 'var(--muted)',
          lineHeight: 1.6,
          marginBottom: 28,
        }}>
          {msg.body}
        </div>

        {/* Dismiss hint */}
        <div style={{ fontSize: 10, color: 'var(--muted)', opacity: 0.5, marginBottom: 16 }}>
          {msg.isRTL ? 'اضغط في أي مكان للإغلاق' : 'Tap anywhere to dismiss'}
        </div>

        {/* Progress bar */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'color-mix(in srgb, var(--brand) 15%, transparent)',
        }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: 'var(--brand)',
            borderRadius: '0 2px 2px 0',
            transition: 'width 0.1s linear',
            transformOrigin: msg.isRTL ? 'right' : 'left',
          }} />
        </div>
      </div>
    </div>
  );
}
