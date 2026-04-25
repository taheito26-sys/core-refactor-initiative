import { useEffect, useMemo, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { isInstalledPwa, isNativeApp } from '@/platform/runtime';
import { useAuth } from '@/features/auth/auth-context';

type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};

const INSTALLED_KEY = 'pwa-install-prompt-installed';
const POSTPONE_UNTIL_KEY = 'pwa-install-prompt-postpone-until';
const DEFAULT_POSTPONE_MS = 24 * 60 * 60 * 1000; // 24h

function isMobileInstallSurface() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = window.matchMedia?.('(max-width: 1024px)').matches ?? false;
  const mobileUA =
    typeof navigator !== 'undefined' &&
    (Boolean((navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile) ||
      /iphone|ipad|ipod|android|mobile/i.test(navigator.userAgent));
  // Some mobile browsers (notably iPadOS / desktop-mode) report a "fine" pointer.
  // For install gating we treat narrow viewport OR mobile UA as sufficient.
  return mobileUA || narrow || coarse;
}

function isIOSSafari() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isAppleMobile = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  return isAppleMobile && isSafari;
}

export default function MobileInstallPrompt() {
  // Auth is optional for this gate: we want to enforce install on mobile web
  // both before login and after login.
  useAuth();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEventLike | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [nativePromptDismissed, setNativePromptDismissed] = useState(false);
  const [postponeUntil, setPostponeUntil] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const raw = window.localStorage.getItem(POSTPONE_UNTIL_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  });

  const mobileSurface = useMemo(isMobileInstallSurface, []);
  const iosSafari = useMemo(isIOSSafari, []);

  useEffect(() => {
    setInstalled(isInstalledPwa());
    if (typeof window === 'undefined') return;

    // Housekeeping: clear stale flags so users don't get permanently unblocked
    // by accidentally tapping "already installed" or an expired postpone window.
    try {
      const now = Date.now();
      const postponeRaw = window.localStorage.getItem(POSTPONE_UNTIL_KEY);
      const postponeParsed = postponeRaw ? Number(postponeRaw) : 0;
      if (!Number.isFinite(postponeParsed) || postponeParsed <= now) {
        window.localStorage.removeItem(POSTPONE_UNTIL_KEY);
        setPostponeUntil(0);
      }

      const installedFlagRaw = window.localStorage.getItem(INSTALLED_KEY);
      if (installedFlagRaw && !isInstalledPwa()) {
        window.localStorage.removeItem(INSTALLED_KEY);
      }
    } catch {
      // Best-effort only
    }

    // Keep postpone window in sync across tabs.
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== POSTPONE_UNTIL_KEY) return;
      const next = e.newValue ? Number(e.newValue) : 0;
      setPostponeUntil(Number.isFinite(next) ? next : 0);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEventLike);
      setNativePromptDismissed(false);
    };

    const handleInstalled = () => {
      window.localStorage.setItem(INSTALLED_KEY, String(Date.now()));
      setInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const storedInstalled =
    typeof window !== 'undefined' ? Boolean(window.localStorage.getItem(INSTALLED_KEY)) : false;

  const isPostponed =
    typeof window !== 'undefined' ? Date.now() < postponeUntil : false;

  const shouldBlock =
    mobileSurface &&
    !isNativeApp() &&
    !installed &&
    !storedInstalled &&
    !isInstalledPwa() &&
    !isPostponed;

  if (!shouldBlock) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        window.localStorage.setItem(INSTALLED_KEY, String(Date.now()));
        setInstalled(true);
      } else {
        setNativePromptDismissed(true);
      }
    } finally {
      // The native prompt can usually only be used once per captured event.
      // Clear it so the UI can fall back to manual instructions.
      setDeferredPrompt(null);
      setInstalling(false);
    }
  };

  const handleAlreadyInstalled = () => {
    window.localStorage.setItem(INSTALLED_KEY, String(Date.now()));
    setInstalled(true);
  };

  const handlePostpone = (ms: number = DEFAULT_POSTPONE_MS) => {
    const until = Date.now() + ms;
    window.localStorage.setItem(POSTPONE_UNTIL_KEY, String(until));
    setPostponeUntil(until);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur">
      <Card className="w-full max-w-md border-primary/20 shadow-2xl">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
                'bg-primary/10 text-primary',
              )}
            >
              <Smartphone className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-foreground">Install the app to continue</div>
              <div className="text-xs text-muted-foreground">
                On mobile this portal must be used as an installed app — please add it to your home screen.
              </div>
            </div>
          </div>

          {iosSafari ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">On iPhone or iPad:</div>
              <ol className="mt-2 space-y-1 list-decimal ps-4">
                <li>Tap the Share icon in Safari.</li>
                <li>Choose Add to Home Screen.</li>
                <li>Open the app from your home screen.</li>
              </ol>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              {deferredPrompt ? (
                nativePromptDismissed ? (
                  'Install was dismissed. Use your browser menu to install (⋮ → Install app / Add to Home Screen), then reopen from your home screen.'
                ) : (
                  'Tap Install below to add the app to your home screen.'
                )
              ) : (
                'If your browser does not show an install option, open this site in Chrome or your default browser and try again.'
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {!iosSafari && (
              <Button className="w-full gap-2" onClick={handleInstall} disabled={!deferredPrompt || installing}>
                <Download className="h-4 w-4" />
                {installing ? 'Installing...' : deferredPrompt ? 'Install' : 'Waiting for browser...'}
              </Button>
            )}
            <Button variant="secondary" className="w-full" onClick={() => handlePostpone()}>
              Remind me later
            </Button>
            <Button variant="outline" className="w-full" onClick={handleAlreadyInstalled}>
              I've already installed it
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
