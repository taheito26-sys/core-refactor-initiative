import { useState, useEffect } from 'react';

/**
 * Dev-only floating panel showing OAuth diagnostics.
 * Only renders when import.meta.env.DEV is true.
 */
export function AuthDiagnostics() {
  const [visible, setVisible] = useState(false);
  const [info, setInfo] = useState({
    supabaseUrl: '',
    projectId: '',
    oauthStartedAt: '',
    returnPath: '',
    currentPath: '',
    hasSession: '',
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const update = () => {
      setInfo({
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '—',
        projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID || '—',
        oauthStartedAt: sessionStorage.getItem('oauth:started-at')
          ? new Date(Number(sessionStorage.getItem('oauth:started-at'))).toLocaleTimeString()
          : '—',
        returnPath: sessionStorage.getItem('oauth:return-path') || '—',
        currentPath: window.location.pathname + window.location.search,
        hasSession: localStorage.getItem('sb-dozmqtzlinfqjrropipb-auth-token') ? 'Yes' : 'No',
      });
    };

    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, []);

  if (!import.meta.env.DEV) return null;

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="fixed bottom-2 left-2 z-[9999] bg-black/70 text-white text-[10px] px-2 py-1 rounded font-mono opacity-40 hover:opacity-100 transition-opacity"
      >
        🔧 Auth
      </button>
    );
  }

  return (
    <div className="fixed bottom-2 left-2 z-[9999] bg-black/90 text-white text-[10px] p-3 rounded-lg font-mono space-y-1 max-w-xs shadow-xl">
      <div className="flex justify-between items-center mb-1">
        <span className="font-bold text-[11px]">🔧 Auth Diagnostics</span>
        <button onClick={() => setVisible(false)} className="text-white/60 hover:text-white">✕</button>
      </div>
      {Object.entries(info).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-white/50 shrink-0">{k}:</span>
          <span className="text-green-300 break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}
