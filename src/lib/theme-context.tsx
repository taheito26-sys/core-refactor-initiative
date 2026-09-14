import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppSettings, LogEntry, ThemeDef, LayoutDef } from './theme/types';
import { LAYOUTS } from './theme/layouts';
import { applyThemeToDOM, getTheme, detectOptimalFontSize, FONT_CONFIG } from './theme/utils';
import { supabase } from '@/integrations/supabase/client';

export * from './theme/types';
export * from './theme/layouts';
export { detectOptimalFontSize, FONT_CONFIG };

export const THEME_NAMES: Record<string, string> = { t1: 'Theme 1', t2: 'Theme 2', t3: 'Theme 3', t4: 'Theme 4', t5: 'Theme 5' };
export const FONTS = ['Inter','JetBrains Mono','Space Grotesk','Sora','Plus Jakarta Sans','DM Sans','Outfit','Fira Code','IBM Plex Mono','Roboto','Manrope','Fraunces','Instrument Serif','Public Sans'];
export const FONT_SIZES = [9,10,11,12,13,14];
export const VISION_PROFILES = ['standard','large','xlarge','compact'] as const;

const DEFAULT_SETTINGS: AppSettings = {
  layout: 'quantum_ledger',
  theme: 't1',
  range: '7d',
  currency: 'QAR',
  baseFiatCurrency: 'QAR',
  language: 'ar',
  searchQuery: '',
  lowStockThreshold: 5000,
  priceAlertThreshold: 2,
  allowInvalidTrades: true,
  ledgerFont: 'Inter',
  ledgerFontSize: 11,
  fontVisionProfile: 'standard',
  autoFontDisable: false,
  autoBackup: false,
  logsEnabled: true,
  logLevel: 'info',
  uiDesignVersion: 'modern',
};

interface ThemeContextValue {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  save: () => void;
  discard: () => void;
  isDirty: boolean;
  currentLayout: LayoutDef;
  currentTheme: ThemeDef;
  logs: LogEntry[];
  addLog: (level: LogEntry['level'], message: string, detail?: string) => void;
  clearLogs: () => void;
  downloadLogs: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadSavedSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('tracker_settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* intentional */ }
  return { ...DEFAULT_SETTINGS };
}

function loadLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem('tracker_logs');
    if (raw) return JSON.parse(raw);
  } catch { /* intentional */ }
  return [];
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<AppSettings>(loadSavedSettings);
  const [draft, setDraft] = useState<AppSettings>(loadSavedSettings);
  const [dirty, setDirty] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(loadLogs);
  const logsRef = useRef(logs);
  const settingsRef = useRef(draft);
  logsRef.current = logs;
  settingsRef.current = draft;

  const pushLog = useCallback((level: LogEntry['level'], message: string, detail?: string) => {
    const settingsNow = settingsRef.current;
    const entry: LogEntry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), level, message, detail };
    setLogs(prev => {
      const next = [entry, ...prev].slice(0, 500);
      localStorage.setItem('tracker_logs', JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => { applyThemeToDOM(draft); }, [draft]);

  useEffect(() => {
    const onResize = () => { if (!settingsRef.current.autoFontDisable) applyThemeToDOM(settingsRef.current); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /*
   * Settings — the UI language above all — belong to the signed-in account,
   * not to the device. They are stored per user in tracker_snapshots.preferences,
   * so they are reloaded whenever the signed-in user changes and reset to the
   * shipped defaults on sign-out. Without this, whoever logged in second on a
   * shared device kept the previous person's language until they changed it
   * by hand.
   */
  const activeUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const resetToDefaults = () => {
      const base = { ...DEFAULT_SETTINGS };
      setSaved(base); setDraft(base); setDirty(false);
      applyThemeToDOM(base);
    };

    const applyForUser = (userId: string | null) => {
      const previous = activeUserIdRef.current;
      if (previous === userId) return;
      activeUserIdRef.current = userId;

      if (!userId) {
        // Dev-mode bypass has no Supabase session, so leave its locally saved
        // settings alone instead of resetting them on every load.
        if (localStorage.getItem('p2p_dev_mode') === 'true') return;
        resetToDefaults();
        return;
      }

      // A different account taking over this device starts from the defaults
      // until its own preferences arrive, so nothing of the previous user's
      // presentation leaks through.
      if (previous !== undefined && previous !== null) resetToDefaults();

      void import('./tracker-sync').then(({ loadPreferencesFromCloud }) => {
        void loadPreferencesFromCloud().then((cloudPrefs) => {
          if (cancelled || activeUserIdRef.current !== userId || !cloudPrefs) return;
          const merged = { ...DEFAULT_SETTINGS, ...cloudPrefs } as AppSettings;
          setSaved(merged); setDraft(merged); setDirty(false);
          localStorage.setItem('tracker_settings', JSON.stringify(merged));
          applyThemeToDOM(merged);
        });
      });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applyForUser(session?.user?.id ?? null);
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback((patch: Partial<AppSettings>) => {
    const changed = (Object.keys(patch) as (keyof AppSettings)[]).filter((key) => draft[key] !== patch[key]);
    if (changed.length === 0) return;
    const next = { ...draft, ...patch };
    setDraft(next); setDirty(true);
    if (changed[0] !== 'searchQuery') {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        localStorage.setItem('tracker_settings', JSON.stringify(next));
        setSaved(next); setDirty(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import('./tracker-sync').then(({ savePreferencesToCloud }) => savePreferencesToCloud(next as any));
      }, 800);
    }
  }, [draft]);

  const save = useCallback(() => {
    localStorage.setItem('tracker_settings', JSON.stringify(draft));
    setSaved(draft); setDirty(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    import('./tracker-sync').then(({ savePreferencesNow }) => savePreferencesNow(draft as any));
  }, [draft]);

  const discard = useCallback(() => { setDraft(saved); setDirty(false); }, [saved]);

  const { layout: currentLayout, theme: currentTheme } = getTheme(draft.layout, draft.theme);

  return (
    <ThemeContext.Provider value={{
      settings: draft, update, save, discard, isDirty: dirty,
      currentLayout, currentTheme,
      logs, addLog: pushLog, clearLogs: () => setLogs([]), downloadLogs: () => {},
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
